---
name: somnia-multi-agent
description: Integrate all 3 Somnia Agents (JSON API Request, LLM Inference, LLM Parse Website) in a single contract — async callback pattern, consensus engine, and gas-deposit sizing for production use.
source: auto-skill
extracted_at: '2026-05-27T22:26:01.353Z'
---

# Somnia Multi-Agent Integration Pattern

Integrate all 3 Somnia decentralized agents (JSON API Request, LLM Inference, LLM Parse Website) in a single contract using the async callback pattern with proper two-pot gas model.

## Agent Identities

| Agent | agentId | Price | Use Case |
|-------|---------|-------|----------|
| JSON API Request | `13174292974160097713` | 0.03 STT | Fetch data from REST APIs |
| LLM Inference | `12847293847561029384` | 0.07 STT | On-chain AI (Qwen3-30B) |
| LLM Parse Website | `12875401142070969085` | 0.10 STT | Extract data from webpages |

Same agent IDs on mainnet and testnet. Agent prices are in whole tokens (SOMI on mainnet, STT on testnet).

## Architecture: Single Contract, All 3 Agents

```
                   SentimentOracle.sol
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
JSON API      LLM Parse       LLM Inference
Agent         Website Agent   Agent
(CoinGecko)   (CoinDesk)      (sentiment + volatility)
    │              │              │
    └──────────────┼──────────────┘
                   ▼
           Price Consensus
           Engine (average +
           divergence alert)

                   ▼
           Enhanced LP Agent
           (AI-adjusted spread)
```

## Implementation

### 1. Shared Platform Interface

```solidity
interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

enum ResponseStatus { None, Pending, Success, Failed, TimedOut }
```

### 2. Per-Agent Payload Construction

**JSON API Agent — fetchUint:**
```solidity
bytes memory payload = abi.encodeWithSelector(
    IJsonApiAgent.fetchUint.selector,
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",  // URL
    "bitcoin.usd",  // JSON selector (dot-notation)
    uint8(8)        // decimals (8 = Chainlink standard)
);
```

**LLM Inference — inferString (with allowedValues for safe branching):**
```solidity
string[] memory allowedValues = new string[](3);
allowedValues[0] = "bullish";
allowedValues[1] = "bearish";
allowedValues[2] = "neutral";

bytes memory payload = abi.encodeWithSelector(
    ILLMInference.inferString.selector,
    "Classify the sentiment of: 'Bitcoin surges past $50k'",  // prompt
    "You are a crypto sentiment analyst. Reply with one word.", // system
    false,        // chainOfThought (true for harder tasks, costs more)
    allowedValues // non-empty = LLM must pick one
);
```

**LLM Inference — inferNumber (for volatility scoring):**
```solidity
bytes memory payload = abi.encodeWithSelector(
    ILLMInference.inferNumber.selector,
    "Given prices [50000,50100,49800...], score volatility 0-100.", // prompt
    "You are a volatility analyst. Return integer 0-100.",          // system
    0,    // minValue (clamped)
    100,  // maxValue (clamped)
    false // chainOfThought
);
```

**LLM Parse Website — extractANumber:**
```solidity
bytes memory payload = abi.encodeWithSelector(
    ILLMParseWebsite.extractANumber.selector,
    "coindesk.com",     // URL or domain
    "Find the current BTC price in dollars on this page", // search/extraction query
    0,                  // minValue (0 = no lower bound)
    type(uint256).max,  // maxValue (max = no upper bound)
    8                   // decimals
);
```

### 3. Proper Deposit Sizing

```solidity
function _computeDeposit(uint256 pricePerAgent) internal view returns (uint256) {
    // operations reserve + agent reward pot
    // = getRequestDeposit() + pricePerAgent × subcommitteeSize
    return platform.getRequestDeposit() + pricePerAgent * SUBCOMMITTEE_SIZE;
}
```

Sending only the floor (`getRequestDeposit()`) makes `perAgentBudget = 0` — runners skip the request and it times out. Always add `pricePerAgent × subcommitteeSize`.

| Agent | Reserve | Reward (3 sub) | Minimum Deposit |
|-------|---------|----------------|----------------|
| JSON API | 0.03 | 0.09 | **0.12 STT** |
| LLM Inference | 0.03 | 0.21 | **0.24 STT** |
| LLM Parse Website | 0.03 | 0.30 | **0.33 STT** |

### 4. Async Callback Pattern

```solidity
// 1. Request — must be payable, caller provides deposit
function requestApiPrice() external payable returns (uint256 requestId) {
    uint256 deposit = _computeDeposit(JSON_API_PRICE);
    require(msg.value >= deposit, "insufficient deposit");

    requestId = platform.createRequest{value: deposit}(
        JSON_API_AGENT_ID,
        address(this),
        this.handleApiPrice.selector,
        payload  // ABI-encoded function call
    );
    pendingRequests[requestId] = true;
}

// 2. Callback — verify caller, decode result
function handleApiPrice(
    uint256 requestId,
    Response[] calldata responses,
    ResponseStatus status,
    Request calldata
) external {
    require(msg.sender == address(platform), "only platform");
    require(pendingRequests[requestId], "unknown request");
    delete pendingRequests[requestId];

    if (status == ResponseStatus.Success && responses.length > 0) {
        uint256 price = abi.decode(responses[0].result, (uint256));
        apiPrice = price;
        emit PriceUpdated(assetId, price, block.timestamp);
    }
}

// 3. Implement receive() — rebates are pushed back
receive() external payable {}
```

### 5. Price Consensus Engine

```solidity
function _checkDivergence() internal {
    if (apiPrice > 0 && websitePrice > 0) {
        uint256 diff = apiPrice > websitePrice
            ? apiPrice - websitePrice
            : websitePrice - apiPrice;
        uint256 divergenceBps = (diff * 10000) / apiPrice;

        if (divergenceBps > divergenceThresholdBps) {
            // Divergence detected — use conservative price
            consensusPrice = apiPrice < websitePrice ? apiPrice : websitePrice;
            emit PriceDivergenceAlert(apiPrice, websitePrice, divergenceBps);
        } else {
            // Within threshold — average
            consensusPrice = (apiPrice + websitePrice) / 2;
        }
    }
}
```

## Callback Safety Checklist

- [ ] `require(msg.sender == address(platform))` — prevent spoofed callbacks
- [ ] `mapping(uint256 => bool) pendingRequests` — prevent replay attacks
- [ ] Check `status == Success` AND `responses.length > 0` before decoding
- [ ] `receive() external payable {}` — accept rebates or they get stuck
- [ ] Handle `Failed` and `TimedOut` statuses (clean up state, allow retries)
- [ ] Don't include block-dependent data in LLM prompts (breaks determinism)

## Determinism Rules for LLM Agents

- Use `temperature = 0` (fixed by Somnia platform)
- Use fixed seed (Somnia platform handles this)
- **Don't** include `block.timestamp`, `block.number`, or `blockhash` in prompts
- Two validators seeing different inputs → different outputs → no Majority consensus → request fails
- For non-deterministic use cases (e.g., getting a median from multiple APIs), use `Threshold` consensus with `createAdvancedRequest`