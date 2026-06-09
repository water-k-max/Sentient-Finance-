// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook, Order} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LiquidityProviderAgent — Autonomous LP placing two-sided limit orders
/// Places and continuously rebalances bid/ask orders around the current index price.
contract LiquidityProviderAgent {
    using SafeERC20 for IERC20;

    IOrderBook public orderBook;
    IMarginVault public marginVault;
    IERC20 public immutable collateralToken; // MockUSDC on testnet
    address public owner;

    // Configuration
    uint256 public spreadBps;
    uint256 public orderSizeUSDC;
    uint256 public rebalanceThreshold; // bps price move that triggers rebalance
    uint256 public lastMidPrice;

    // Active orders
    uint256 public activeBidOrderId;
    uint256 public activeAskOrderId;
    bool public activeBidExists;
    bool public activeAskExists;

    // Volatility tracking — circular buffer (no O(n) shift)
    uint256[5] public recentPrices;
    uint256 public priceIndex; // next write position
    uint256 public priceCount; // how many entries filled (max 5)
    uint256 public constant VOLATILITY_WINDOW = 5;

    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "LPAgent: not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "LPAgent: paused");
        _;
    }

    event Rebalanced(uint256 midPrice, uint256 spreadBps);
    event OrderPlaced(uint256 orderId, bool isBid, uint256 price);

    /// @param _orderBook       BTC-USD OrderBook contract address
    /// @param _marginVault     MarginVault contract address
    /// @param _collateralToken ERC-20 collateral token (MockUSDC on testnet)
    constructor(
        address _orderBook,
        address _marginVault,
        address _collateralToken
    ) {
        require(_collateralToken != address(0), "LPAgent: zero token address");
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        collateralToken = IERC20(_collateralToken);
        owner = msg.sender;
        rebalanceThreshold = 100; // 1% = 100 bps
    }

    /// @notice Initialize the LP agent with parameters and place first orders.
    ///         The agent contract must hold enough collateralToken before this is called.
    ///         Deploy script mints USDC directly to this contract address first.
    function initialize(
        uint256 _spreadBps,
        uint256 _orderSizeUSDC,
        uint256 initialMidPrice
    ) external onlyOwner {
        require(_spreadBps > 0 && _spreadBps < 5000, "LPAgent: invalid spread");
        require(_orderSizeUSDC > 0, "LPAgent: invalid size");

        spreadBps = _spreadBps;
        orderSizeUSDC = _orderSizeUSDC;
        lastMidPrice = initialMidPrice;

        uint256 depositAmount = _orderSizeUSDC * 10;

        // Approve vault to pull collateral from this contract, then deposit.
        // MarginVault.deposit() calls transferFrom(msg.sender = this contract).
        collateralToken.forceApprove(address(marginVault), depositAmount);
        marginVault.deposit(depositAmount);

        _placeOrders(initialMidPrice);
    }

    /// @notice Rebalance orders on price update.
    ///         Called reactively via AgentInterface — price from event data, not oracle fetch.
    function rebalance(uint256 currentIndexPrice) external notPaused {
        if (lastMidPrice > 0) {
            uint256 priceMoveBps = _computePriceMoveBps(
                lastMidPrice,
                currentIndexPrice
            );
            if (priceMoveBps < rebalanceThreshold) return;
        }

        uint256 volatilityScore = _computeVolatility();
        uint256 adjustedSpread = volatilityScore > 100
            ? spreadBps * 2
            : spreadBps;

        if (activeBidExists) {
            Order memory bidOrder = orderBook.getOrder(activeBidOrderId);
            if (uint(bidOrder.status) == 0 || uint(bidOrder.status) == 2) {
                // OPEN or PARTIALLY_FILLED
                orderBook.cancelOrder(activeBidOrderId);
            }
            activeBidExists = false;
        }
        if (activeAskExists) {
            Order memory askOrder = orderBook.getOrder(activeAskOrderId);
            if (uint(askOrder.status) == 0 || uint(askOrder.status) == 2) {
                // OPEN or PARTIALLY_FILLED
                orderBook.cancelOrder(activeAskOrderId);
            }
            activeAskExists = false;
        }

        _placeOrdersWithSpread(currentIndexPrice, adjustedSpread);
        lastMidPrice = currentIndexPrice;

        emit Rebalanced(currentIndexPrice, adjustedSpread);
    }

    /// @notice Record a price observation for volatility tracking.
    ///         Uses a fixed-size circular buffer — no array shifting, O(1).
    function recordPrice(uint256 price) external {
        recentPrices[priceIndex % VOLATILITY_WINDOW] = price;
        priceIndex++;
        if (priceCount < VOLATILITY_WINDOW) priceCount++;
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function setRebalanceThreshold(uint256 thresholdBps) external onlyOwner {
        rebalanceThreshold = thresholdBps;
    }

    function setSpreadBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps < 5000, "LPAgent: invalid spread");
        spreadBps = bps;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _placeOrders(uint256 midPrice) internal {
        _placeOrdersWithSpread(midPrice, spreadBps);
    }

    function _placeOrdersWithSpread(
        uint256 midPrice,
        uint256 currentSpreadBps
    ) internal {
        uint256 bidPrice = (midPrice * (10000 - currentSpreadBps)) / 10000;
        uint256 askPrice = (midPrice * (10000 + currentSpreadBps)) / 10000;
        require(bidPrice > 0, "LPAgent: bid price too low");

        uint256 bidId = orderBook.placeOrder(true, bidPrice, orderSizeUSDC, 1);
        activeBidOrderId = bidId;
        activeBidExists = true;
        emit OrderPlaced(bidId, true, bidPrice);

        uint256 askId = orderBook.placeOrder(false, askPrice, orderSizeUSDC, 1);
        activeAskOrderId = askId;
        activeAskExists = true;
        emit OrderPlaced(askId, false, askPrice);
    }

    function _computePriceMoveBps(
        uint256 oldPrice,
        uint256 newPrice
    ) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        uint256 diff = newPrice > oldPrice
            ? newPrice - oldPrice
            : oldPrice - newPrice;
        return (diff * 10000) / oldPrice;
    }

    /// @dev Circular buffer volatility — average absolute move over last N prices.
    function _computeVolatility() internal view returns (uint256) {
        if (priceCount < 2) return 0;
        uint256 totalMove = 0;
        uint256 n = priceCount; // min(priceCount, VOLATILITY_WINDOW)
        for (uint256 i = 1; i < n; i++) {
            uint256 prev = recentPrices[
                (priceIndex - n + i - 1) % VOLATILITY_WINDOW
            ];
            uint256 curr = recentPrices[
                (priceIndex - n + i) % VOLATILITY_WINDOW
            ];
            totalMove += _computePriceMoveBps(prev, curr);
        }
        return totalMove / (n - 1);
    }
}
