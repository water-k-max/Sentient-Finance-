# Agent Design — Sentient Finance

## Liquidation Sentinel

### Role
Autonomous on-chain agent that monitors all open positions and fires liquidations when margin health drops below the 5% maintenance threshold. Replaces MEV bots entirely.

### Reactive Trigger → Action Flow
```
Trigger: PRICE_UPDATED event (from OracleAdapter or AgentOracle)
  ↓
AgentInterface._triggerSentinel(currentPrice)
  ↓
LiquidationSentinel.checkAllPositions(currentPrice)
  ├── marginVault.updateAllPnL(currentPrice)
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
AgentInterface._triggerLPRebalance(currentPrice)
  ↓
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

## AgentOracle (Somnia JSON API Agent Integration)

### Role
Fetches live BTC/USD price from CoinGecko API using Somnia's decentralized JSON API Request agent. Replaces the mock price feed with real data.

### Async Request Lifecycle
```
User calls AgentOracle.requestPrice{value: 0.12 STT}()
  ↓
createRequest(JSON_API_AGENT_ID, AgentOracle, handleResponse, payload)
  ↓
[Off-chain: Somnia validator subcommittee fetches CoinGecko API]
  ↓
[Consensus: 3 validators agree on price value]
  ↓
handleResponse(requestId, responses[], Success)
  ├── abi.decode(responses[0].result, uint256) → price
  ├── latestPrice = price
  └── emit PriceUpdated → triggers full reactive cascade
```

### Gas Model
- **Operations reserve:** 0.03 STT × 3 = 0.09 STT
- **Agent reward:** 0.03 STT × 3 = 0.09 STT
- **Minimum deposit:** 0.12 STT (more is fine, excess is rebated)

### Demo Moment (Agentathon Showcase)
Call `requestPrice()` → watch CoinGecko fetch happen off-chain → price arrives via callback → reactive cascade fires → all positions updated.

---

## Zero Keeper Proof

| Component | Traditional Approach | Sentient Finance |
|-----------|---------------------|------------------|
| Order matching | Keeper bot monitors mempool | `_attemptMatch()` fires on `OrderPlaced` event |
| Liquidations | MEV bots scan positions | Sentinel checks reactively on price update |
| Market making | Off-chain MM algorithms | LP Agent rebalances via reactive trigger |
| Price updates | Chainlink Automation / cron | AgentOracle → reactive PnL cascade |

**No off-chain script. No cron job. No Chainlink Automation. No keeper EOA.**
