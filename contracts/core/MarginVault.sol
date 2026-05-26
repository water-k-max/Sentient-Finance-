// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Position, IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title MarginVault — Clearinghouse for perpetual swap collateral, positions, and margin enforcement
contract MarginVault is IMarginVault {
    // ============ State ============

    mapping(address => uint256) public collateralBalances;
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

    constructor() {
        owner = msg.sender;
    }

    // ============ External Functions ============

    function setAuthorized(address _addr, bool _authorized) external onlyOwner {
        authorized[_addr] = _authorized;
    }

    function isAuthorized(address _addr) external view returns (bool) {
        return authorized[_addr];
    }

    /// @notice Deposit USDC collateral into the vault
    function deposit(uint256 amount) external {
        require(amount > 0, "MarginVault: amount must be > 0");
        collateralBalances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw free collateral (not locked in a position)
    function withdraw(uint256 amount) external {
        require(amount > 0, "MarginVault: amount must be > 0");
        uint256 freeMargin = getFreeMargin(msg.sender);
        require(freeMargin >= amount, "MarginVault: insufficient free margin");
        collateralBalances[msg.sender] -= amount;
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Lock margin for an order placement (called by OrderBook)
    function lockMargin(address trader, uint256 amount) external onlyAuthorized {
        require(collateralBalances[trader] >= amount, "MarginVault: insufficient balance");
        collateralBalances[trader] -= amount;
        // Margin is considered locked in the Position struct, tracked via margin field
    }

    /// @notice Release margin back to collateral (called on cancel/close)
    function releaseMargin(address trader, uint256 amount) external onlyAuthorized {
        collateralBalances[trader] += amount;
    }

    /// @notice Settle a matched position for both counterparties
    function settlePosition(
        address longTrader,
        address shortTrader,
        uint256 fillPrice,
        uint256 fillSize,
        uint256 longLeverage,
        uint256 shortLeverage
    ) external onlyAuthorized {
        _openPosition(longTrader, true, fillPrice, fillSize, longLeverage);
        _openPosition(shortTrader, false, fillPrice, fillSize, shortLeverage);
        emit PositionSettled(longTrader, shortTrader, fillPrice, fillSize);
    }

    /// @notice Get margin health factor for a position (1e18 = 100%)
    function marginHealth(address trader) public view returns (uint256) {
        Position memory pos = positions[trader];
        if (!pos.isOpen || pos.size == 0) return type(uint256).max;

        int256 equity = int256Safe(pos.margin) + pos.unrealizedPnl;
        if (equity <= 0) return 0;

        uint256 notional = (pos.size * pos.entryPrice) / 1e18;
        if (notional == 0) return type(uint256).max;
        return (uint256(equity) * pos.leverage * 1e18) / notional;
    }

    /// @notice Update unrealized PnL for a single position
    function updatePnL(address trader, uint256 currentIndexPrice) external {
        _updatePnL(trader, currentIndexPrice);
    }

    /// @notice Internal PnL update
    function _updatePnL(address trader, uint256 currentIndexPrice) internal {
        Position storage pos = positions[trader];
        if (!pos.isOpen) return;

        int256 pnl;
        if (pos.isLong) {
            pnl = int256(int256Safe(currentIndexPrice) - int256Safe(pos.entryPrice)) * int256Safe(pos.size) / 1e8;
        } else {
            pnl = int256(int256Safe(pos.entryPrice) - int256Safe(currentIndexPrice)) * int256Safe(pos.size) / 1e8;
        }
        pos.unrealizedPnl = pnl;

        uint256 health = marginHealth(trader);
        emit PnLUpdated(trader, pnl, health);
    }

    /// @notice Batch PnL update for a subset of traders — O(k) instead of O(n)
    function updatePnLBatch(address[] calldata traders, uint256 currentIndexPrice) external {
        for (uint256 i = 0; i < traders.length; i++) {
            _updatePnL(traders[i], currentIndexPrice);
        }
    }

    /// @notice Update PnL for all tracked positions (called by reactive agent)
    function updateAllPnL(uint256 currentIndexPrice) external {
        for (uint256 i = 0; i < trackedTraders.length; i++) {
            address trader = trackedTraders[i];
            if (positions[trader].isOpen) {
                _updatePnL(trader, currentIndexPrice);
            }
        }
    }

    /// @notice Liquidate an undercollateralized position (only Sentinel)
    function liquidate(address trader) external onlyAuthorized {
        Position storage pos = positions[trader];
        require(pos.isOpen, "MarginVault: no open position");
        require(marginHealth(trader) < MAINTENANCE_MARGIN_RATIO, "MarginVault: position healthy");

        uint256 remainingMargin = pos.margin;
        // Distribute remaining margin: 50% to insurance fund (simplified: keep in vault)
        // In production, would have a dedicated insurance fund address
        pos.isOpen = false;
        pos.size = 0;
        pos.margin = 0;

        _removeTrader(trader);
        emit LiquidationExecuted(trader, pos.liquidationPrice, remainingMargin);
    }

    /// @notice Compute the liquidation price for a position (external wrapper)
    function computeLiquidationPrice(
        bool isLong,
        uint256 entryPrice,
        uint256 leverage
    ) external pure returns (uint256) {
        return _computeLiquidationPrice(isLong, entryPrice, leverage);
    }

    function getPosition(address trader) external view returns (Position memory) {
        return positions[trader];
    }

    function getCollateralBalance(address trader) external view returns (uint256) {
        return collateralBalances[trader];
    }

    function getTrackedTraders() external view returns (address[] memory) {
        return trackedTraders;
    }

    function trackedTradersCount() external view returns (uint256) {
        return trackedTraders.length;
    }

    function trackedTraderAt(uint256 index) external view returns (address) {
        require(index < trackedTraders.length, "MarginVault: index out of bounds");
        return trackedTraders[index];
    }

    // ============ Internal Functions ============

    /// @notice Compute the liquidation price for a position
    /// Prices are in 8-decimal fixed point (1e8 = $1.00)
    function _computeLiquidationPrice(
        bool isLong,
        uint256 entryPrice,
        uint256 leverage
    ) internal pure returns (uint256) {
        require(leverage > 0, "MarginVault: leverage must be > 0");
        // MAINTENANCE_MARGIN_RATIO is 5e16 (= 5%)
        if (isLong) {
            // entryPrice * (1 - 1/leverage + maintRatio) = entryPrice * (leverage - 1) / leverage + entryPrice * maintRatio / 1e18
            uint256 base = (entryPrice * (leverage - 1)) / leverage;
            uint256 maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 1e18;
            return base + maint;
        } else {
            uint256 base = (entryPrice * (leverage + 1)) / leverage;
            uint256 maint = (entryPrice * MAINTENANCE_MARGIN_RATIO) / 1e18;
            unchecked {
                return base - maint;
            }
        }
    }

    function getFreeMargin(address trader) internal view returns (uint256) {
        Position memory pos = positions[trader];
        if (!pos.isOpen) return collateralBalances[trader];
        return collateralBalances[trader];
    }

    function _openPosition(
        address trader,
        bool isLong,
        uint256 entryPrice,
        uint256 size,
        uint256 leverage
    ) internal {
        Position storage pos = positions[trader];
        // Compute margin from the notional: (size * entryPrice / 1e18) / leverage
        uint256 notional = (size * entryPrice) / 1e18;
        pos.margin = notional / leverage;
        pos.trader = trader;
        pos.isLong = isLong;
        pos.entryPrice = entryPrice;
        pos.size = size;
        pos.leverage = leverage;
        pos.liquidationPrice = _computeLiquidationPrice(isLong, entryPrice, leverage);
        pos.isOpen = true;

        if (!isTracked[trader]) {
            trackedTraders.push(trader);
            isTracked[trader] = true;
        }
    }

    function _removeTrader(address trader) internal {
        if (!isTracked[trader]) return;
        isTracked[trader] = false;

        for (uint256 i = 0; i < trackedTraders.length; i++) {
            if (trackedTraders[i] == trader) {
                trackedTraders[i] = trackedTraders[trackedTraders.length - 1];
                trackedTraders.pop();
                break;
            }
        }
    }

    function int256Safe(uint256 value) internal pure returns (int256) {
        require(value <= uint256(type(int256).max), "MarginVault: overflow");
        return int256(value);
    }

    // Allow vault to receive native tokens (for rebates, insurance fund)
    receive() external payable {}
}
