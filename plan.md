Here is a comprehensive, developer-ready prompt you can drop into any AI coding agent, give to a team member, or use as your own north star throughout the build:

---

# SENTIENT FINANCE — Full Project Development Prompt

---

## 0. Project Identity

**Project Name:** Sentient Finance
**Tagline:** A Fully On-Chain Reactive Perpetual Matching Engine for AI Agents
**Target Chain:** Somnia L1 (EVM-compatible, MultiStream BFT consensus, IceDB state layer)
**Hackathon:** Somnia Agentathon hosted by Encode Club
**Submission Format:** Working demo + GitHub repo + Devpost writeup + 2–5 min video

The entire project must demonstrate that Somnia's reactive architecture makes autonomous, keeper-free, MEV-resistant on-chain derivatives a reality. Every design decision — smart contract, agent logic, frontend — must reinforce this narrative.

---

## 1. High-Level Goals

1. Deploy a fully functional **Perpetual Swap matching engine** entirely on-chain on Somnia testnet.
2. Implement **autonomous on-chain agents** (LP Agent + Liquidation Sentinel) that operate without any off-chain keeper infrastructure.
3. Build a **live trading dashboard** frontend that visualizes order book depth, positions, PnL, and agent activity in real time.
4. Produce a clean, professional GitHub README and Devpost submission that clearly communicates the architectural advantage over traditional keeper-based designs.

---

## 2. Monorepo Structure

```
sentient-finance/
├── contracts/                  # All Solidity smart contracts
│   ├── core/
│   │   ├── OrderBook.sol
│   │   ├── MarginVault.sol
│   │   └── PerpEngine.sol
│   ├── agents/
│   │   ├── AgentInterface.sol
│   │   ├── LiquidityProviderAgent.sol
│   │   └── LiquidationSentinel.sol
│   ├── oracles/
│   │   └── OracleAdapter.sol
│   └── interfaces/
│       ├── IOrderBook.sol
│       ├── IMarginVault.sol
│       └── IAgent.sol
├── scripts/                    # Hardhat deploy + interaction scripts
│   ├── deploy.ts
│   ├── seedOrderBook.ts
│   └── verifyContracts.ts
├── test/                       # Hardhat + Foundry tests
│   ├── OrderBook.test.ts
│   ├── MarginVault.test.ts
│   ├── LiquidationSentinel.test.ts
│   └── AgentIntegration.test.ts
├── frontend/                   # React/Vite trading dashboard
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── lib/
│   └── public/
├── subgraph/                   # Optional: The Graph indexer for order history
│   ├── schema.graphql
│   └── mappings/
├── docs/
│   ├── ARCHITECTURE.md
│   └── AGENT_DESIGN.md
├── hardhat.config.ts
├── .env.example
└── README.md
```

---

## 3. Smart Contracts — Detailed Specification

### 3.1 `OrderBook.sol`

**Purpose:** Maintains the live bid and ask queues for a single trading pair (e.g., BTC-USD perpetual). Executes matching logic natively on every new order insertion.

**Storage Design:**
```solidity
struct Order {
    uint256 id;
    address trader;
    bool isBid;           // true = buy, false = sell
    uint256 price;        // Fixed-point, 8 decimals (e.g., 1e8 = $1.00)
    uint256 size;         // In base asset units, 18 decimals
    uint256 margin;       // Collateral locked in MarginVault for this order
    uint256 timestamp;
    OrderStatus status;   // OPEN, FILLED, PARTIALLY_FILLED, CANCELLED
}

enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED }

// Sorted heaps: bids descending by price, asks ascending by price
mapping(uint256 => Order) public orders;
uint256[] public bidHeap;
uint256[] public askHeap;
uint256 public nextOrderId;
```

**Core Functions:**
- `placeOrder(bool isBid, uint256 price, uint256 size, uint256 leverage)` — Validates margin via `MarginVault`, inserts order, immediately calls `_attemptMatch()`.
- `cancelOrder(uint256 orderId)` — Removes order from heap, releases margin.
- `_attemptMatch()` internal — Checks if `bestBid() >= bestAsk()`. If true, executes a fill, emits `OrderMatched`, calls `MarginVault.settlePosition()`.
- `_insertBid(uint256 orderId)` / `_insertAsk(uint256 orderId)` — Max-heap and min-heap insertion logic respectively.
- `bestBid()` / `bestAsk()` — Returns top of each heap.
- `getOrderBookDepth(uint256 levels)` — Returns aggregated price/size arrays for frontend visualization.

