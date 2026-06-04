# Sentient Finance

> **A Fully On-Chain Reactive Perpetual Matching Engine for AI Agents**

![Trading Dashboard](https://img.shields.io/badge/Somnia-Agentathon-00E5FF?style=for-the-badge)
![Tests](https://img.shields.io/badge/tests-65%20passing-00E676?style=for-the-badge)
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
| `MockUSDC.sol` | 6-decimal USDC mock for collateral (OpenZeppelin ERC20) | `mint`, `approve`, `transfer` |

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

# 4. Run tests (65 passing)
npx hardhat test

# 5. Deploy to local Hardhat node
npx hardhat node          # in one terminal
npx hardhat run scripts/deploy.ts --network localhost

# 6. Deploy to Somnia testnet
npx hardhat run scripts/deploy.ts --network somnia

# 7. Full demo setup (deploy → seed → push price)
npx hardhat run scripts/demoSetup.ts --network somnia

# 8. Update price + LP agent rebalance (run anytime)
npx hardhat run scripts/updatePrice.ts --network somnia

# 9. Standalone liquidation demo
npx hardhat run scripts/demoLiquidation.ts --network somnia

# 10. Start frontend
npm run dev --prefix frontend
```

## Testnet Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| MockUSDC | `0x8D06699a029869f88437ecb10736B57306D3953F` | [View](https://explorer.testnet.somnia.network/address/0x8D06699a029869f88437ecb10736B57306D3953F) |
| MockPriceFeed | `0xfFcfbe79bAe362734bE77712a34b9Fb35fa86680` | [View](https://explorer.testnet.somnia.network/address/0xfFcfbe79bAe362734bE77712a34b9Fb35fa86680) |
| OracleAdapter | `0xA159BE1397c49f8Bb662E1ae7E9477BeAf9899c1` | [View](https://explorer.testnet.somnia.network/address/0xA159BE1397c49f8Bb662E1ae7E9477BeAf9899c1) |
| MarginVault | `0x2396207Bfe22190E0d8B8A511E9Ceae7d4E3f15D` | [View](https://explorer.testnet.somnia.network/address/0x2396207Bfe22190E0d8B8A511E9Ceae7d4E3f15D) |
| OrderBookFactory | `0xae27803c296916eE36A83220670eB918cAE4BcA5` | [View](https://explorer.testnet.somnia.network/address/0xae27803c296916eE36A83220670eB918cAE4BcA5) |
| BTC-USD OrderBook | `0x3B10165FD2490575fD514BE52cCCcAd57b3a284e` | [View](https://explorer.testnet.somnia.network/address/0x3B10165FD2490575fD514BE52cCCcAd57b3a284e) |
| ETH-USD OrderBook | `0xddFBCae15030fF8b23CAd5F4598e7f7801F8A2f9` | [View](https://explorer.testnet.somnia.network/address/0xddFBCae15030fF8b23CAd5F4598e7f7801F8A2f9) |
| SOL-USD OrderBook | `0x51B411C22daaBc6130600e4c86cCe1Fac3E588CC` | [View](https://explorer.testnet.somnia.network/address/0x51B411C22daaBc6130600e4c86cCe1Fac3E588CC) |
| PerpEngine | `0x67bae6CA52fAEeB93C1cABAD9C5821A25124F871` | [View](https://explorer.testnet.somnia.network/address/0x67bae6CA52fAEeB93C1cABAD9C5821A25124F871) |
| LiquidationSentinel | `0xDBB064C78d0d42527a702fFe4d9e8F359f58FB8D` | [View](https://explorer.testnet.somnia.network/address/0xDBB064C78d0d42527a702fFe4d9e8F359f58FB8D) |
| LiquidityProviderAgent | `0x1Ed3f6994C66aBCd142cEF939D7A50B518fD4246` | [View](https://explorer.testnet.somnia.network/address/0x1Ed3f6994C66aBCd142cEF939D7A50B518fD4246) |
| AgentInterface | `0x7C07f58CBF26Ae5FFaEBB277A30283935E5E499F` | [View](https://explorer.testnet.somnia.network/address/0x7C07f58CBF26Ae5FFaEBB277A30283935E5E499F) |
| AgentOracle | `0x65E02f9D13A8D8E35e5D7e9f62Ae90dcA38140b2` | [View](https://explorer.testnet.somnia.network/address/0x65E02f9D13A8D8E35e5D7e9f62Ae90dcA38140b2) |
| SentimentOracle | `0xFCd8440d2097B7297A9c0944B7Bd448D9D4dCB2f` | [View](https://explorer.testnet.somnia.network/address/0xFCd8440d2097B7297A9c0944B7Bd448D9D4dCB2f) |
| EnhancedLPAgent | `0x5e9f53f52C7368C6c857e38e4ED2560cB29dfBF4` | [View](https://explorer.testnet.somnia.network/address/0x5e9f53f52C7368C6c857e38e4ED2560cB29dfBF4) |

Deployed on Somnia testnet. Addresses are tracked in `scripts/addresses.ts` (canonical) and `frontend/src/config/addresses.ts` (frontend copy).

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

**65 tests passing** across 7 test suites:

| Suite | Tests | Description |
|-------|-------|-------------|
| `OrderBook.test.ts` | 10 | Placement, matching, partial fills, heap ordering, cancellation, depth |
| `MarginVault.test.ts` | 7 | Deposits, liquidation prices, withdrawals, authorization |
| `LiquidationSentinel.test.ts` | 4 | Position checks, pause/unpause, liquidation guards |
| `AgentIntegration.test.ts` | 5 | Reactive order flow, price updates, LP rebalance, full cascade liquidation |
| `AgentOracle.test.ts` | 7 | Deployment, constants, view functions, agent ID verification |
| `MarginVault.property.test.ts` | 5 | Fast-check: liq price invariants, monotonicity (100+ property runs each) |
| `OrderBook.invariant.test.ts` | 27 | Fast-check: heap ordering, ID monotonicity, margin non-negative fuzz (2300+ runs) |

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
