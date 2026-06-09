// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook, Order} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";
import {SentimentOracle} from "../oracles/SentimentOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EnhancedLiquidityProviderAgent — AI-augmented market maker
/// Extends the base LP Agent with sentiment and volatility data from
/// SentimentOracle (which uses all 3 Somnia Agents).
///
/// Spread formula:
///   effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier
///
/// sentimentMultiplier:
///   bullish → 0.8x  (tighten — confident in direction)
///   neutral → 1.0x  (normal)
///   bearish → 2.0x  (widen  — cautious, protect inventory)
contract EnhancedLiquidityProviderAgent {
    using SafeERC20 for IERC20;

    IOrderBook      public orderBook;
    IMarginVault    public marginVault;
    SentimentOracle public sentimentOracle;
    IERC20          public immutable collateralToken;  // MockUSDC on testnet
    address         public owner;

    // Configuration
    uint256 public spreadBps;
    uint256 public orderSizeUSDC;
    uint256 public rebalanceThreshold;
    uint256 public lastMidPrice;

    // Sentiment + Volatility from oracle
    // int16 instead of int8: sentimentMultiplierBps can reach ±1000 in future
    // extensions without silent overflow. Current range: -20 (bullish) to +100 (bearish).
    int16   public sentimentMultiplierBps;
    uint256 public lastVolatilityScore;

    // Active orders
    uint256 public activeBidOrderId;
    uint256 public activeAskOrderId;
    bool    public activeBidExists;
    bool    public activeAskExists;

    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "EnhancedLPAgent: not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "EnhancedLPAgent: paused");
        _;
    }

    event Rebalanced(uint256 midPrice, uint256 effectiveSpreadBps, int16 sentimentMultiplier, uint256 volatilityScore);
    event OrderPlaced(uint256 orderId, bool isBid, uint256 price);
    event SentimentReceived(string sentiment, int16 multiplierBps);
    event VolatilityReceived(uint256 score);

    /// @param _orderBook         BTC-USD OrderBook contract address
    /// @param _marginVault       MarginVault contract address
    /// @param _sentimentOracle   SentimentOracle contract address
    /// @param _collateralToken   ERC-20 collateral token (MockUSDC on testnet)
    constructor(
        address _orderBook,
        address _marginVault,
        address payable _sentimentOracle,
        address _collateralToken
    ) {
        require(_collateralToken != address(0), "EnhancedLPAgent: zero token address");
        orderBook       = IOrderBook(_orderBook);
        marginVault     = IMarginVault(_marginVault);
        sentimentOracle = SentimentOracle(_sentimentOracle);
        collateralToken = IERC20(_collateralToken);
        owner           = msg.sender;
        rebalanceThreshold = 100; // 1% = 100 bps
    }

    /// @notice Initialize with parameters and place first orders.
    ///         The agent contract must hold enough collateralToken before this is called.
    function initialize(
        uint256 _spreadBps,
        uint256 _orderSizeUSDC,
        uint256 initialMidPrice
    ) external onlyOwner {
        require(_spreadBps > 0 && _spreadBps < 5000, "EnhancedLPAgent: invalid spread");
        require(_orderSizeUSDC > 0, "EnhancedLPAgent: invalid size");

        spreadBps    = _spreadBps;
        orderSizeUSDC = _orderSizeUSDC;
        lastMidPrice = initialMidPrice;

        uint256 depositAmount = _orderSizeUSDC * 10;

        // Approve vault to pull collateral from this contract, then deposit.
        collateralToken.forceApprove(address(marginVault), depositAmount);
        marginVault.deposit(depositAmount);

        _placeOrders(initialMidPrice);
    }

    /// @notice Rebalance based on price movement + AI sentiment/volatility.
    ///         Called reactively via AgentInterface — price from event data.
    function rebalance(uint256 currentIndexPrice) external notPaused {
        if (lastMidPrice > 0) {
            uint256 priceMoveBps = _computePriceMoveBps(lastMidPrice, currentIndexPrice);
            if (priceMoveBps < rebalanceThreshold) return;
        }

        _refreshOracleData();

        if (activeBidExists) {
            Order memory bidOrder = orderBook.getOrder(activeBidOrderId);
            if (uint(bidOrder.status) == 0 || uint(bidOrder.status) == 1) { // OPEN or PARTIALLY_FILLED
                orderBook.cancelOrder(activeBidOrderId);
            }
            activeBidExists = false;
        }
        if (activeAskExists) {
            Order memory askOrder = orderBook.getOrder(activeAskOrderId);
            if (uint(askOrder.status) == 0 || uint(askOrder.status) == 1) { // OPEN or PARTIALLY_FILLED
                orderBook.cancelOrder(activeAskOrderId);
            }
            activeAskExists = false;
        }

        uint256 effectiveSpread = _computeEffectiveSpread();
        _placeOrdersWithSpread(currentIndexPrice, effectiveSpread);
        lastMidPrice = currentIndexPrice;

        emit Rebalanced(currentIndexPrice, effectiveSpread, sentimentMultiplierBps, lastVolatilityScore);
    }

    /// @notice Called by AgentInterface when SentimentOracle publishes new sentiment.
    function onSentimentUpdate(string calldata newSentiment) external {
        sentimentMultiplierBps = _sentimentToMultiplier(newSentiment);
        emit SentimentReceived(newSentiment, sentimentMultiplierBps);
    }

    /// @notice Called by AgentInterface when SentimentOracle publishes new volatility.
    function onVolatilityUpdate(uint256 score) external {
        lastVolatilityScore = score;
        emit VolatilityReceived(score);
    }

    function pause()   external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }

    function setRebalanceThreshold(uint256 thresholdBps) external onlyOwner {
        rebalanceThreshold = thresholdBps;
    }

    function setSpreadBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps < 5000, "EnhancedLPAgent: invalid spread");
        spreadBps = bps;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _placeOrders(uint256 midPrice) internal {
        _placeOrdersWithSpread(midPrice, _computeEffectiveSpread());
    }

    function _placeOrdersWithSpread(uint256 midPrice, uint256 effectiveSpreadBps) internal {
        uint256 bidPrice = (midPrice * (10000 - effectiveSpreadBps)) / 10000;
        uint256 askPrice = (midPrice * (10000 + effectiveSpreadBps)) / 10000;
        require(bidPrice > 0, "EnhancedLPAgent: bid price too low");

        uint256 bidId = orderBook.placeOrder(true,  bidPrice, orderSizeUSDC, 1);
        activeBidOrderId = bidId;
        activeBidExists  = true;
        emit OrderPlaced(bidId, true, bidPrice);

        uint256 askId = orderBook.placeOrder(false, askPrice, orderSizeUSDC, 1);
        activeAskOrderId = askId;
        activeAskExists  = true;
        emit OrderPlaced(askId, false, askPrice);
    }

    /// @dev effectiveSpread = baseSpread × (1 + volScore/100) × sentimentMultiplier
    function _computeEffectiveSpread() internal view returns (uint256) {
        // Volatility component
        uint256 volAdjusted = (spreadBps * (100 + lastVolatilityScore)) / 100;

        // Sentiment component: factor = (1000 + sentimentMultiplierBps) / 1000
        // bullish (-20) → 980/1000 = 0.98x
        // neutral (  0) → 1000/1000 = 1.0x
        // bearish (+100) → 1100/1000 = 1.1x
        int256 sentimentFactor = 1000 + int256(sentimentMultiplierBps);
        require(sentimentFactor > 0, "EnhancedLPAgent: invalid sentiment factor");

        return (volAdjusted * uint256(sentimentFactor)) / 1000;
    }

    function _refreshOracleData() internal {
        string memory sent     = sentimentOracle.sentiment();
        sentimentMultiplierBps = _sentimentToMultiplier(sent);
        lastVolatilityScore    = sentimentOracle.volatilityScore();
    }

    /// @dev Centralised string→multiplier conversion — used in both push and pull paths.
    function _sentimentToMultiplier(string memory sent) internal pure returns (int16) {
        bytes32 h = keccak256(bytes(sent));
        if (h == keccak256(bytes("bullish"))) return -20;
        if (h == keccak256(bytes("bearish"))) return 100;
        return 0; // neutral
    }

    function _computePriceMoveBps(
        uint256 oldPrice,
        uint256 newPrice
    ) internal pure returns (uint256) {
        if (oldPrice == 0) return 0;
        uint256 diff = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
        return (diff * 10000) / oldPrice;
    }
}
