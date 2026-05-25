// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title LiquidityProviderAgent — Autonomous LP placing two-sided limit orders
/// Places and continuously rebalances bid/ask orders around the current index price.
contract LiquidityProviderAgent {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    address public owner;

    // Configuration
    uint256 public spreadBps;           // e.g., 20 = 0.20% spread
    uint256 public orderSizeUSDC;       // Notional size per side (18 decimals)
    uint256 public rebalanceThreshold;  // Price move % (in bps) that triggers rebalance
    uint256 public lastMidPrice;

    // Active orders
    uint256 public activeBidOrderId;
    uint256 public activeAskOrderId;
    bool public activeBidExists;
    bool public activeAskExists;

    // Volatility tracking
    uint256[] public recentPrices;
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

    constructor(address _orderBook, address _marginVault) {
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
        rebalanceThreshold = 100; // 1% = 100 bps
    }

    /// @notice Initialize the LP agent with parameters and place first orders
    function initialize(uint256 _spreadBps, uint256 _orderSizeUSDC, uint256 initialMidPrice)
        external onlyOwner
    {
        require(_spreadBps > 0 && _spreadBps < 5000, "LPAgent: invalid spread");
        require(_orderSizeUSDC > 0, "LPAgent: invalid size");

        spreadBps = _spreadBps;
        orderSizeUSDC = _orderSizeUSDC;
        lastMidPrice = initialMidPrice;

        // Deposit initial capital
        marginVault.deposit(_orderSizeUSDC * 2);

        _placeOrders(initialMidPrice);
    }

    /// @notice Rebalance orders based on new index price
    /// Called reactively via AgentInterface on price updates
    function rebalance(uint256 currentIndexPrice) external notPaused {
        // Check if price moved beyond threshold
        if (lastMidPrice > 0) {
            uint256 priceMoveBps = _computePriceMoveBps(lastMidPrice, currentIndexPrice);
            if (priceMoveBps < rebalanceThreshold) return;
        }

        // Adjust spread based on volatility
        uint256 volatilityScore = _computeVolatility();
        uint256 adjustedSpread = spreadBps;
        if (volatilityScore > 100) {
            adjustedSpread = spreadBps * 2; // Double spread during high volatility
        }

        // Cancel old orders
        if (activeBidExists) {
            orderBook.cancelOrder(activeBidOrderId);
            activeBidExists = false;
        }
        if (activeAskExists) {
            orderBook.cancelOrder(activeAskOrderId);
            activeAskExists = false;
        }

        // Place new orders
        _placeOrdersWithSpread(currentIndexPrice, adjustedSpread);
        lastMidPrice = currentIndexPrice;

        emit Rebalanced(currentIndexPrice, adjustedSpread);
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

    event Rebalanced(uint256 midPrice, uint256 spreadBps);
    event OrderPlaced(uint256 orderId, bool isBid, uint256 price);

    // ============ Internal Functions ============

    function _placeOrders(uint256 midPrice) internal {
        _placeOrdersWithSpread(midPrice, spreadBps);
    }

    function _placeOrdersWithSpread(uint256 midPrice, uint256 currentSpreadBps) internal {
        uint256 bidPrice = (midPrice * (10000 - currentSpreadBps)) / 10000;
        uint256 askPrice = (midPrice * (10000 + currentSpreadBps)) / 10000;

        require(bidPrice > 0, "LPAgent: bid price too low");

        // Place bid
        uint256 bidId = orderBook.placeOrder(true, bidPrice, orderSizeUSDC, 1);
        activeBidOrderId = bidId;
        activeBidExists = true;
        emit OrderPlaced(bidId, true, bidPrice);

        // Place ask
        uint256 askId = orderBook.placeOrder(false, askPrice, orderSizeUSDC, 1);
        activeAskOrderId = askId;
        activeAskExists = true;
        emit OrderPlaced(askId, false, askPrice);
    }

    function _computePriceMoveBps(uint256 oldPrice, uint256 newPrice) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        uint256 diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
        return (diff * 10000) / oldPrice;
    }

    function _computeVolatility() internal view returns (uint256) {
        if (recentPrices.length < VOLATILITY_WINDOW) return 0;

        uint256 totalMove = 0;
        for (uint256 i = 1; i < recentPrices.length; i++) {
            uint256 move = _computePriceMoveBps(recentPrices[i - 1], recentPrices[i]);
            totalMove += move;
        }

        return totalMove / (recentPrices.length - 1);
    }

    function recordPrice(uint256 price) external {
        recentPrices.push(price);
        if (recentPrices.length > VOLATILITY_WINDOW) {
            // Shift array (simplified — in production use circular buffer)
            for (uint256 i = 0; i < recentPrices.length - 1; i++) {
                recentPrices[i] = recentPrices[i + 1];
            }
            recentPrices.pop();
        }
    }
}