**Events:**
```solidity
event OrderPlaced(uint256 indexed orderId, address indexed trader, bool isBid, uint256 price, uint256 size);
event OrderMatched(uint256 indexed bidOrderId, uint256 indexed askOrderId, uint256 fillPrice, uint256 fillSize);
event OrderCancelled(uint256 indexed orderId);
```

**Reactive Hook (Somnia-specific):**
After every `placeOrder` call, emit a state-change event that Somnia's reactive execution layer is subscribed to. The reactive layer will re-invoke `_attemptMatch()` if new crossing orders are detected within the same block. Implement this via the `AgentInterface.sol` reactive gateway pattern.

---

### 3.2 `MarginVault.sol`

**Purpose:** Acts as the clearinghouse. Manages all user collateral, tracks open positions, computes unrealized PnL, and enforces margin requirements.

**Storage Design:**
```solidity
struct Position {
    address trader;
    bool isLong;
    uint256 entryPrice;     // 8 decimals
    uint256 size;           // 18 decimals
    uint256 margin;         // Collateral in USDC (6 decimals)
    uint256 leverage;       // e.g., 10 = 10x
    int256 unrealizedPnl;   // Updated on every oracle tick
    uint256 liquidationPrice;
    bool isOpen;
}

mapping(address => uint256) public collateralBalances;
mapping(address => Position) public positions;
mapping(address => uint256) public marginHealth; // health factor, 18 decimals; < 1e18 = liquidatable
```

**Core Functions:**
- `deposit(uint256 amount)` — Accepts USDC, updates `collateralBalances`.
- `withdraw(uint256 amount)` — Validates free margin before releasing funds.
- `lockMargin(address trader, uint256 amount)` — Called by `OrderBook` on order placement.
- `settlePosition(address longTrader, address shortTrader, uint256 fillPrice, uint256 fillSize)` — Opens positions for both counterparties, computes `liquidationPrice`.
- `updatePnL(address trader, uint256 currentIndexPrice)` — Recomputes `unrealizedPnl` and `marginHealth`. Called by oracle updates and the Sentinel.
- `liquidate(address trader)` — Only callable by `LiquidationSentinel`. Closes position, distributes remaining margin to insurance fund, emits event.
- `computeLiquidationPrice(bool isLong, uint256 entryPrice, uint256 leverage)` — Pure function. Formula: for longs: `entryPrice * (1 - 1/leverage + maintenanceMarginRatio)`.

**PnL Formula (implement precisely):**
```
unrealizedPnl = (currentIndexPrice - entryPrice) * size   [for longs]
unrealizedPnl = (entryPrice - currentIndexPrice) * size   [for shorts]
marginHealth  = (margin + unrealizedPnl) / (size / leverage)
```
If `marginHealth < maintenanceThreshold` (suggest 0.05e18 = 5%), position is eligible for liquidation.

---

### 3.3 `PerpEngine.sol`

**Purpose:** Top-level coordinator contract. Acts as the single entry point for the frontend and agents. Handles funding rate computation and periodic settlement.

**Core Functions:**
- `openPosition(bool isLong, uint256 size, uint256 leverage, uint256 limitPrice)` — Routes to `OrderBook.placeOrder()`.
- `closePosition()` — Places an opposing market order for the trader's full open size.
- `computeFundingRate()` view — Returns current funding rate based on mark price vs index price divergence. Formula: `fundingRate = (markPrice - indexPrice) / indexPrice / fundingInterval`.
- `applyFunding()` — Called reactively every funding interval (suggest 8 hours). Transfers funding payments between longs and shorts via `MarginVault`.
- `getMarkPrice()` view — Returns volume-weighted average of recent fill prices from `OrderBook`.

---

### 3.4 `OracleAdapter.sol`

**Purpose:** Wraps Protofire/Chainlink price feeds deployed on Somnia testnet. Provides a clean `getIndexPrice(bytes32 assetId)` interface used by `MarginVault` and the Sentinel.

**Implementation Notes:**
- Check Somnia testnet documentation for the exact deployed Chainlink OCR feed addresses. If unavailable at build time, deploy a mock `MockPriceFeed.sol` with an `updatePrice(uint256 price)` function controlled by an admin EOA for demo purposes.
- Emit `PriceUpdated(bytes32 assetId, uint256 price, uint256 timestamp)` on every update.
- The reactive layer should hook into this event to trigger `MarginVault.updatePnL()` for all open positions.

---

### 3.5 `AgentInterface.sol`

