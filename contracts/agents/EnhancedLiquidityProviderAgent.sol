// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";
import {SentimentOracle} from "../oracles/SentimentOracle.sol";

/// @title EnhancedLiquidityProviderAgent — AI-augmented market maker
/// Extends the base LP Agent with sentiment and volatility data from
/// SentimentOracle (which uses all 3 Somnia Agents).
///
/// Spread formula:
///   effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier
///
/// sentimentMultiplier:
///   bullish → 0.8x (tighten, confident)
///   neutral → 1.0x (normal)
///   bearish → 2.0x (widen, cautious)
contract EnhancedLiquidityProviderAgent {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    SentimentOracle public sentimentOracle;
    address public owner;

    // Configuration
    uint256 public spreadBps;           // Base spread (e.g., 20 = 0.20%)
    uint256 public orderSizeUSDC;       // Notional size per side
    uint256 public rebalanceThreshold;  // Price move % (bps) that triggers rebalance
    uint256 public lastMidPrice;

    // Sentiment + Volatility from oracle
    int8 public sentimentMultiplierBps;  // -20 = bullish (0.8x), 0 = neutral (1.0x), +100 = bearish (2.0x)
    uint256 public lastVolatilityScore;

    // Active orders
    uint256 public activeBidOrderId;
    uint256 public activeAskOrderId;
    bool public activeBidExists;
    bool public activeAskExists;

    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "EnhancedLPAgent: not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "EnhancedLPAgent: paused");
        _;
    }

    constructor(address _orderBook, address _marginVault, address payable _sentimentOracle) {
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        sentimentOracle = SentimentOracle(_sentimentOracle);
        owner = msg.sender;
        rebalanceThreshold = 100; // 1% = 100 bps
    }

    /// @notice Initialize the LP agent with parameters
    function initialize(uint256 _spreadBps, uint256 _orderSizeUSDC, uint256 initialMidPrice)
        external onlyOwner
    {
        require(_spreadBps > 0 && _spreadBps < 5000, "EnhancedLPAgent: invalid spread");
        require(_orderSizeUSDC > 0, "EnhancedLPAgent: invalid size");

        spreadBps = _spreadBps;
        orderSizeUSDC = _orderSizeUSDC;
        lastMidPrice = initialMidPrice;

        marginVault.deposit(_orderSizeUSDC * 2);
        _placeOrders(initialMidPrice);
    }

    /// @notice Rebalance based on price movement + AI sentiment/volatility
    function rebalance(uint256 currentIndexPrice) external notPaused {
        // Check price movement threshold
        if (lastMidPrice > 0) {
            uint256 priceMoveBps = _computePriceMoveBps(lastMidPrice, currentIndexPrice);
            if (priceMoveBps < rebalanceThreshold) return;
        }

        // Read sentiment and volatility from oracle
        _refreshOracleData();

        // Cancel old orders
        if (activeBidExists) {
            orderBook.cancelOrder(activeBidOrderId);
            activeBidExists = false;
        }
        if (activeAskExists) {
            orderBook.cancelOrder(activeAskOrderId);
            activeAskExists = false;
        }

        // Place new orders with AI-adjusted spread
        uint256 effectiveSpread = _computeEffectiveSpread();
        _placeOrdersWithSpread(currentIndexPrice, effectiveSpread);
        lastMidPrice = currentIndexPrice;

        emit Rebalanced(currentIndexPrice, effectiveSpread, sentimentMultiplierBps, lastVolatilityScore);
    }

    /// @notice Called when SentimentOracle publishes new sentiment
    function onSentimentUpdate(string calldata newSentiment) external {
        if (keccak256(bytes(newSentiment)) == keccak256(bytes("bullish"))) {
            sentimentMultiplierBps = -20; // 0.8x
        } else if (keccak256(bytes(newSentiment)) == keccak256(bytes("bearish"))) {
            sentimentMultiplierBps = 100; // 2.0x
        } else {
            sentimentMultiplierBps = 0; // 1.0x (neutral)
        }

        emit SentimentReceived(newSentiment, sentimentMultiplierBps);
    }

    /// @notice Called when SentimentOracle publishes new volatility score
    function onVolatilityUpdate(uint256 score) external {
        lastVolatilityScore = score;
        emit VolatilityReceived(score);
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
        require(bps > 0 && bps < 5000, "EnhancedLPAgent: invalid spread");
        spreadBps = bps;
    }

    event Rebalanced(uint256 midPrice, uint256 effectiveSpreadBps, int8 sentimentMultiplier, uint256 volatilityScore);
    event OrderPlaced(uint256 orderId, bool isBid, uint256 price);
    event SentimentReceived(string sentiment, int8 multiplierBps);
    event VolatilityReceived(uint256 score);

    // ============ Internal Functions ============

    function _placeOrders(uint256 midPrice) internal {
        uint256 effectiveSpread = _computeEffectiveSpread();
        _placeOrdersWithSpread(midPrice, effectiveSpread);
    }

    function _placeOrdersWithSpread(uint256 midPrice, uint256 effectiveSpreadBps) internal {
        uint256 bidPrice = (midPrice * (10000 - effectiveSpreadBps)) / 10000;
        uint256 askPrice = (midPrice * (10000 + effectiveSpreadBps)) / 10000;

        require(bidPrice > 0, "EnhancedLPAgent: bid price too low");

        uint256 bidId = orderBook.placeOrder(true, bidPrice, orderSizeUSDC, 1);
        activeBidOrderId = bidId;
        activeBidExists = true;
        emit OrderPlaced(bidId, true, bidPrice);

        uint256 askId = orderBook.placeOrder(false, askPrice, orderSizeUSDC, 1);
        activeAskOrderId = askId;
        activeAskExists = true;
        emit OrderPlaced(askId, false, askPrice);
    }

    /// @notice Compute AI-augmented spread
    /// effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier
    function _computeEffectiveSpread() internal view returns (uint256) {
        // Volatility component: baseSpread × (1 + volScore/100)
        uint256 volAdjusted = (spreadBps * (100 + lastVolatilityScore)) / 100;

        // Sentiment component: multiply by (1 + sentimentMultiplierBps/1000)
        // bullish (-20) → × 0.98, neutral (0) → × 1.0, bearish (+100) → × 1.1
        int256 sentimentFactor = 1000 + int256(sentimentMultiplierBps);
        require(sentimentFactor > 0, "EnhancedLPAgent: invalid sentiment factor");

        return (volAdjusted * uint256(sentimentFactor)) / 1000;
    }

    function _refreshOracleData() internal {
        // Read latest sentiment from oracle (convert string to multiplier)
        string memory sent = sentimentOracle.sentiment();
        if (keccak256(bytes(sent)) == keccak256(bytes("bullish"))) {
            sentimentMultiplierBps = -20;
        } else if (keccak256(bytes(sent)) == keccak256(bytes("bearish"))) {
            sentimentMultiplierBps = 100;
        } else {
            sentimentMultiplierBps = 0;
        }

        lastVolatilityScore = sentimentOracle.volatilityScore();
    }

    function _computePriceMoveBps(uint256 oldPrice, uint256 newPrice) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        uint256 diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
        return (diff * 10000) / oldPrice;
    }
}
