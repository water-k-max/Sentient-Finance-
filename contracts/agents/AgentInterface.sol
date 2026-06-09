// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";
import {SentimentOracle} from "../oracles/SentimentOracle.sol";

/// @title AgentInterface — Reactive gateway for Somnia's event-driven execution
/// Subscribes to events from OrderBook, OracleAdapter/SomniaPriceOracle, and SentimentOracle.
/// Dispatches matching, liquidation, and LP rebalance autonomously — no external keeper needed.
/// Price comes from event data directly — Sentinel fires immediately in the same block.
contract AgentInterface {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    address public liquidationSentinel;
    address public liquidityProviderAgent;
    address public enhancedLpAgent;
    address public sentimentOracle;
    address public priceOracle;
    address public owner;

    // Somnia reactive platform address — set post-deploy via setSomniaReactiveAddress()
    // onEvent() accepts calls from EITHER the owner (testing) OR the Somnia platform (production)
    address public somniaReactiveAddress;

    bytes32 public constant PRICE_UPDATED_TOPIC =
        keccak256("PriceUpdated(bytes32,uint256,uint256)");
    bytes32 public constant ORDER_PLACED_TOPIC =
        keccak256("OrderPlaced(uint256,address,bool,uint256,uint256)");

    mapping(address => mapping(bytes32 => bool)) public subscriptions;

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentInterface: not owner");
        _;
    }

    /// @dev Accepts calls from: owner (testing/demo) OR Somnia reactive platform (production).
    ///      Original code checked msg.sender == owner only, which breaks autonomous execution
    ///      because Somnia's reactive layer calls onEvent from its own platform address.
    modifier onlySomniaReactive() {
        require(
            msg.sender == owner ||
                (somniaReactiveAddress != address(0) &&
                    msg.sender == somniaReactiveAddress),
            "AgentInterface: not authorized"
        );
        _;
    }

    constructor(
        address _orderBook,
        address _marginVault,
        address _liquidationSentinel,
        address _liquidityProviderAgent,
        address _priceOracle
    ) {
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        liquidationSentinel = _liquidationSentinel;
        liquidityProviderAgent = _liquidityProviderAgent;
        priceOracle = _priceOracle;
        owner = msg.sender;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setSentimentContracts(
        address _sentimentOracle,
        address _enhancedLpAgent
    ) external onlyOwner {
        sentimentOracle = _sentimentOracle;
        enhancedLpAgent = _enhancedLpAgent;
    }

    /// @notice Set the Somnia reactive platform address so onEvent() fires autonomously.
    ///         Get this from Somnia's developer docs / SOMNIA_AGENTS_PLATFORM_ADDRESS in .env.
    function setSomniaReactiveAddress(address _addr) external onlyOwner {
        somniaReactiveAddress = _addr;
    }

    function subscribe(
        address contractAddress,
        bytes32 eventTopic
    ) external onlyOwner {
        subscriptions[contractAddress][eventTopic] = true;
    }

    // ── Reactive entry points ─────────────────────────────────────────────────

    /// @notice Called by Somnia's reactive layer when a subscribed event fires.
    ///         Price decoded directly from event data — no async oracle fetch needed.
    function onEvent(
        address source,
        bytes32 topic,
        bytes calldata data
    ) external onlySomniaReactive {
        require(subscriptions[source][topic], "AgentInterface: not subscribed");

        if (topic == PRICE_UPDATED_TOPIC) {
            (, uint256 newPrice, ) = abi.decode(
                data,
                (bytes32, uint256, uint256)
            );
            _executeCascade(newPrice);
        }

        if (topic == ORDER_PLACED_TOPIC) {
            _safeAttemptMatch();
        }
    }

    /// @notice Manually trigger the full reactive cascade — used by demo scripts
    ///         and for testing. On Somnia testnet this fires automatically via
    ///         onEvent() whenever OracleAdapter emits PriceUpdated.
    function simulatePriceUpdate(uint256 newPrice) external {
        _executeCascade(newPrice);
    }

    /// @notice Trigger order matching only
    function simulateOrderPlaced() external {
        _safeAttemptMatch();
    }

    // ── Internal cascade ──────────────────────────────────────────────────────

    /// @dev Full reactive cascade. Each step is isolated in try/catch so one
    ///      failing component never blocks the others.
    ///      Order matters: PnL update → liquidation check → LP rebalance → sentiment.
    function _executeCascade(uint256 currentPrice) internal {
        // Step 1: Update all unrealized PnL at new price
        // Must run before liquidation check so health factors are current
        try marginVault.updateAllPnL(currentPrice) {} catch (
            bytes memory reason
        ) {
            emit CascadeStepFailed("updateAllPnL", reason);
        }

        // Step 2: Check and liquidate underwater positions
        // Fires in same block as price update — this is the keeper-free claim
        try
            ILiquidationSentinel(liquidationSentinel).checkAllPositions(
                currentPrice
            )
        {
            emit SentinelTriggered(currentPrice);
        } catch (bytes memory reason) {
            emit CascadeStepFailed("checkAllPositions", reason);
        }

        // Step 3: Rebalance base LP agent around new price
        try
            ILiquidityProviderAgent(liquidityProviderAgent).rebalance(
                currentPrice
            )
        {
            emit LPRebalanceTriggered(currentPrice);
        } catch (bytes memory reason) {
            emit CascadeStepFailed("lpRebalance", reason);
        }

        // Step 4: Rebalance AI-augmented LP agent (optional)
        if (enhancedLpAgent != address(0)) {
            try
                IEnhancedLPAgent(enhancedLpAgent).rebalance(currentPrice)
            {} catch (bytes memory reason) {
                emit CascadeStepFailed("enhancedLpRebalance", reason);
            }
        }

        // Step 5: Trigger sentiment analysis signal (optional)
        if (sentimentOracle != address(0)) {
            emit SentimentAnalysisTriggered(currentPrice);
        }
    }

    // ── Sentiment Oracle Agent Triggers ────────────────────────────────────
    // Each requires STT deposit forwarded to SentimentOracle for validator fees.
    // Four separate transactions needed — msg.value cannot be split in one tx.

    /// @notice Trigger CoinGecko price fetch via JSON API Agent
    function triggerApiPrice() external payable {
        require(sentimentOracle != address(0), "AgentInterface: no oracle");
        SentimentOracle(payable(sentimentOracle)).requestApiPrice{value: msg.value}();
    }

    /// @notice Trigger CoinDesk price extraction via LLM Parse Website Agent
    function triggerWebsitePrice() external payable {
        require(sentimentOracle != address(0), "AgentInterface: no oracle");
        SentimentOracle(payable(sentimentOracle)).requestWebsitePrice{value: msg.value}();
    }

    /// @notice Trigger sentiment analysis via LLM Inference Agent
    function triggerSentimentAnalysis(string calldata headline) external payable {
        require(sentimentOracle != address(0), "AgentInterface: no oracle");
        SentimentOracle(payable(sentimentOracle)).analyzeSentiment{value: msg.value}(headline);
    }

    /// @notice Trigger volatility scoring via LLM Inference Agent
    function triggerVolatilityScore(string calldata priceHistory) external payable {
        require(sentimentOracle != address(0), "AgentInterface: no oracle");
        SentimentOracle(payable(sentimentOracle)).computeVolatilityScore{value: msg.value}(priceHistory);
    }

    function _safeAttemptMatch() internal {
        try orderBook.attemptMatch() {} catch (bytes memory reason) {
            emit CascadeStepFailed("attemptMatch", reason);
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event SentinelTriggered(uint256 currentPrice);
    event LPRebalanceTriggered(uint256 currentPrice);
    event SentimentAnalysisTriggered(uint256 currentPrice);

    /// @dev Emitted when a cascade step fails — lets off-chain monitoring detect
    ///      partial failures without reverting the whole transaction.
    event CascadeStepFailed(string step, bytes reason);
}

// ── Minimal interfaces ────────────────────────────────────────────────────────

interface ILiquidationSentinel {
    function checkAllPositions(uint256 currentPrice) external;
}

interface ILiquidityProviderAgent {
    function rebalance(uint256 currentIndexPrice) external;
}

interface IEnhancedLPAgent {
    function rebalance(uint256 currentIndexPrice) external;
}