**Purpose:** The reactive gateway. Implements Somnia's reactive event subscription pattern. This is the contract that makes the system "self-driving."

**Core Logic:**
```solidity
// Somnia Reactive Pattern
// This contract subscribes to events from OrderBook and OracleAdapter
// and autonomously dispatches execution without any external caller.

interface ISomniaReactive {
    function subscribe(address contractAddress, bytes32 eventTopic) external;
    function onEvent(address source, bytes32 topic, bytes calldata data) external;
}

contract AgentInterface is ISomniaReactive {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    ILiquidationSentinel public sentinel;

    // Called by Somnia's reactive layer when a subscribed event fires
    function onEvent(address source, bytes32 topic, bytes calldata data) external override {
        if (topic == PRICE_UPDATED_TOPIC) {
            (bytes32 assetId, uint256 newPrice) = abi.decode(data, (bytes32, uint256));
            marginVault.updateAllPnL(newPrice);
            sentinel.checkAllPositions(newPrice);
        }
        if (topic == ORDER_PLACED_TOPIC) {
            orderBook.attemptMatch();
        }
    }
}
```

**Subscription Setup (in deploy script):**
```typescript
await agentInterface.subscribe(orderBook.address, ORDER_PLACED_TOPIC);
await agentInterface.subscribe(oracleAdapter.address, PRICE_UPDATED_TOPIC);
```

---

### 3.6 `LiquidationSentinel.sol`

**Purpose:** Autonomous on-chain agent. Monitors all open positions and fires liquidations the moment margin health drops below threshold. Replaces MEV bots entirely.

**Storage:**
```solidity
address[] public trackedTraders;
mapping(address => bool) public isTracked;
```

**Core Functions:**
- `registerPosition(address trader)` — Called by `MarginVault.settlePosition()`. Adds trader to monitoring list.
- `checkAllPositions(uint256 currentPrice)` — Iterates `trackedTraders`, calls `marginVault.marginHealth(trader)`. If below threshold, calls `marginVault.liquidate(trader)` and emits `LiquidationExecuted`.
- `deregisterPosition(address trader)` — Called after a position is closed or liquidated.

**Gas Optimization Note:** For hackathon purposes, linear iteration is acceptable. In production, implement a sorted linked list keyed by liquidation price so the sentinel only needs to check positions closest to the current price.

---

### 3.7 `LiquidityProviderAgent.sol`

**Purpose:** Autonomous AI-inspired LP agent. Places and continuously rebalances two-sided limit orders (bid + ask) around the current index price to provide market depth.

**Configuration:**
```solidity
uint256 public spreadBps;       // e.g., 20 = 0.20% spread
uint256 public orderSizeUSDC;   // Notional size per side
uint256 public rebalanceThreshold; // Price move % that triggers rebalance
uint256 public activeBidOrderId;
uint256 public activeAskOrderId;
```

**Core Functions:**
- `initialize(uint256 _spreadBps, uint256 _orderSizeUSDC)` — Sets parameters, deposits initial capital into `MarginVault`, places first bid/ask pair.
- `rebalance(uint256 currentIndexPrice)` — Called reactively via `AgentInterface` on `PRICE_UPDATED_TOPIC`. Cancels stale orders if price has moved beyond `rebalanceThreshold`, places fresh orders at new mid ± spread.
- `_placeOrders(uint256 midPrice)` internal — Computes `bidPrice = midPrice * (1 - spreadBps/10000)` and `askPrice = midPrice * (1 + spreadBps/10000)`. Calls `orderBook.placeOrder()` for both sides.
- `adjustSpread(uint256 volatilityScore)` — Widens spread during high volatility (simple heuristic: if last 5 price updates moved >1% each, double the spread).

---

## 4. Deployment Scripts

### `scripts/deploy.ts`
Deploy in this exact order to resolve dependencies:
1. Deploy `MockPriceFeed` (or connect to live Chainlink feed)
2. Deploy `OracleAdapter` with feed address
3. Deploy `MarginVault`
4. Deploy `OrderBook` with `MarginVault` address
5. Deploy `PerpEngine` with `OrderBook` + `MarginVault` addresses
6. Deploy `AgentInterface` with all contract addresses
7. Deploy `LiquidationSentinel` with `MarginVault` address
8. Deploy `LiquidityProviderAgent` with `OrderBook` + `MarginVault` addresses
9. Wire permissions: `MarginVault.setAuthorized(OrderBook, LiquidationSentinel)`
10. Subscribe reactive hooks: `AgentInterface.subscribe(OrderBook, ORDER_PLACED_TOPIC)` and `AgentInterface.subscribe(OracleAdapter, PRICE_UPDATED_TOPIC)`
11. Fund `LiquidityProviderAgent` with testnet USDC and call `initialize()`
12. Verify all contracts on Somnia block explorer

