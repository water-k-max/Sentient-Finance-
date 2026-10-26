// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Position, IMarginVault} from "../interfaces/IMarginVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MarginVault — Clearinghouse for perpetual swap collateral, positions, and margin enforcement
contract MarginVault is IMarginVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    IERC20 public immutable collateralToken;

    mapping(address => uint256) public collateralBalances;
    mapping(address => uint256) public lockedMargin; // margin locked in open positions
    mapping(address => Position) public positions;
    address[] public trackedTraders;
    mapping(address => bool) public isTracked;
    mapping(address => bool) public authorized;
    address public owner;

    // 5% maintenance margin ratio (scaled to 1e18)
    uint256 public constant MAINTENANCE_MARGIN_RATIO = 5e16;

    modifier onlyAuthorized() {
        require(authorized[msg.sender], "MarginVault: not authorized");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "MarginVault: not owner");
        _;
    }

    /// @param _collateralToken  Address of the ERC-20 used as collateral (MockUSDC on testnet)
    constructor(address _collateralToken) {
        require(
            _collateralToken != address(0),
            "MarginVault: zero token address"
        );
        collateralToken = IERC20(_collateralToken);
        owner = msg.sender;
    }

    // ============ Admin ============

    function setAuthorized(address _addr, bool _authorized) external onlyOwner {
        authorized[_addr] = _authorized;
    }

    function isAuthorized(address _addr) external view returns (bool) {
        return authorized[_addr];
    }

    // ============ Collateral ============

    /// @notice Deposit USDC collateral into the vault.
    ///         Caller must have approved this contract for `amount` on the collateral token.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "MarginVault: amount must be > 0");
        // Pull tokens from caller — this is the actual ERC-20 transfer
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw free (unlocked) collateral back to the caller.
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "MarginVault: amount must be > 0");
        uint256 free = getFreeMargin(msg.sender);
        require(free >= amount, "MarginVault: insufficient free margin");
        // Effects before interaction (CEI)
        collateralBalances[msg.sender] -= amount;
        // Send tokens back to caller
        collateralToken.safeTransfer(msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Adjust a trader's collateral by a signed delta (used by applyFunding).
    ///         Positive delta = credit, negative delta = debit.
    function adjustMargin(
        address trader,
        int256 delta
    ) external onlyAuthorized {
        if (delta > 0) {
            collateralBalances[trader] += uint256(delta);
        } else {
            uint256 absDelta = uint256(-delta);
            require(
                collateralBalances[trader] >= absDelta,
                "MarginVault: insufficient collateral for funding debit"
            );
            collateralBalances[trader] -= absDelta;
        }
    }

    /// @notice Lock margin for an order placement (called by OrderBook).
    function lockMargin(
        address trader,
        uint256 amount
    ) external onlyAuthorized {
        require(
            collateralBalances[trader] >= amount,
            "MarginVault: insufficient balance to lock"
        );
        collateralBalances[trader] -= amount;
        lockedMargin[trader] += amount;
    }

    /// @notice Release locked margin back to free collateral (called on cancel / close).
    function releaseMargin(
        address trader,
        uint256 amount
    ) external onlyAuthorized {
        require(
            lockedMargin[trader] >= amount,
            "MarginVault: release exceeds locked amount"
        );
        lockedMargin[trader] -= amount;
        collateralBalances[trader] += amount;
    }

    // ============ Position Lifecycle ============

    /// @notice Settle a matched position for both counterparties (called by OrderBook).
    function settlePosition(
        address longTrader,
        address shortTrader,
        uint256 fillPrice,
        uint256 fillSize,
        uint256 longLeverage,
        uint256 shortLeverage
    ) external onlyAuthorized nonReentrant {
        _openPosition(longTrader, true, fillPrice, fillSize, longLeverage);
        _openPosition(shortTrader, false, fillPrice, fillSize, shortLeverage);
        emit PositionSettled(longTrader, shortTrader, fillPrice, fillSize);
    }

    /// @notice Liquidate an undercollateralised position.
    ///         Only callable by an authorized address (LiquidationSentinel).
    function liquidate(address trader) external onlyAuthorized nonReentrant {
        Position storage pos = positions[trader];
        require(pos.isOpen, "MarginVault: no open position");
        require(
            marginHealth(trader) < MAINTENANCE_MARGIN_RATIO,
            "MarginVault: position is healthy"
        );

        // Cache values BEFORE zeroing (event needs them)
        uint256 liqPrice = pos.liquidationPrice;
        uint256 remainingMargin = pos.margin;

        // Zero out position state
        pos.isOpen = false;
        pos.size = 0;
        pos.margin = 0;
        pos.unrealizedPnl = 0;

        // F-04 FIX: release ONLY the liquidated position's margin lock. The old
        // code did `lockedMargin[trader] = 0`, which also destroyed margin the
        // trader had locked for unrelated resting orders — those orders could then
        // never be cancelled (releaseMargin reverts) and their collateral was
        // stranded. The position's own margin is forfeited to the vault as an
        // insurance buffer (not credited back to collateralBalances).
        if (lockedMargin[trader] >= remainingMargin) {
            lockedMargin[trader] -= remainingMargin;
        } else {
            lockedMargin[trader] = 0;
        }

        _removeTrader(trader);

        // Emit with cached values — position is already zeroed above
        emit LiquidationExecuted(trader, liqPrice, remainingMargin);
    }

    // ============ PnL ============

    /// @notice Update unrealized PnL for a single position.
    function updatePnL(address trader, uint256 currentIndexPrice) external {
        _updatePnL(trader, currentIndexPrice);
    }

    /// @notice Batch PnL update for a paginated slice of traders — avoids gas limit on large sets.
    ///         Call with (0, 100), (100, 200), etc.
    function updatePnLBatch(
        address[] calldata traders,
        uint256 currentIndexPrice
    ) external {
        for (uint256 i = 0; i < traders.length; i++) {
            _updatePnL(traders[i], currentIndexPrice);
        }
    }

    /// @notice Update PnL for all tracked positions (called by reactive agent).
    ///         Use updatePnLBatch for large trader sets to avoid block gas limit.
    function updateAllPnL(uint256 currentIndexPrice) external {
        uint256 len = trackedTraders.length;
        for (uint256 i = 0; i < len; i++) {
            address trader = trackedTraders[i];
            if (positions[trader].isOpen) {
                _updatePnL(trader, currentIndexPrice);
            }
        }
    }

    // ============ Views ============

    /// @notice Margin health factor for a position (1e18 = 100%).
    ///         Returns type(uint256).max when no open position.
    function marginHealth(address trader) public view returns (uint256) {
        Position memory pos = positions[trader];
        if (!pos.isOpen || pos.size == 0) return type(uint256).max;

        int256 equity = int256Safe(pos.margin) + pos.unrealizedPnl;
        if (equity <= 0) return 0;

        uint256 notional = pos.size;
        if (notional == 0) return type(uint256).max;

        return (uint256(equity) * pos.leverage * 1e18) / notional;
    }

    /// @notice Free margin = collateral balance not locked in open positions.
    /// F-03 FIX: `collateralBalances` is ALREADY net of locked margin — both
    /// lockMargin() and _openPosition() do `collateralBalances -= x; lockedMargin += x`.
    /// The old code subtracted `lockedMargin` a second time, under-reporting free
    /// margin by the full locked amount. That blocked legitimate withdrawals and
    /// made _openPosition reject positions the trader could actually afford.
    function getFreeMargin(address trader) public view returns (uint256) {
        return collateralBalances[trader];
    }

    function computeLiquidationPrice(
        bool isLong,
        uint256 entryPrice,
        uint256 leverage
    ) external pure returns (uint256) {
        return _computeLiquidationPrice(isLong, entryPrice, leverage);
    }

    function getPosition(
        address trader
    ) external view returns (Position memory) {
        return positions[trader];
    }

    function getCollateralBalance(
        address trader
    ) external view returns (uint256) {
        return collateralBalances[trader];
    }

    function getLockedMargin(address trader) external view returns (uint256) {
        return lockedMargin[trader];
    }

    function getTrackedTraders() external view returns (address[] memory) {
        return trackedTraders;
    }

    function trackedTradersCount() external view returns (uint256) {
        return trackedTraders.length;
    }

    function trackedTraderAt(uint256 index) external view returns (address) {
        require(
            index < trackedTraders.length,
            "MarginVault: index out of bounds"
        );
        return trackedTraders[index];
    }

    // ============ Internal ============

    function _updatePnL(address trader, uint256 currentIndexPrice) internal {
        Position storage pos = positions[trader];
        if (!pos.isOpen) return;

        int256 priceDiff = pos.isLong
            ? int256Safe(currentIndexPrice) - int256Safe(pos.entryPrice)
            : int256Safe(pos.entryPrice) - int256Safe(currentIndexPrice);

        // size is USDC notional in 6-dec, prices are in 8-dec
        // PnL (6-dec USDC) = size * Δprice / entryPrice
        int256 pnl = (priceDiff * int256Safe(pos.size)) / int256Safe(pos.entryPrice);
        pos.unrealizedPnl = pnl;

        emit PnLUpdated(trader, pnl, marginHealth(trader));
    }

    function _computeLiquidationPrice(
        bool isLong,
        uint256 entryPrice,
        uint256 leverage
    ) internal pure returns (uint256) {
        require(leverage > 0, "MarginVault: leverage must be > 0");
        if (isLong) {
            uint256 base = (entryPrice * (leverage - 1)) / leverage;
            uint256 maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 1e18;
            return base + maint;
        } else {
            uint256 base = (entryPrice * (leverage + 1)) / leverage;
            uint256 maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 1e18;
            // base is always > maint for any sane leverage, but guard anyway
            require(base > maint, "MarginVault: short liq price underflow");
            return base - maint;
        }
    }

    function _openPosition(
        address trader,
        bool isLong,
        uint256 entryPrice,
        uint256 size,
        uint256 leverage
    ) internal {
        // size is already in USDC 6-dec (notional = size USDC)
        uint256 margin = size / leverage;

        // Verify trader has enough free collateral to back this margin
        require(
            getFreeMargin(trader) >= margin,
            "MarginVault: insufficient free margin for position"
        );

        // Lock the required margin
        collateralBalances[trader] -= margin;
        lockedMargin[trader] += margin;

        Position storage pos = positions[trader];
        pos.trader = trader;
        pos.isLong = isLong;
        pos.entryPrice = entryPrice;
        pos.size = size;
        pos.leverage = leverage;
        pos.margin = margin;
        pos.liquidationPrice = _computeLiquidationPrice(
            isLong,
            entryPrice,
            leverage
        );
        pos.unrealizedPnl = 0;
        pos.isOpen = true;

        if (!isTracked[trader]) {
            trackedTraders.push(trader);
            isTracked[trader] = true;
        }
    }

    function _removeTrader(address trader) internal {
        if (!isTracked[trader]) return;
        isTracked[trader] = false;
        uint256 len = trackedTraders.length;
        for (uint256 i = 0; i < len; i++) {
            if (trackedTraders[i] == trader) {
                trackedTraders[i] = trackedTraders[len - 1];
                trackedTraders.pop();
                break;
            }
        }
    }

    function int256Safe(uint256 value) internal pure returns (int256) {
        require(
            value <= uint256(type(int256).max),
            "MarginVault: uint256 overflow to int256"
        );
        return int256(value);
    }

    receive() external payable {}
}
