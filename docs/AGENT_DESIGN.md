# Agent Design — Sentient Finance

## Liquidation Sentinel

### Role
Autonomous on-chain agent that monitors all open positions and fires liquidations when margin health drops below the 5% maintenance threshold. Replaces MEV bots entirely.

### Reactive Trigger → Action Flow
```
Trigger: PRICE_UPDATED event (from OracleAdapter or SentimentOracle)
  ↓
AgentInterface._executeCascade(currentPrice)
  ↓ step 2
LiquidationSentinel.checkAllPositions(currentPrice)
  ├── marginVault.updateAllPnL(currentPrice)     ← step 1
  └── _liquidateUnhealthyPositions()
        └── for each tracked trader (reverse iteration):
              if marginHealth(trader) < 5%:
                marginVault.liquidate(trader)
                emit LiquidationExecuted
```

### Design Decisions
- **Reverse iteration** — liquidation removes trader from array by swapping with last element, so forward iteration would skip entries
- **Re-reads count each iteration** — array size changes during liquidation
- **No external keeper** — triggered entirely by Somnia's reactive event subscription
- **Gas optimization note** — production would use a sorted linked list keyed by liquidation price

### Demo Moment (Video 2:00–3:00)
Move mock oracle price down sharply → Sentinel detects undercollateralized position → liquidation executes autonomously. No external transaction sent.

---

## Liquidity Provider Agent

### Role
Autonomous market-making agent that places and continuously rebalances two-sided limit orders around the current index price.

### Reactive Trigger → Action Flow
```
Trigger: PRICE_UPDATED event
  ↓
AgentInterface._executeCascade(currentPrice)
  ↓ step 3
LiquidityProviderAgent.rebalance(currentPrice)
  ├── if price move < 1% threshold → return (no action)
  ├── if volatility high → double spread
  ├── cancel existing bid + ask orders
  ├── compute new bid = mid × (1 - spreadBps/10000)
  ├── compute new ask = mid × (1 + spreadBps/10000)
  └── placeOrder(bid) + placeOrder(ask)
```

### Design Decisions
- **1% rebalance threshold** — avoids excessive gas from micro-adjustments
- **Adaptive spread** — doubles when 5+ consecutive price moves exceed 1%
- **1x leverage** — LP agent uses minimal leverage since it's providing liquidity, not speculating
- **Owner-controlled pause** — can be paused/resumed for demo control

### Demo Moment (Video 0:30–1:15)
Show AgentDashboard → LP Agent's live bid/ask orders visible in order book. Price moves → orders rebalance automatically.

---

## SentimentOracle — Multi-Agent Oracle

### Role
Integrates all three Somnia agent types — JSON API, LLM Parse Website, and LLM Inference — to produce an AI-augmented price feed with sentiment analysis and volatility scoring. This is the core "contract takes action with data returned by the agent" use case for the agentathon.

### The Three Agents

#### Agent 1: JSON API Request — CoinGecko Price Feed
- **Agent ID:** `13174292974160097713`
- **Function:** `fetchUint(coingecko_url, 'bitcoin.usd', 8)`
- **Consensus:** Majority (3 of 3 validators must agree)
- **Deposit:** 0.09 STT × 3 + 0.03 reserve = 0.12 STT
- **Callback:** `handleApiPrice()` → stores `apiPrice`

#### Agent 2: LLM Parse Website — CoinDesk Price Extraction
- **Agent ID:** `12875401142070969085`
- **Function:** `extractANumber(coindesk_url, 'Find the current Bitcoin BTC price in dollars', 8)`
- **Consensus:** Threshold (2 of 3 validators)
- **Deposit:** 0.10 STT × 3 + 0.03 reserve = 0.33 STT
- **Callback:** `handleWebsitePrice()` → stores `websitePrice`

#### Agent 3: LLM Inference — Sentiment Analysis + Volatility Scoring
- **Agent ID:** `12847293847561029384` (same agent, two function calls)
- **Function (sentiment):** `inferString(prompt, 'bullish|bearish|neutral', temp=0)`
- **Function (volatility):** `inferNumber(priceHistory, 0, 100, temp=0)`
- **Consensus:** Majority (deterministic, temperature=0 ensures byte-identical outputs)
- **Deposit:** 0.07 STT × 3 per call + 0.03 reserve
- **Callback:** `handleSentiment()`, `handleVolatility()` → stores `sentiment`, `volatilityScore`

