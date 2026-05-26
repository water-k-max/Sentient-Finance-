// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title AgentInterface — Reactive gateway for Somnia's event-driven execution
/// Subscribes to events from OrderBook and OracleAdapter and autonomously
/// dispatches execution without any external caller.
contract AgentInterface {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    address public liquidationSentinel;
    address public liquidityProviderAgent;
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
        // In production, this would verify the caller is Somnia's reactive layer
        // For hackathon, onlyOwner is sufficient
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

    /// @notice Subscribe to an event from a contract
    function subscribe(address contractAddress, bytes32 eventTopic) external onlyOwner {
        subscriptions[contractAddress][eventTopic] = true;
    }

    /// @notice Called by Somnia's reactive layer when a subscribed event fires
    /// This is the core of the "self-driving" perpetual engine
    function onEvent(address source, bytes32 topic, bytes calldata data) external onlySomniaReactive {
        require(subscriptions[source][topic], "AgentInterface: not subscribed");

        if (topic == PRICE_UPDATED_TOPIC) {
            // Price update → update all PnL and trigger Sentinel check
            (, uint256 newPrice) = abi.decode(data, (bytes32, uint256));
            marginVault.updateAllPnL(newPrice);
            // Sentinel would check positions here reactively
            _triggerSentinel(newPrice);
            // LP Agent rebalances
            _triggerLPRebalance(newPrice);
        }

        if (topic == ORDER_PLACED_TOPIC) {
            // New order → attempt matching
            orderBook.attemptMatch();
        }
    }

    /// @notice Simulate reactive flow (for testing/demo without Somnia reactive layer)
    function simulateOrderPlaced() external {
        orderBook.attemptMatch();
    }

    /// @notice Simulate price update reactive flow
    function simulatePriceUpdate(uint256 newPrice) external {
        marginVault.updateAllPnL(newPrice);
        _triggerSentinel(newPrice);
        _triggerLPRebalance(newPrice);
    }

    // ============ Internal Triggers ============

    function _triggerSentinel(uint256 currentPrice) internal {
        // Call the Sentinel to check and liquidate unhealthy positions
        ILiquidationSentinel(liquidationSentinel).checkAllPositions(currentPrice);
    }

    function _triggerLPRebalance(uint256 currentPrice) internal {
        // Call the LP Agent to rebalance its orders
        ILiquidityProviderAgent(liquidityProviderAgent).rebalance(currentPrice);
    }

    event SentinelTriggered(uint256 currentPrice);
    event LPRebalanceTriggered(uint256 currentPrice);
}

/// @title ILiquidationSentinel — Minimal interface for AgentInterface
interface ILiquidationSentinel {
    function checkAllPositions(uint256 currentPrice) external;
}

/// @title ILiquidityProviderAgent — Minimal interface for AgentInterface
interface ILiquidityProviderAgent {
    function rebalance(uint256 currentIndexPrice) external;
}
