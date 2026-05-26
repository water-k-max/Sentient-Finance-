// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";
import {SentimentOracle} from "../oracles/SentimentOracle.sol";

/// @title AgentInterface — Reactive gateway for Somnia's event-driven execution
/// Subscribes to events from OrderBook, OracleAdapter, and SentimentOracle.
/// Dispatches matching, liquidation, LP rebalance, AND AI sentiment analysis
/// autonomously — no external caller needed.
contract AgentInterface {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    address public liquidationSentinel;
    address public liquidityProviderAgent;
    address public enhancedLpAgent;
    address public sentimentOracle;
    address public oracleAdapter;
    address public owner;

    bytes32 public constant PRICE_UPDATED_TOPIC = keccak256("PriceUpdated(bytes32,uint256,uint256)");
    bytes32 public constant ORDER_PLACED_TOPIC = keccak256("OrderPlaced(uint256,address,bool,uint256,uint256)");

    // Subscribed event sources
    mapping(address => mapping(bytes32 => bool)) public subscriptions;

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentInterface: not owner");
        _;
    }

    modifier onlySomniaReactive() {
        require(msg.sender == owner, "AgentInterface: not authorized");
        _;
    }

    constructor(
        address _orderBook,
        address _marginVault,
        address _liquidationSentinel,
        address _liquidityProviderAgent,
        address _oracleAdapter
    ) {
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        liquidationSentinel = _liquidationSentinel;
        liquidityProviderAgent = _liquidityProviderAgent;
        oracleAdapter = _oracleAdapter;
        owner = msg.sender;
    }

    /// @notice Set SentimentOracle and Enhanced LP Agent addresses
    function setSentimentContracts(address _sentimentOracle, address _enhancedLpAgent) external onlyOwner {
        sentimentOracle = _sentimentOracle;
        enhancedLpAgent = _enhancedLpAgent;
    }

    /// @notice Subscribe to an event from a contract
    function subscribe(address contractAddress, bytes32 eventTopic) external onlyOwner {
        subscriptions[contractAddress][eventTopic] = true;
    }

    /// @notice Called by Somnia's reactive layer when a subscribed event fires
    function onEvent(address source, bytes32 topic, bytes calldata data) external onlySomniaReactive {
        require(subscriptions[source][topic], "AgentInterface: not subscribed");

        if (topic == PRICE_UPDATED_TOPIC) {
            (, uint256 newPrice) = abi.decode(data, (bytes32, uint256));
            marginVault.updateAllPnL(newPrice);
            _triggerSentinel(newPrice);
            _triggerLPRebalance(newPrice);
            _triggerEnhancedLPRebalance(newPrice);
            _triggerSentimentAnalysis(newPrice);
        }

        if (topic == ORDER_PLACED_TOPIC) {
            orderBook.attemptMatch();
        }
    }

    /// @notice Simulate reactive flow (for testing/demo)
    function simulateOrderPlaced() external {
        orderBook.attemptMatch();
    }

    /// @notice Simulate price update reactive flow
    function simulatePriceUpdate(uint256 newPrice) external {
        marginVault.updateAllPnL(newPrice);
        _triggerSentinel(newPrice);
        _triggerLPRebalance(newPrice);
        _triggerEnhancedLPRebalance(newPrice);
        _triggerSentimentAnalysis(newPrice);
    }

    // ============ Internal Triggers ============

    function _triggerSentinel(uint256 currentPrice) internal {
        ILiquidationSentinel(liquidationSentinel).checkAllPositions(currentPrice);
    }

    function _triggerLPRebalance(uint256 currentPrice) internal {
        ILiquidityProviderAgent(liquidityProviderAgent).rebalance(currentPrice);
    }

    function _triggerEnhancedLPRebalance(uint256 currentPrice) internal {
        if (enhancedLpAgent != address(0)) {
            IEnhancedLPAgent(enhancedLpAgent).rebalance(currentPrice);
        }
    }

    function _triggerSentimentAnalysis(uint256 currentPrice) internal {
        if (sentimentOracle != address(0)) {
            // Trigger sentiment analysis on price updates
            // In production, this would be a Somnia Agent call
            emit SentimentAnalysisTriggered(currentPrice);
        }
    }

    event SentinelTriggered(uint256 currentPrice);
    event LPRebalanceTriggered(uint256 currentPrice);
    event SentimentAnalysisTriggered(uint256 currentPrice);
}

// ============ Minimal Interfaces ============

interface ILiquidationSentinel {
    function checkAllPositions(uint256 currentPrice) external;
}

interface ILiquidityProviderAgent {
    function rebalance(uint256 currentIndexPrice) external;
}

interface IEnhancedLPAgent {
    function rebalance(uint256 currentIndexPrice) external;
}