### Consensus & Divergence Check
Once both `apiPrice` (CoinGecko) and `websitePrice` (CoinDesk) arrive, `_checkDivergence()` runs:

```
if |apiPrice - websitePrice| / apiPrice < 1% (100 bps):
    consensusPrice = (apiPrice + websitePrice) / 2
else:
    consensusPrice = min(apiPrice, websitePrice)  // conservative
```

The `consensusPrice` is the final index price fed to LP agents.

### Async Request Lifecycle
```
Owner calls SentimentOracle.requestApiPrice{value: 0.12 STT}()
  ↓
createAdvancedRequest(JSON_API_AGENT_ID, ..., handleApiPrice.selector, ...)
  ↓
[Off-chain: Somnia validator subcommittee fetches CoinGecko API]
  ↓
handleApiPrice(requestId, responses[], Success)
  ├── apiPrice = decoded price
  └── emit ApiPriceFetched

(Owner independently calls requestWebsitePrice and analyzeSentiment similarly)
```

### Demo Moment (Agentathon Showcase)
Open AgentDashboard → see all three agent status cards. Call `requestApiPrice()` → CoinGecko price arrives via callback → `requestWebsitePrice()` → CoinDesk extraction → consensus computed → Enhanced LP Agent spread adjusts.

---

## Enhanced Liquidity Provider Agent

### Role
Extends the base LP Agent with AI-augmented spread adjustment using sentiment and volatility data from SentimentOracle.

### Spread Formula
```
effectiveSpread = baseSpread × (1 + volatilityScore / 100) × sentimentMultiplier
```

Where:
| Sentiment | Multiplier | Effect |
|-----------|-----------|--------|
| bullish   | 0.8x      | Tighten spread (confident in direction) |
| neutral   | 1.0x      | Normal spread |
| bearish   | 2.0x      | Widen spread (cautious, protect inventory) |

### Data Flow
```
SentimentOracle                           EnhancedLPAgent
  ├── consensusPrice ──────────────────→  rebalance(price)
  ├── sentiment ────→ onSentimentUpdate → sentimentMultiplierBps
  └── volatilityScore → onVolatilityUpdate → lastVolatilityScore
```

### Demo Moment (Video 1:15–2:00)
Show AgentDashboard → SentimentOracle data populated → Enhanced LP spread dynamically changes when sentiment flips bearish.

---

## Reactive Cascade (Full Flow)

The entire system operates in a single reactive transaction, triggered by a `PriceUpdated` event:

```
Step 0: PriceUpdated event emitted (from any oracle source)
  ↓
AgentInterface.onEvent(source, PRICE_UPDATED_TOPIC, data)
  ↓ decoding
_executeCascade(newPrice):
  ├── Step 1: marginVault.updateAllPnL(currentPrice)       // PnL recomputation
  ├── Step 2: sentinel.checkAllPositions(currentPrice)      // Liquidation check
  ├── Step 3: lpAgent.rebalance(currentPrice)               // Base LP rebalance
  ├── Step 4: enhancedLp.rebalance(currentPrice)            // AI-augmented LP rebalance
  └── Step 5: emit SentimentAnalysisTriggered               // Signal for external agent calls
```

Each step is isolated in a `try/catch` so one failure never blocks the rest. Steps 4 and 5 only run if the corresponding contracts are configured.

---

## Zero Keeper Proof

| Component | Traditional Approach | Sentient Finance |
|-----------|---------------------|------------------|
| Order matching | Keeper bot monitors mempool | `_attemptMatch()` fires on `OrderPlaced` event |
| Liquidations | MEV bots scan positions | Sentinel checks reactively on price update |
| Market making | Off-chain MM algorithms | LP Agent rebalances via reactive trigger |
| Price updates | Chainlink Automation / cron | SentimentOracle → reactive PnL cascade |
| Sentiment analysis | Off-chain ML API | LLM Inference Agent → deterministic on-chain AI |

**No off-chain script. No cron job. No Chainlink Automation. No keeper EOA.**
