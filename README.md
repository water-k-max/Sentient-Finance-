# Sentient Finance

> **A Fully On-Chain Reactive Perpetual Matching Engine for AI Agents**

![Trading Dashboard](https://img.shields.io/badge/Somnia-Agentathon-00E5FF?style=for-the-badge)

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
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Vite)                     │
│  TradingView │ AgentDashboard │ Stats │ Wallet Connection    │
└────────────────────────┬────────────────────────────────────┘
                         │ ethers.js v6
┌────────────────────────▼────────────────────────────────────┐
│                     PerpEngine.sol                           │
│              (Coordinator / Entry Point)                     │
├──────────────┬─────────────────────┬────────────────────────┤
│ OrderBook.sol│   MarginVault.sol   │    OracleAdapter.sol    │
│  (Matching)  │   (Clearinghouse)   │   (Price Feed Wrap)     │
├──────────────┴─────────────────────┴────────────────────────┤
│                     AgentInterface.sol                       │
│                (Reactive Gateway)                            │
├──────────────────────────────┬──────────────────────────────┤
│  LiquidationSentinel.sol     │  LiquidityProviderAgent.sol  │
│  (Auto-liquidate agent)      │  (Auto-LP agent)             │
└──────────────────────────────┴──────────────────────────────┘
```

## Smart Contract Breakdown

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| `OrderBook.sol` | On-chain order book with native matching | `placeOrder`, `cancelOrder`, `_attemptMatch`, heap operations |
| `MarginVault.sol` | Collateral management, PnL, liquidation enforcement | `deposit`, `settlePosition`, `updatePnL`, `liquidate` |
| `PerpEngine.sol` | Top-level coordinator, funding rates | `openPosition`, `computeFundingRate`, `applyFunding` |
| `OracleAdapter.sol` | Price feed wrapper (Chainlink/Protofire/mock) | `updatePrice`, `getIndexPrice` |
| `AgentInterface.sol` | Reactive event gateway | `subscribe`, `onEvent` |
| `LiquidationSentinel.sol` | Autonomous liquidation agent | `checkAllPositions`, `liquidatePosition` |
| `LiquidityProviderAgent.sol` | Autonomous market-making agent | `initialize`, `rebalance`, `adjustSpread` |
| `MockPriceFeed.sol` | Admin-controlled price feed for testing | `updatePrice` |

## Agent Design

### Liquidation Sentinel
- **Trigger:** Oracle price update → `AgentInterface.onEvent` → `updateAllPnL`
- **Action:** Iterates all tracked positions, calls `liquidate()` on any with health < 5%
- **Result:** Positions are liquidated autonomously — no MEV bot needed

### Liquidity Provider Agent
- **Trigger:** Price moves > 1% from last mid-price
- **Action:** Cancels stale orders, places new bid/ask pair at mid ± spread
- **Adaptive:** Widens spread during high volatility (5+ consecutive >1% moves)

## Zero Keeper Proof

| Component | Traditional Approach | Sentient Finance |
|-----------|---------------------|------------------|
| Order matching | Keeper bot monitors mempool | Reactive `_attemptMatch()` fires on `OrderPlaced` event |
| Liquidations | MEV bots scan positions | Sentinel checks reactively on price update |
| Market making | Off-chain MM algorithms | LP Agent rebalances on-chain via reactive trigger |
| Price updates | Chainlink Automation / cron | OracleAdapter emits → reactive PnL cascade |

**No off-chain script. No cron job. No Chainlink Automation. No keeper EOA.**

## Local Setup

```bash
# 1. Clone
git clone https://github.com/your-org/sentient-finance
cd sentient-finance

# 2. Install dependencies
npm install
cd frontend && npm install && cd ..

# 3. Configure environment
cp .env.example .env
# Add your PRIVATE_KEY and SOMNIA_RPC_URL

# 4. Run tests
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
| OrderBook | `TBD` | [View](#) |
| PerpEngine | `TBD` | [View](#) |
| LiquidationSentinel | `TBD` | [View](#) |
| LiquidityProviderAgent | `TBD` | [View](#) |
| AgentInterface | `TBD` | [View](#) |

*Addresses populated after testnet deployment.*

## Somnia Agent Integration

Sentient Finance is designed to integrate with Somnia's decentralized AI agents:

- **JSON API Agent** — Fetch live crypto prices from CoinGecko/Coinbase APIs as oracle input
- **LLM Inference Agent** — Power sentiment-based spread adjustment for the LP Agent
- **LLM Parse Website Agent** — Extract prices from financial news sites without APIs

All agent calls use the **two-pot gas model**: `getRequestDeposit() + pricePerAgent × subcommitteeSize`

## Tech Stack

- **Solidity 0.8.24** — Smart contracts
- **Hardhat 2** — Development framework, testing
- **ethers.js v6** — Contract interaction
- **React 18 + Vite + TypeScript** — Frontend
- **Tailwind CSS** — Styling (dark terminal aesthetic)
- **Somnia L1** — Deployment target (testnet)

## License

MIT

---

*Built for the Somnia Agentathon 2026, hosted by Encode Club.*
