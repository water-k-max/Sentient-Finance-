# Sentient Finance

> **A Reactive Perpetual Matching Engine on Somnia L1 — Eliminating Keeper-Dependent Liquidations and Order Matching**

![Somnia Agentathon](https://img.shields.io/badge/Somnia-Agentathon-00E5FF?style=for-the-badge)
![Tests](https://img.shields.io/badge/tests-77%20passing-00E676?style=for-the-badge)
![Contracts](https://img.shields.io/badge/contracts-16%20deployed-00E5FF?style=for-the-badge)
![Multi-Pair](https://img.shields.io/badge/pairs-BTC%20%7C%20ETH%20%7C%20SOL-8B5CF6?style=for-the-badge)

---

## The Problem

Traditional perpetual DEXes (dYdX, GMX, Hyperliquid) all share a critical weakness: they depend on **off-chain keeper infrastructure** — external bots, cron jobs, or centralized sequencers — to match orders, liquidate positions, and update prices. This introduces:

- **MEV exposure** — keepers front-run and extract value from traders
- **Censorship risk** — centralized keepers can be pressured or disabled
- **Latency bottlenecks** — off-chain → on-chain round-trips add seconds of delay
- **Trust assumptions** — you must trust the keeper operator to act honestly and promptly

## The Somnia Solution

Sentient Finance moves liquidation and order matching on-chain via **Somnia's reactive execution layer** — eliminating the keeper bot infrastructure for those operations. Price discovery depends on external feeds, reducing the MEV blast radius but not eliminating it entirely.

```
[New Order Event] → [Somnia Reactive Layer] → [_attemptMatch() called] → [Position Opened]
                                                                        ↓
[Oracle Price Update] → [Somnia Reactive Layer] → [updateAllPnL() → checkAllPositions() → liquidate()]
                                                                        ↓
[LP Agent Reacts] → [Rebalance orders at new mid-price]
```

**Liquidations and order matching fire within the same block as the triggering event — no external caller needed for those steps.**

### Why Somnia?

- **MultiStream BFT consensus** — sub-second finality enables reactive patterns impossible on other EVMs
- **IceDB state layer** — efficient state access makes iterating all positions gas-feasible
- **Reactive extensions** — contracts subscribe to events and auto-execute

### Honest Dependency Map

| Operation | On-Chain (Reactive) | Off-Chain Dependency |
|-----------|-------------------|---------------------|
| Order matching | `_attemptMatch()` fires on `OrderPlaced` event | None |
| Liquidations | `LiquidationSentinel` checks on every `PriceUpdated` | None |
| Market making | `LiquidityProviderAgent` rebalances reactively | None |
| Price updates (fast) | Pushed via `MockPriceFeed` | `priceFeed.ts` script fetches CoinGecko (~3s interval) |
| Price updates (decentralized) | `SentimentOracle` via 3 Somnia agents | Somnia validator subcommittee (~30-120s latency) |
| Sentiment analysis | `LLM Inference Agent` on-chain | None (deterministic, temp=0) |

**The price feed is our honest external dependency — we're betting on Somnia's agent platform security rather than trusting a centralized oracle operator.**

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React/Vite + Recharts)              │
│  TradingView │ AgentDashboard │ Stats │ Wallet │ Pair Selector   │
└────────────────────────┬────────────────────────────────────────┘
                         │ ethers.js v6
┌────────────────────────▼────────────────────────────────────────┐
│                     PerpEngine.sol (multi-pair)                  │
│              BTC-USD │ ETH-USD │ SOL-USD │ Funding               │
├──────────────┬─────────────────────┬────────────────────────────┤
│ OrderBook.sol│   MarginVault.sol   │   SentimentOracle.sol      │
│  (per-pair)  │   (Clearinghouse)   │  (3-agent AI oracle)       │
├──────────────┴─────────────────────┴────────────────────────────┤
│                     AgentInterface.sol                           │
│                (Reactive Gateway)                                │
├────────────────────────────────┬────────────────────────────────┤
│  LiquidationSentinel.sol       │  LiquidityProviderAgent.sol    │
│  (Auto-liquidate agent)        │  (Base LP agent)               │
├────────────────────────────────┼────────────────────────────────┤
│  EnhancedLiquidityProviderAgent │  SentimentOracle.sol           │
│  (AI-augmented LP agent)       │  (reads: consensusPrice,       │
│                                 │   sentiment, volatilityScore)  │
├────────────────────────────────┴────────────────────────────────┤
│  SentimentOracle ──→ Agent 1: JSON API (CoinGecko)              │
│                  ──→ Agent 2: LLM Parse Website (CoinDesk)       │
│                  ──→ Agent 3: LLM Inference (Sentiment + Vol)    │
│  OrderBookFactory.sol ──→ deploys per-pair OrderBooks            │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Contract Breakdown

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| `OrderBook.sol` | Heap-based order matching (max-heap bids, min-heap asks) | `placeOrder`, `cancelOrder`, `_attemptMatch`, `getOrderBookDepth` |
| `OrderBookFactory.sol` | Deploys isolated OrderBook per trading pair | `createOrderBook`, `getAllPairs`, `pairOrderBooks` |
| `MarginVault.sol` | Collateral management, PnL, liquidation enforcement | `deposit`, `settlePosition`, `updatePnL`, `updateAllPnL`, `liquidate` |
| `PerpEngine.sol` | Multi-pair coordinator, funding rates, VWAP mark price | `registerPair`, `openPosition`, `computeFundingRate`, `recordFill` |
| `OracleAdapter.sol` | Price feed wrapper (deprecated, kept for tests) | `updatePrice`, `updatePriceDirect`, `getIndexPrice` |
| `SomniaPriceOracle.sol` | Keeper-median price oracle with circuit breaker | `submitPrice`, `getConsensusPrice` |
| `CompositeOracle.sol` | Single entry point selecting price source | `getPrice` |
| `AgentOracle.sol` | Somnia JSON API Agent → CoinGecko live BTC/USD | `requestPrice`, `handleResponse` async callback |
| `SentimentOracle.sol` | **Multi-agent oracle** using all 3 Somnia agents | `requestApiPrice`, `requestWebsitePrice`, `analyzeSentiment`, `computeVolatilityScore` |
| `AgentInterface.sol` | Reactive event gateway, 5-step cascade | `subscribe`, `onEvent`, `_executeCascade` (PnL → Sentinel → LP → Enhanced LP → event) |
| `LiquidationSentinel.sol` | Autonomous liquidation agent | `checkAllPositions`, `liquidatePosition`, reverse-iterate trackedTraders |
| `LiquidityProviderAgent.sol` | Base autonomous market-making agent | `initialize`, `rebalance`, adaptive spread on volatility |
| `EnhancedLiquidityProviderAgent.sol` | **AI-augmented LP** using sentiment + volatility | `rebalance`, `onSentimentUpdate`, `onVolatilityUpdate`, `_computeEffectiveSpread` |
| `MockPriceFeed.sol` | Admin-controlled price feed for testing | `updatePrice` |
| `MockUSDC.sol` | 6-decimal USDC mock for collateral (OpenZeppelin ERC20) | `mint`, `approve`, `transfer` |
| `KeeperRegistry.sol` | Authorized keeper set with bonding/slashing | `registerKeeper`, `slashKeeper` |

## Agent Design

### Liquidation Sentinel
- **Trigger:** Oracle price update → `AgentInterface.onEvent` → `updateAllPnL`
- **Action:** Iterates all tracked positions in reverse, calls `liquidate()` on any with health < 5%
- **Result:** Positions are liquidated autonomously — no MEV bot needed for liquidation detection

### Liquidity Provider Agent (Base)
- **Trigger:** Price moves > 1% from last mid-price (via reactive cascade, step 3)
- **Action:** Cancels stale orders, places new bid/ask pair at mid ± spread
- **Adaptive:** Widens spread during high volatility (5+ consecutive >1% moves)

### Enhanced Liquidity Provider Agent (AI-Augmented)
- **Trigger:** Same price cascade (step 4), plus sentiment/volatility signal from SentimentOracle
- **Formula:** `effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier`
- **Sentiment mapping:** bullish → 0.8x (tighten), neutral → 1.0x, bearish → 2.0x (widen)
- **Result:** Spread dynamically adjusts based on decentralized AI analysis

### SentimentOracle (Multi-Agent Oracle)
Integrates **all three** Somnia agent types to produce an AI-augmented price feed:
- **Agent 1:** JSON API — fetches BTC/USD from CoinGecko (`apiPrice`)
- **Agent 2:** LLM Parse Website — extracts BTC price from CoinDesk (`websitePrice`)
- **Agent 3:** LLM Inference — analyzes sentiment (`bullish/bearish/neutral`) and scores volatility (0–100)
- **Consensus:** `_checkDivergence()` compares both prices — if divergence < 1%, averages them; otherwise uses the lower price (conservative)
- **This is the core "contract takes action with data returned by the agent" use case**

## Multi-Pair Support

Sentient Finance supports multiple trading pairs via the **OrderBookFactory** pattern:

```
OrderBookFactory.createOrderBook("BTC-USD") → 0x...OrderBook1
OrderBookFactory.createOrderBook("ETH-USD") → 0x...OrderBook2
OrderBookFactory.createOrderBook("SOL-USD") → 0x...OrderBook3
```

Each pair gets an isolated order book with its own order queue, while sharing a single `MarginVault` for collateral management. `PerpEngine` routes calls to the correct order book via `pairId` mapping.

## Local Setup

```bash
# 1. Clone
git clone https://github.com/water-k-max/Sentient-Finance-
cd Sentient-Finance-

# 2. Install dependencies
npm install
cd frontend && npm install && cd ..

# 3. Configure environment
cp .env.example .env
# Add your PRIVATE_KEY and SOMNIA_RPC_URL

# 4. Run tests (77 passing)
npx hardhat test

# 5. Deploy to local Hardhat node
npx hardhat node          # in one terminal
npx hardhat run scripts/deploy.ts --network localhost

# 6. Deploy to Somnia testnet
npx hardhat run scripts/deploy.ts --network somnia

# 7. Sync address files after deploy
npx hardhat run scripts/sync-addresses.ts

# 8. Run one-shot demo (seed → open position → crash → liquidate)
npx hardhat run scripts/demoFullFlow.ts --network somnia

# 9. Or run continuous price feed + demo flow in separate terminals:
npx hardhat run scripts/priceFeed.ts --network somnia   # terminal 1
npx hardhat run scripts/demoFullFlow.ts --network somnia # terminal 2

# 10. Start frontend
npm run dev --prefix frontend
```

## Deployed Contracts

Addresses are tracked in `deployed-addresses.json` (canonical source) and auto-synced to `scripts/addresses.ts` and `frontend/src/config/addresses.ts` via `npm run sync-addresses`.

See [`deployed-addresses.json`](./deployed-addresses.json) for the current testnet addresses.

## Demo Flow

The quickest way to see the full system in action:

```bash
npm run demo
```

This runs `demoFullFlow.ts` which:
1. Fetches live BTC price from CoinGecko, pushes it on-chain
2. Clears stale orders via the factory, seeds the book through the LP agent
3. Funds a wallet and opens a leveraged long against the LP agent's ask
4. Verifies the position is open with correct health
5. Crashes the price 12% below entry — crossing the liquidation threshold
6. Fires the reactive cascade via `simulatePriceUpdate`
7. Verifies `LiquidationExecuted` event fired and position closed

**All within a single script. No manual step between seeding, matching, and liquidation.**

See [`docs/PITCH_DEMO_SCRIPT.md`](./docs/PITCH_DEMO_SCRIPT.md) for the full demo transcript and video script.

## The Graph Subgraph

Sentient Finance includes a subgraph configuration for indexing on-chain events:

```bash
# Install Graph CLI
npm install -g @graphprotocol/graph-cli

# Generate types from ABIs
graph codegen subgraph/subgraph.yaml

# Deploy to The Graph (requires Graph Node + IPFS)
graph deploy --node https://api.thegraph.com/deploy/ --ipfs https://api.thegraph.com/ipfs/ <your-account>/sentient-finance
```

**Indexed entities:** `Order`, `Match`, `Liquidation`, `Position`, `Stats`
**GraphQL queries:** historical orders, match history, liquidation events, open positions, protocol stats

## Somnia Agent Integration

Sentient Finance integrates with **all three** Somnia decentralized AI agent types via `SentimentOracle.sol`:

- **JSON API Agent** (`agentId: 13174292974160097713`, 0.03 STT) — Fetches live BTC/USD from CoinGecko API. Uses `fetchUint()` with Majority consensus (3 of 3 validators must agree).
- **LLM Parse Website Agent** (`agentId: 12875401142070969085`, 0.10 STT) — Visits CoinDesk homepage and extracts BTC price using LLM vision. Uses `extractANumber()` with Threshold consensus (2 of 3).
- **LLM Inference Agent** (`agentId: 12847293847561029384`, 0.07 STT) — Two independent calls: `inferString()` for sentiment analysis (bullish/bearish/neutral, temp=0) and `inferNumber()` for volatility scoring (0–100). Deterministic — all 3 validators produce byte-identical output.

All agent calls use the **two-pot gas model**: `getAdvancedRequestDeposit(SUBCOMMITTEE_SIZE) + pricePerAgent × SUBCOMMITTEE_SIZE` (~0.69 STT per full cycle).

**Note:** Agent callbacks have 30-120 second latency on testnet — suitable for periodic price verification, not real-time trading. The `priceFeed.ts` script handles sub-second updates.

The `AgentDashboard` page polls `SentimentOracle` every 5 seconds and displays the live status of all three agents, the consensus price, and the resulting Enhanced LP Agent spread adjustment.

## Test Coverage

**77 tests passing** across 9 test suites:

| Suite | Tests | Description |
|-------|-------|-------------|
| `OrderBook.test.ts` | 10 | Placement, matching, partial fills, heap ordering, cancellation, depth |
| `OrderBookFactory.test.ts` | 11 | Deployment, createOrderBook, adminClearBook passthrough (success, missing pair, non-owner, margin release, empty book) |
| `MarginVault.test.ts` | 7 | Deposits, liquidation prices, withdrawals, authorization |
| `MarginVault.property.test.ts` | 5 | Fast-check: liq price invariants, monotonicity (100+ property runs each) |
| `OrderBook.invariant.test.ts` | 27 | Fast-check: heap ordering, ID monotonicity, margin non-negative fuzz (2300+ runs) |
| `LiquidationSentinel.test.ts` | 4 | Position checks, pause/unpause, liquidation guards |
| `AgentIntegration.test.ts` | 6 | Reactive order flow, price updates, LP rebalance (including filled-order regression), full cascade liquidation |
| `AgentOracle.test.ts` | 7 | Deployment, constants, view functions, agent ID verification |
| `SentimentOracle.test.ts` | 18 | Deployment, constants, CoinGecko/CoinDesk config, divergence threshold, sentiment values |

Includes **property-based tests** (fast-check) for heap ordering invariants and liquidation price correctness.

## Known Limitations (See docs/KNOWN_ISSUES.md)

- **PerpEngine.setIndexPrice()** has no access control (testnet-safe, critical fix needed before mainnet)
- **Self-match heap corruption** risk in OrderBook._attemptMatch()
- **9 of 16 contracts** have no direct unit tests (only integration test coverage)
- **O(n) liquidation gas** scales with number of open positions
- **Frontend hooks** have minor bugs (useEventFeed ignores _pair param)
- **Some scripts** reference contract address keys not in deployed-addresses.json

See [`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md) for the full inventory.

## Tech Stack

- **Solidity 0.8.24** — Smart contracts
- **Hardhat 2** — Development framework, testing
- **ethers.js v6** — Contract interaction
- **fast-check** — Property-based and invariant testing
- **React 18 + Vite + TypeScript** — Frontend
- **Recharts** — Price charting with AreaChart + gradient fill
- **Tailwind CSS** — Styling (dark terminal aesthetic)
- **The Graph** — Event indexing (subgraph)
- **Somnia L1** — Deployment target (testnet)

## License

MIT

---

*Built for the Somnia Agentathon 2026, hosted by Encode Club.*
