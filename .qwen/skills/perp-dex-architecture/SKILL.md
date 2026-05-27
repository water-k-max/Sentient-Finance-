---
name: perp-dex-architecture
description: Build a fully on-chain perpetual swap DEX with heap-based order matching, margin vault, multi-pair factory, funding rates, and autonomous liquidation agents.
source: auto-skill
extracted_at: '2026-05-27T22:26:01.353Z'
---

# Perpetual DEX Contract Architecture

Design a fully on-chain perpetual swap exchange with native order matching, collateral management, multi-pair support, and autonomous agents — no off-chain keepers.

## Contract Stack

```
PerpEngine (coordinator / entry point)
    ├── OrderBookFactory (deploys one OrderBook per pair)
    ├── MarginVault (shared clearinghouse)
    └── OracleAdapter / AgentOracle (price feeds)

AgentInterface (reactive gateway)
    ├── LiquidationSentinel (autonomous liquidation)
    └── LiquidityProviderAgent (autonomous market making)
```

## Key Components

### 1. OrderBook — Heap-Based Matching Engine

Use max-heap for bids (highest price first) and min-heap for asks (lowest price first).

```solidity
uint256[] public bidHeap;  // max-heap
uint256[] public askHeap;  // min-heap

function placeOrder(bool isBid, uint256 price, uint256 size, uint256 leverage)
    external returns (uint256 orderId)
{
    // Validate margin
    uint256 notional = (size * price) / 1e18;
    uint256 requiredMargin = notional / leverage;
    marginVault.lockMargin(msg.sender, requiredMargin);

    // Create order and insert into heap
    orderId = nextOrderId++;
    orders[orderId] = Order({...});
    if (isBid) _insertBid(orderId);
    else _insertAsk(orderId);

    // Attempt to match immediately
    _attemptMatch();
}
```

**Heap invariants:**
- `bestBid()` returns `orders[bidHeap[0]].price` — highest bid (O(1))
- `bestAsk()` returns `orders[askHeap[0]].price` — lowest ask (O(1))
- Insert O(log n) via sift-up

**Matching logic:**
```solidity
function _attemptMatch() internal {
    while (bidHeap.length > 0 && askHeap.length > 0) {
        if (orders[bidHeap[0]].price < orders[askHeap[0]].price) break;
        // Match using price-time priority
        // Settle positions via MarginVault
        marginVault.settlePosition(bid.trader, ask.trader,
            fillPrice, fillSize, bid.leverage, ask.leverage);
    }
}
```

### 2. MarginVault — Clearinghouse

Manages collateral, positions, PnL, and liquidation enforcement.

```solidity
struct Position {
    address trader;
    bool isLong;
    uint256 entryPrice;     // 8 decimals
    uint256 size;           // 18 decimals
    uint256 margin;         // collateral locked
    uint256 leverage;
    int256 unrealizedPnl;   // updated on every price tick
    uint256 liquidationPrice;
    bool isOpen;
}

function marginHealth(address trader) public view returns (uint256) {
    // health = equity × leverage / notional
    // equity = margin + unrealizedPnl
    // if health < 5% (MAINTENANCE_MARGIN_RATIO), eligible for liquidation
}
```

**PnL formula:**
```
Long:  unrealizedPnl = (markPrice - entryPrice) × size
Short: unrealizedPnl = (entryPrice - markPrice) × size
```

**Liquidation price formula (at 5% maintenance margin):**
```
Long:  liqPrice = entryPrice × (leverage - 1) / leverage + entryPrice × 0.05
Short: liqPrice = entryPrice × (leverage + 1) / leverage - entryPrice × 0.05
```

### 3. Multi-Pair Factory Pattern

One OrderBook per pair, shared MarginVault:

```solidity
contract OrderBookFactory {
    mapping(bytes32 => address) public pairOrderBooks;
    bytes32[] public allPairs;

    function createOrderBook(bytes32 pairId) external returns (address) {
        OrderBook ob = new OrderBook(marginVault, perpEngine, pairId);
        pairOrderBooks[pairId] = address(ob);
        allPairs.push(pairId);
    }
}

contract PerpEngine {
    mapping(bytes32 => IOrderBook) public pairOrderBooks;

    function registerPair(bytes32 pairId, address obAddr) external {
        pairOrderBooks[pairId] = IOrderBook(obAddr);
    }

    function openPosition(bytes32 pairId, bool isLong, uint256 size,
        uint256 leverage, uint256 limitPrice) external returns (uint256)
    {
        return pairOrderBooks[pairId].placeOrder(isLong, price, size, leverage);
    }
}
```

### 4. Funding Rate

Periodic settlement between longs and shorts:

```solidity
function computeFundingRate(bytes32 pairId) external view returns (int256) {
    int256 diff = int256(markPrice) - int256(indexPrice);
    return (diff * 1e18) / int256(indexPrice) / int256(FUNDING_INTERVAL);
    // markPrice = VWAP of recent fills (from circular buffer)
    // indexPrice = oracle price
    // FUNDING_INTERVAL = 8 hours
}
```

### 5. Autonomous Agents

**Liquidation Sentinel:**
```solidity
function checkAllPositions(uint256 currentPrice) external {
    vault.updateAllPnL(currentPrice);
    address[] memory traders = vault.getTrackedTraders();
    for (uint256 i = 0; i < traders.length; i++) {
        if (!vault.isTracked(traders[i])) continue; // skip already-liquidated
        if (vault.marginHealth(traders[i]) < MAINTENANCE_MARGIN_RATIO) {
            vault.liquidate(traders[i]);
        }
    }
}
```

**LP Agent (with AI-augmented spread):**
```solidity
// Spread formula:
// effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier
//   bullish → 0.8x (tight, confident)
//   neutral → 1.0x (normal)
//   bearish → 2.0x (wide, cautious)

function setSentiment(string calldata sentiment) external {
    if (keccak256(bytes(sentiment)) == keccak256(bytes("bullish")))
        sentimentMultiplierBps = -20;
    else if (keccak256(bytes(sentiment)) == keccak256(bytes("bearish")))
        sentimentMultiplierBps = 100;
    else sentimentMultiplierBps = 0;
}
```

## Performance Optimizations

- **Circular buffer** for fill history — O(1) write replaces O(n) array shift
- **Snapshot iteration** — read `getTrackedTraders()` once into memory, avoid re-reading count
- **Match cap** — `MAX_MATCHES_PER_CALL (10)` prevents runaway gas on large market sweeps
- **Batch PnL updates** — `updatePnLBatch(traders[])` for partial updates (O(k) vs O(n))

## Security Considerations

- **Authorization** — Only authorized contracts can call `settlePosition`, `liquidate`, `lockMargin`
- **Position-per-trader** — Simplified model; production needs multi-position support
- **Re-entrancy** — No external calls during internal state mutations
- **Overflow** — Solidity 0.8.x native checks + `unchecked` blocks where safe