// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SentimentOracle — Multi-agent oracle using all 3 Somnia Agents
/// Integrates JSON API Agent (CoinGecko price), LLM Parse Website Agent
/// (CoinDesk price extraction), and LLM Inference Agent (sentiment analysis
/// + volatility scoring) to produce an AI-augmented price feed.
///
/// This is the core "contract takes action with data returned by the agent"
/// use case for the agentathon — ALL three agents are used together.
contract SentimentOracle {
    address public owner;
    IAgentRequester public platform;

    // === Agent IDs (same on mainnet and testnet) ===
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384;
    uint256 public constant LLM_PARSE_WEBSITE_AGENT_ID = 12875401142070969085;

    // === Agent prices (two-pot gas model) ===
    uint256 public constant JSON_API_PRICE = 0.03 ether;
    uint256 public constant LLM_INFERENCE_PRICE = 0.07 ether;
    uint256 public constant LLM_PARSE_WEBSITE_PRICE = 0.10 ether;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant THRESHOLD = 2; // 2 of 3 — faster, tolerates 1 failure

    // === CoinGecko config (JSON API Agent) ===
    string public constant COINGECKO_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    string public constant COINGECKO_SELECTOR = "bitcoin.usd";
    uint8 public constant COINGECKO_DECIMALS = 8;

    // === CoinDesk config (LLM Parse Website Agent) ===
    string public constant COINDESK_URL = "https://www.coindesk.com/";
    string public constant COINDESK_SEARCH_QUERY =
        "Find the current Bitcoin BTC price in dollars on this page";

    // === Sentiment analysis config (LLM Inference Agent) ===
    string[] public SENTIMENT_VALUES = ["bullish", "bearish", "neutral"];

    // === State ===
    uint256 public apiPrice; // From CoinGecko via JSON API Agent
    uint256 public websitePrice; // From CoinDesk via LLM Parse Website Agent
    string public sentiment; // From LLM Inference Agent
    uint256 public volatilityScore; // From LLM Inference Agent (0-100)
    uint256 public consensusPrice; // Final agreed price
    uint256 public lastUpdated;

    // Request tracking
    mapping(uint256 => bytes32) public requestContext; // requestId → pairId
    mapping(uint256 => bool) public pendingRequests;

    // Price divergence threshold (in bps)
    uint256 public divergenceThresholdBps = 100; // 1%

    // Events
    event ApiPriceFetched(uint256 price, uint256 timestamp);
    event WebsitePriceExtracted(uint256 price, uint256 timestamp);
    event SentimentAnalyzed(string sentiment, uint256 timestamp);
    event VolatilityScored(uint256 score, uint256 timestamp);
    event ConsensusPriceSet(uint256 price, uint256 timestamp);
    event PriceDivergenceAlert(
        uint256 apiPrice,
        uint256 websitePrice,
        uint256 divergenceBps
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "SentimentOracle: not owner");
        _;
    }

    constructor(address _platform) {
        owner = msg.sender;
        platform = IAgentRequester(_platform);
    }

    // ============================================================
    // 1. JSON API Agent — Fetch BTC price from CoinGecko
    // ============================================================

    /// @notice Request BTC price from CoinGecko API
    function requestApiPrice() external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            COINGECKO_URL,
            COINGECKO_SELECTOR,
            COINGECKO_DECIMALS
        );

        uint256 deposit = _computeDeposit(JSON_API_PRICE);
        require(
            msg.value >= deposit,
            "SentimentOracle: insufficient deposit for JSON API"
        );

        requestId = platform.createAdvancedRequest{value: deposit}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleApiPrice.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            THRESHOLD,
            ConsensusType.Threshold,
            900
        );

        pendingRequests[requestId] = true;
        emit ApiPriceRequested(requestId);
    }

    /// @notice Callback from JSON API Agent
    function handleApiPrice(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata /* details */
    ) external {
        require(
            msg.sender == address(platform),
            "SentimentOracle: only platform"
        );
        require(pendingRequests[requestId], "SentimentOracle: unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 price = abi.decode(responses[0].result, (uint256));
            apiPrice = price;
            lastUpdated = block.timestamp;
            emit ApiPriceFetched(price, block.timestamp);
            _checkDivergence();
        }
    }

    // ============================================================
    // 2. LLM Parse Website Agent — Extract BTC price from CoinDesk
    // ============================================================

    /// @notice Request BTC price extraction from CoinDesk website
    function requestWebsitePrice()
        external
        payable
        returns (uint256 requestId)
    {
        bytes memory payload = abi.encodeWithSelector(
            ILLMParseWebsite.extractANumber.selector,
            COINDESK_URL,
            COINDESK_SEARCH_QUERY,
            0,
            type(uint256).max,
            8 // 8 decimals
        );

        uint256 deposit = _computeDeposit(LLM_PARSE_WEBSITE_PRICE);
        require(
            msg.value >= deposit,
            "SentimentOracle: insufficient deposit for LLM Parse Website"
        );

        requestId = platform.createAdvancedRequest{value: deposit}(
            LLM_PARSE_WEBSITE_AGENT_ID,
            address(this),
            this.handleWebsitePrice.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            THRESHOLD,
            ConsensusType.Threshold,
            900
        );

        pendingRequests[requestId] = true;
        emit WebsitePriceRequested(requestId);
    }

    /// @notice Callback from LLM Parse Website Agent
    function handleWebsitePrice(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata /* details */
    ) external {
        require(
            msg.sender == address(platform),
            "SentimentOracle: only platform"
        );
        require(pendingRequests[requestId], "SentimentOracle: unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 price = abi.decode(responses[0].result, (uint256));
            websitePrice = price;
            emit WebsitePriceExtracted(price, block.timestamp);
            _checkDivergence();
        }
    }

    // ============================================================
    // 3. LLM Inference Agent — Sentiment Analysis
    // ============================================================

    /// @notice Analyze sentiment of a crypto news headline
    function analyzeSentiment(
        string calldata headline
    ) external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            ILLMInference.inferString.selector,
            string(
                abi.encodePacked(
                    "Classify the sentiment of this crypto news headline: ",
                    headline
                )
            ),
            "You are a crypto market sentiment analyst. Reply with exactly one word.",
            false, // chainOfThought
            SENTIMENT_VALUES
        );

        uint256 deposit = _computeDeposit(LLM_INFERENCE_PRICE);
        require(
            msg.value >= deposit,
            "SentimentOracle: insufficient deposit for LLM Inference"
        );

        requestId = platform.createAdvancedRequest{value: deposit}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleSentiment.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            THRESHOLD,
            ConsensusType.Threshold,
            900
        );

        pendingRequests[requestId] = true;
        emit SentimentRequested(requestId);
    }

    /// @notice Callback from LLM Inference Agent (sentiment)
    function handleSentiment(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata /* details */
    ) external {
        require(
            msg.sender == address(platform),
            "SentimentOracle: only platform"
        );
        require(pendingRequests[requestId], "SentimentOracle: unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory result = abi.decode(responses[0].result, (string));
            sentiment = result;
            emit SentimentAnalyzed(result, block.timestamp);
        }
    }

    // ============================================================
    // 4. LLM Inference Agent — Volatility Scoring
    // ============================================================

    /// @notice Compute volatility score (0-100) from recent price history
    /// Accepts a string representation of comma-separated prices for the LLM prompt
    function computeVolatilityScore(
        string calldata priceHistoryString
    ) external payable returns (uint256 requestId) {
        string memory prompt = string(
            abi.encodePacked(
                "Given these recent BTC prices (comma-separated): ",
                priceHistoryString,
                ". Score the volatility from 0 (stable) to 100 (extremely volatile). Return only the number."
            )
        );

        bytes memory payload = abi.encodeWithSelector(
            ILLMInference.inferNumber.selector,
            prompt,
            "You are a financial volatility analyst. Return an integer from 0 to 100.",
            0, // minValue
            100, // maxValue
            false // chainOfThought
        );

        uint256 deposit = _computeDeposit(LLM_INFERENCE_PRICE);
        require(
            msg.value >= deposit,
            "SentimentOracle: insufficient deposit for LLM Inference"
        );

        requestId = platform.createAdvancedRequest{value: deposit}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleVolatility.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            THRESHOLD,
            ConsensusType.Threshold,
            900
        );

        pendingRequests[requestId] = true;
        emit VolatilityRequested(requestId);
    }

    /// @notice Callback from LLM Inference Agent (volatility)
    function handleVolatility(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata /* details */
    ) external {
        require(
            msg.sender == address(platform),
            "SentimentOracle: only platform"
        );
        require(pendingRequests[requestId], "SentimentOracle: unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 score = abi.decode(responses[0].result, (uint256));
            volatilityScore = score;
            emit VolatilityScored(score, block.timestamp);
        }
    }

    // ============================================================
    // Consensus & Divergence
    // ============================================================

    /// @notice Check if CoinGecko and CoinDesk prices diverge > threshold
    function _checkDivergence() internal {
        if (apiPrice > 0 && websitePrice > 0) {
            uint256 diff = apiPrice > websitePrice
                ? apiPrice - websitePrice
                : websitePrice - apiPrice;
            uint256 divergenceBps = (diff * 10000) / apiPrice;

            if (divergenceBps > divergenceThresholdBps) {
                emit PriceDivergenceAlert(
                    apiPrice,
                    websitePrice,
                    divergenceBps
                );
                // Use the lower price as consensus (conservative)
                consensusPrice = apiPrice < websitePrice
                    ? apiPrice
                    : websitePrice;
            } else {
                // Average if within threshold
                consensusPrice = (apiPrice + websitePrice) / 2;
            }
            emit ConsensusPriceSet(consensusPrice, block.timestamp);
        } else if (apiPrice > 0) {
            consensusPrice = apiPrice;
            emit ConsensusPriceSet(apiPrice, block.timestamp);
        }
    }

    /// @notice Set the divergence threshold (in bps)
    function setDivergenceThreshold(uint256 bps) external onlyOwner {
        require(bps > 0 && bps < 5000, "SentimentOracle: invalid threshold");
        divergenceThresholdBps = bps;
    }

    /// @notice Get required deposit for each agent type
    function getDepositRequired()
        external
        view
        returns (uint256 jsonApi, uint256 llmInference, uint256 llmParseWebsite)
    {
        jsonApi = _computeDeposit(JSON_API_PRICE);
        llmInference = _computeDeposit(LLM_INFERENCE_PRICE);
        llmParseWebsite = _computeDeposit(LLM_PARSE_WEBSITE_PRICE);
    }

    // Accept rebates from Somnia Agents platform
    receive() external payable {}

    // Internal
    function _computeDeposit(
        uint256 pricePerAgent
    ) internal view returns (uint256) {
        return
            platform.getAdvancedRequestDeposit(SUBCOMMITTEE_SIZE) +
            pricePerAgent *
            SUBCOMMITTEE_SIZE;
    }

    // Events for request tracking
    event ApiPriceRequested(uint256 requestId);
    event WebsitePriceRequested(uint256 requestId);
    event SentimentRequested(uint256 requestId);
    event VolatilityRequested(uint256 requestId);
}

// ============ Somnia Agents Platform Interfaces ============

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);

    function getAdvancedRequestDeposit(
        uint256 subcommitteeSize
    ) external view returns (uint256);
}

enum ConsensusType {
    Majority,
    Threshold
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    uint256 consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

// ============ JSON API Agent Interface ============

interface IJsonApiAgent {
    function fetchUint(
        string calldata url,
        string calldata selector,
        uint8 decimals
    ) external returns (uint256);
}

// ============ LLM Inference Agent Interface ============

interface ILLMInference {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);

    function inferNumber(
        string calldata prompt,
        string calldata system,
        uint256 minValue,
        uint256 maxValue,
        bool chainOfThought
    ) external returns (uint256);
}

// ============ LLM Parse Website Agent Interface ============

interface ILLMParseWebsite {
    function extractANumber(
        string calldata urlOrDomain,
        string calldata query,
        uint256 minValue,
        uint256 maxValue,
        uint8 decimals
    ) external returns (uint256);
}