### `scripts/seedOrderBook.ts`
Place 10 staggered limit buy orders and 10 staggered limit sell orders from test wallets to give the order book initial depth for the demo. Price them around the mock oracle's initial price with 0.1% increments.

---

## 5. Test Suite

Write tests for every critical path. Use Hardhat with ethers.js v6.

### `OrderBook.test.ts`
- `placeOrder` reverts if margin is insufficient
- Single bid and single ask at crossing prices → `OrderMatched` event emitted, both orders status = FILLED
- Partial fill: bid size > ask size → bid becomes PARTIALLY_FILLED, ask becomes FILLED
- Heap ordering: after 5 bids at different prices, `bestBid()` always returns highest price
- `cancelOrder` removes from heap and releases margin

### `MarginVault.test.ts`
- `deposit` increases `collateralBalance` correctly
- `settlePosition` creates correct long and short positions
- `updatePnL` computes correct unrealized PnL for longs and shorts
- `computeLiquidationPrice` returns correct value at 10x leverage
- `liquidate` only callable by authorized Sentinel
- `withdraw` reverts if withdrawal would drop below maintenance margin

### `LiquidationSentinel.test.ts`
- Oracle price drop to liquidation level triggers `checkAllPositions` → `LiquidationExecuted` event
- Position correctly deregistered after liquidation
- No liquidation triggered when health > threshold

### `AgentIntegration.test.ts`
- Simulate reactive flow: place order → `AgentInterface.onEvent` fires → `attemptMatch` called → fill executed within same transaction
- Oracle update → `AgentInterface.onEvent` fires → all PnL updated → Sentinel checks → liquidation if warranted
- `LiquidityProviderAgent.rebalance` after >1% price move cancels old orders and places new ones

---

## 6. Frontend — Trading Dashboard

**Stack:** React 18 + Vite + TypeScript + ethers.js v6 + Tailwind CSS + Recharts

**Aesthetic Direction:** Dark, institutional, precision terminal. Think Bloomberg terminal meets crypto-native brutalism. Black background (`#050505`), electric cyan accents (`#00E5FF`), monospace data typography, razor-thin borders, no gradients except subtle glow on active elements. Font: `IBM Plex Mono` for data, `Syne` for headings.

### Pages / Views:

**1. `TradingView` (main page)**
Layout: Left panel (order book) | Center panel (price chart + trade form) | Right panel (positions + agent activity)

- **Order Book Component:** Renders live bid/ask depth from `orderBook.getOrderBookDepth(20)`. Bids in green, asks in red. Animate size bars. Polling via `useEffect` every 2 seconds or via WebSocket if Somnia node supports `eth_subscribe`.
- **Price Chart:** Recharts `LineChart` rendering mark price history over the last 50 fills. Pull fill prices from `OrderMatched` event logs via `provider.getLogs()`.
- **Trade Form:** Input fields for Size, Leverage (slider 1x–20x), order type (Limit/Market). Displays computed margin required, liquidation price preview, and fee estimate before submission. On submit, calls `PerpEngine.openPosition()` via connected wallet.
- **Positions Panel:** Reads `marginVault.positions(connectedAddress)`. Displays entry price, mark price, unrealized PnL (color-coded green/red), margin health bar, and liquidation price. "Close Position" button calls `PerpEngine.closePosition()`.
- **Agent Activity Feed:** Listens to `OrderMatched`, `LiquidationExecuted`, and `LiquidityProviderAgent` events in real time. Renders a scrolling feed of agent actions: `"LP Agent rebalanced spread to 0.22% at $43,210"`, `"Sentinel liquidated 0xabc...def at $42,100"`.

**2. `AgentDashboard` page**
- Shows `LiquidityProviderAgent` current bid/ask order IDs, spread, total fills, PnL from fees collected.
- Shows `LiquidationSentinel` tracked position count, total liquidations executed, insurance fund balance.
- Toggle to pause/resume agent activity (calls `agent.pause()` — add this function to agents for demo control).

**3. `Stats` page**
- Total volume (sum of all `OrderMatched` fill sizes)
- Open interest (sum of all open position sizes)
- Funding rate (current + 8h history chart)
- Insurance fund balance

