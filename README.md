# Sentient Finance

> **A Fully On-Chain Reactive Perpetual Matching Engine for AI Agents**

![Trading Dashboard](https://img.shields.io/badge/Somnia-Agentathon-00E5FF?style=for-the-badge)
![Tests](https://img.shields.io/badge/tests-49%20passing-00E676?style=for-the-badge)
![Contracts](https://img.shields.io/badge/contracts-10%20deployed-00E5FF?style=for-the-badge)
![Multi-Pair](https://img.shields.io/badge/pairs-BTC%20%7C%20ETH%20%7C%20SOL-8B5CF6?style=for-the-badge)

---

## The Problem

Traditional perpetual DEXes (dYdX, GMX, Hyperliquid) all share a critical weakness: they depend on **off-chain keeper infrastructure** — external bots, cron jobs, or centralized sequencers — to match orders, liquidate positions, and update prices. This introduces:

- **MEV exposure** — keepers front-run and extract value from traders
- **Censorship risk** — centralized keepers can be pressured or disabled
- **Latency bottlenecks** — off-chain → on-chain round-trips add seconds of delay
- **Trust assumptions** — you must trust the keeper operator to act honestly and promptly

## The Somnia Solution

Sentient Finance eliminates the keeper entirely. Using **Somnia's reactive execution layer**, every event (new order, price update) automatically triggers the appropriate on-chain action **within the same block** — no external caller needed.

```
[New Order Event] → [Somnia Reactive Layer] → [_attemptMatch() called] → [Position Opened]
                                                                        ↓
[Oracle Price Update] → [Somnia Reactive Layer] → [updateAllPnL() → checkAllPositions() → liquidate()]
                                                                        ↓
[LP Agent Reacts] → [Rebalance orders at new mid-price]
```

**All within a single block. Zero off-chain scripts. Zero MEV bots. Pure on-chain autonomy.**

### Why Somnia?

- **MultiStream BFT consensus** — sub-second finality enables reactive patterns impossible on other EVMs
- **IceDB state layer** — efficient state access makes iterating all positions gas-feasible
- **Reactive extensions** — contracts subscribe to events and auto-execute, no keeper needed

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
│ OrderBook.sol│   MarginVault.sol   │    OracleAdapter.sol        │
│  (per-pair)  │   (Clearinghouse)   │   (Mock / Live)             │
├──────────────┴─────────────────────┴────────────────────────────┤
│                     AgentInterface.sol                           │
│                (Reactive Gateway)                                │
├──────────────────────────────┬──────────────────────────────────┤
│  LiquidationSentinel.sol     │  LiquidityProviderAgent.sol      │
│  (Auto-liquidate agent)      │  (Auto-LP agent)                 │
├──────────────────────────────┴──────────────────────────────────┤
│  AgentOracle.sol ──→ Somnia JSON API Agent → CoinGecko API      │
│  OrderBookFactory.sol ──→ deploys per-pair OrderBooks            │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Contract Breakdown

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| `OrderBook.sol` | Heap-based order matching (max-heap bids, min-heap asks) | `placeOrder`, `cancelOrder`, `_attemptMatch`, `getOrderBookDepth` |
| `OrderBookFactory.sol` | Deploys isolated OrderBook per trading pair | `createOrderBook`, `getAllPairs`, `pairOrderBooks` |
| `MarginVault.sol` | Collateral management, PnL, liquidation enforcement | `deposit`, `settlePosition`, `updatePnL`, `updateAllPnL`, `liquidate` |
| `PerpEngine.sol` | Multi-pair coordinator, funding rates, VWAP mark price | `registerPair`, `openPosition(pairId)`, `computeFundingRate(pairId)` |
| `OracleAdapter.sol` | Price feed wrapper (Chainlink/Protofire/mock) | `updatePrice`, `updatePriceDirect`, `getIndexPrice` |
| `AgentOracle.sol` | Somnia JSON API Agent → CoinGecko live BTC/USD | `requestPrice{deposit}()`, `handleResponse()` async callback |
| `AgentInterface.sol` | Reactive event gateway, wires Sentinel + LP Agent | `subscribe`, `onEvent`, `simulatePriceUpdate` |
| `LiquidationSentinel.sol` | Autonomous liquidation agent | `checkAllPositions`, `liquidatePosition`, reverse-iterate trackedTraders |
| `LiquidityProviderAgent.sol` | Autonomous market-making agent | `initialize`, `rebalance`, adaptive spread on volatility |
| `MockPriceFeed.sol` | Admin-controlled price feed for testing | `updatePrice` |

## Agent Design

### Liquidation Sentinel
- **Trigger:** Oracle price update → `AgentInterface.onEvent` → `updateAllPnL`
- **Action:** Iterates all tracked positions in reverse, calls `liquidate()` on any with health < 5%
- **Result:** Positions are liquidated autonomously — no MEV bot needed

### Liquidity Provider Agent
- **Trigger:** Price moves > 1% from last mid-price (via reactive cascade)
- **Action:** Cancels stale orders, places new bid/ask pair at mid ± spread
- **Adaptive:** Widens spread during high volatility (5+ consecutive >1% moves)

### AgentOracle (Somnia JSON API Agent)
- **Trigger:** User calls `requestPrice()` with 0.12 STT deposit
- **Action:** Creates async request to CoinGecko API via Somnia's JSON API Agent
- **Callback:** `handleResponse()` decodes price → emits `PriceUpdated` → triggers full reactive cascade
- **This is the core "contract takes action with data returned by the agent" use case**

## Zero Keeper Proof

| Component | Traditional Approach | Sentient Finance |
|-----------|---------------------|------------------|
| Order matching | Keeper bot monitors mempool | Reactive `_attemptMatch()` fires on `OrderPlaced` event |
| Liquidations | MEV bots scan positions | Sentinel checks reactively on price update |
| Market making | Off-chain MM algorithms | LP Agent rebalances on-chain via reactive trigger |
| Price updates | Chainlink Automation / cron | OracleAdapter/AgentOracle → reactive PnL cascade |

**No off-chain script. No cron job. No Chainlink Automation. No keeper EOA.**

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

# 4. Run tests (49 passing)
npx hardhat test

# 5. Deploy to local Hardhat node
npx hardhat node          # in one terminal
npx hardhat run scripts/deploy.ts --network localhost

# 6. Deploy to Somnia testnet
npx hardhat run scripts/deploy.ts --network somnia

# 7. Seed order book (after deployment)
npx hardhat run scripts/seedOrderBook.ts --network somnia -- <orderBookAddr> <marginVaultAddr>

# 8. Start frontend
cd frontend && npm run dev
```

## Testnet Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| MockPriceFeed | `TBD` | [View](#) |
| OracleAdapter | `TBD` | [View](#) |
| MarginVault | `TBD` | [View](#) |
| OrderBookFactory | `TBD` | [View](#) |
| BTC-USD OrderBook | `TBD` | [View](#) |
| ETH-USD OrderBook | `TBD` | [View](#) |
| SOL-USD OrderBook | `TBD` | [View](#) |
| PerpEngine | `TBD` | [View](#) |
| LiquidationSentinel | `TBD` | [View](#) |
| LiquidityProviderAgent | `TBD` | [View](#) |
| AgentInterface | `TBD` | [View](#) |
| AgentOracle | `TBD` | [View](#) |

*Addresses populated after testnet deployment.*

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

Sentient Finance integrates with Somnia's decentralized AI agents:

- **JSON API Agent** (`agentId: 13174292974160097713`, 0.03 STT) — AgentOracle fetches live CoinGecko BTC/USD
- **LLM Inference Agent** (`agentId: 12847293847561029384`, 0.07 STT) — Future: sentiment-based spread adjustment for LP Agent
- **LLM Parse Website Agent** (`agentId: 12875401142070969085`, 0.10 STT) — Future: extract prices from financial news sites

All agent calls use the **two-pot gas model**: `getRequestDeposit() + pricePerAgent × subcommitteeSize`

## Test Coverage

**49 tests passing** across 7 test suites:

| Suite | Tests | Description |
|-------|-------|-------------|
| `OrderBook.test.ts` | 9 | Placement, matching, partial fills, heap ordering, cancellation, depth |
| `MarginVault.test.ts` | 6 | Deposits, liquidation prices, withdrawals, authorization |
| `LiquidationSentinel.test.ts` | 4 | Position checks, pause/unpause, liquidation guards |
| `AgentIntegration.test.ts` | 5 | Reactive order flow, price updates, LP rebalance, full cascade liquidation |
| `AgentOracle.test.ts` | 7 | Deployment, constants, view functions, agent ID verification |
| `MarginVault.property.test.ts` | 5 | Fast-check: liq price invariants, monotonicity (100+ property runs each) |
| `OrderBook.invariant.test.ts` | 13 | Fast-check: heap ordering, ID monotonicity, margin non-negative fuzz |

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