### Key Hooks:
- `useOrderBook(depth: number)` — Polls `getOrderBookDepth`, returns `{bids, asks}`.
- `usePosition(address: string)` — Reads position from `MarginVault`, polls every 3s.
- `useEventFeed()` — Subscribes to contract events via `contract.on(eventName, handler)`.
- `useWallet()` — Wraps MetaMask connect, network switching to Somnia testnet, and signer management.

---

## 7. README.md Structure

Write the README in this order:
1. **Hero:** Project name, tagline, and a screenshot of the trading dashboard.
2. **The Problem:** One paragraph explaining why existing perpetual DEXes (dYdX, GMX) still depend on off-chain keepers, bots, or centralized sequencers.
3. **The Somnia Solution:** Explain reactive architecture, MultiStream consensus, and IceDB in plain language. One diagram showing: `[New Order Event] → [Somnia Reactive Layer] → [Match Executed] → [Position Opened]` — all within a single block.
4. **Architecture Diagram:** ASCII or embedded image of the full contract dependency graph.
5. **Smart Contract Breakdown:** Table of contracts, purpose, and key functions.
6. **Agent Design:** Explain LP Agent and Sentinel with their reactive trigger → action flow.
7. **Zero Keeper Proof:** Explicitly state that no off-chain script, cron job, or chainlink automation node is used in the matching or liquidation pipeline.
8. **Local Setup:** Step-by-step: `git clone` → `npm install` → `.env` setup → `npx hardhat run scripts/deploy.ts --network somnia` → `cd frontend && npm run dev`.
9. **Testnet Contracts:** Table of all deployed contract addresses with block explorer links.
10. **Demo Video Link**

---

## 8. Demo Video Script (2–5 minutes)

Structure the recording as:

| Timestamp | Content |
|-----------|---------|
| 0:00–0:30 | Intro: "Traditional perp DEXes require external bots. Sentient Finance eliminates them entirely using Somnia's reactive architecture." |
| 0:30–1:15 | Show `AgentDashboard`. Point to LP Agent's live bid/ask orders in the order book. |
| 1:15–2:00 | Place a crossing limit order from a second test wallet. Show in real time that it matches against the LP Agent's order without any manual trigger. |
| 2:00–3:00 | Move the mock oracle price down sharply. Show the Sentinel detect the undercollateralized position and execute liquidation autonomously. No external transaction sent. |
| 3:00–3:45 | Show the `Stats` page — volume, OI, funding rate all live. |
| 3:45–4:30 | Pull up the `AgentInterface.sol` code and explain the reactive `onEvent` function — this is where the magic happens. |
| 4:30–5:00 | Close: "Fully on-chain, keeper-free, agent-native perpetuals. This is what DeFi looks like on Somnia." |

---

## 9. Judging Criteria Alignment

| Criterion | How Sentient Finance Addresses It |
|-----------|----------------------------------|
| **Innovation** | Reactive self-matching engine is a novel architecture not deployed on any other EVM chain |
| **Somnia Integration** | Directly exploits MultiStream, IceDB, and Reactive extensions — not a port from another chain |
| **Agentic Design** | Two native on-chain agents (LP + Sentinel) with zero off-chain dependencies |
| **Technical Execution** | Full contract suite, test coverage, live testnet deployment, working frontend |
| **Presentation** | Professional README, clean demo video, clear architectural narrative |

---

## 10. Immediate Build Order

Execute in this sequence to have a working demo as fast as possible:

1. `OrderBook.sol` + `MarginVault.sol` core storage and basic `placeOrder` / `settlePosition` — get unit tests passing first.
2. `MockPriceFeed.sol` + `OracleAdapter.sol` so you have a controllable price source for testing liquidations.
3. `LiquidationSentinel.sol` wired to `MarginVault` — test the full liquidation flow.
4. `AgentInterface.sol` reactive subscriptions — simulate the reactive pattern with Hardhat event listeners if Somnia's reactive layer isn't fully available on testnet yet.
5. `LiquidityProviderAgent.sol` — the LP agent is impressive in the demo but non-critical for core functionality.
6. `PerpEngine.sol` coordinator as the last contract layer.
7. Frontend `TradingView` page with order book, trade form, and positions panel.
8. Frontend `AgentDashboard` and event feed.
9. Deploy to Somnia testnet, seed order book, verify contracts.
10. Record demo video, finalize README, submit on Devpost.

---

This is your complete build specification. Every contract function, every storage variable, every frontend hook, and every demo moment is defined. Start at step 1 of section 10 and ship.