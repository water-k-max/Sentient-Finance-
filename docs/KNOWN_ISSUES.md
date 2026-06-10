# Known Issues — Deferred for Production

This documents every identified problem that is **acceptable for the hackathon demo** but must be fixed before mainnet. Grouped by severity.

---

## Critical (Funds at Risk on Mainnet)

### `PerpEngine.setIndexPrice()` has no access control
Anyone can set any pair's index price to any value. This allows wrongful PnL calculations, liquidations, and funding payments.

**Fix:** Add `onlyOwner` modifier.  
**File:** `contracts/core/PerpEngine.sol:L~180`  
**Estimate:** 5 min

### `PerpEngine.recordFill()` has no access control
Anyone can inject fake fill data into the VWAP buffer, corrupting the mark price used by funding rate computation.

**Fix:** Add `onlyAuthorized` check (allow only registered OrderBooks).  
**File:** `contracts/core/PerpEngine.sol:L~195`  
**Estimate:** 5 min

### Self-match can corrupt OrderBook heap
When a trader's own order is the best ask, `_attemptMatch()` swaps it to the back of the heap without re-heapifying. The comment claims "re-heapify will correct itself on next insert" — this is not guaranteed. Orders can be silently lost.

**Fix:** Re-heapify after the swap, or skip self-matching orders entirely without mutation.  
**File:** `contracts/core/OrderBook.sol:L~210-230`  
**Estimate:** Several hours (requires deep understanding + integration test)

---

## High (Broken Behavior)

### `AgentInterface.simulatePriceUpdate()` and `simulateOrderPlaced()` are public
Anyone can trigger the full reactive cascade (PnL update, sentinel checks, LP rebalance) at will. On mainnet this would allow griefing by spamming expensive on-chain computations.

**Fix:** Add `onlyOwner` or remove from production build. These are test-only helpers.  
**File:** `contracts/agents/AgentInterface.sol:L~55`  
**Estimate:** 5 min

### `PerpEngine.openPosition()` declares `PositionOpened` event but never emits it
Dead event signature in the ABI. Any indexer or subgraph relying on this event gets no data.

**Fix:** Add `emit PositionOpened(...)` in `openPosition()`.  
**File:** `contracts/core/PerpEngine.sol:L~75`  
**Estimate:** 5 min

### `MarginVault._removeTrader()` is O(n), called inside liquidation loop
Liquidating N positions in one block scans the `trackedTraders` array N times — O(n²) gas cost. Exceeds block gas at ~100+ traders.

**Fix:** Use a linked list or tombstone pattern for tracked traders.  
**File:** `contracts/core/MarginVault.sol:L~330`  
**Estimate:** High (data structure refactor)

### `OrderBook._removeFromHeap()` is O(n)
Cancel operation scans the full heap array linearly instead of using index tracking. Makes large-batch cancel operations prohibitively expensive.

**Fix:** Store `orderId → heapIndex` mapping, update on every sift/swap.  
**File:** `contracts/core/OrderBook.sol:L~130`  
**Estimate:** Medium

### `MarginVault` and `SentimentOracle` both have `receive() payable` but no withdraw
ETH sent to these contracts (e.g., platform rebates) is permanently trapped.

**Fix:** Add `withdrawETH()` with `onlyOwner`.  
**Files:** `contracts/core/MarginVault.sol:L~365`, `contracts/oracles/SentimentOracle.sol:L~390`  
**Estimate:** 10 min

---

## Medium (Noise, Code Quality, Missing Coverage)

### 9 of 16 contracts have zero direct unit tests
- `MockPriceFeed.sol`, `OracleAdapter.sol`, `PerpEngine.sol`, `LiquidityProviderAgent.sol`, `EnhancedLiquidityProviderAgent.sol`, `AgentInterface.sol`, `KeeperRegistry.sol`, `SomniaPriceOracle.sol`, `CompositeOracle.sol`

**Risk:** Regressions in these contracts are not caught. The integration test covers the happy path but misses edge cases.

### `MarginVault.test.ts` settlePosition test has no assertions
Lines 60-64 declare variables and stop. Gives a false sense of coverage.

### `KeeperRegistry.removeKeeper()` uses `transfer()` (2300 gas limit)
Will fail if the keeper is a smart contract wallet.

**Fix:** Use `(bool sent, ) = keeper.call{value: bond}("")` 
**File:** `contracts/oracles/KeeperRegistry.sol:L~60`

### `KeeperRegistry.recordPost()` has no access control
Anyone can inflate a keeper's `totalPosts` counter.

**Fix:** Add `onlySomniaPriceOracle` modifier.  
**File:** `contracts/oracles/KeeperRegistry.sol:L~45`

### `LiquidityProviderAgent.recordPrice()` has no access control
Anyone can corrupt the volatility buffer.

**Fix:** Add `onlyOwner` or `onlyAgentInterface`.  
**File:** `contracts/agents/LiquidityProviderAgent.sol:L~75`

### `EnhancedLiquidityProviderAgent.onSentimentUpdate()`/`onVolatilityUpdate()` no access control
Anyone can set sentiment multiplier and volatility, manipulating the LP agent's effective spread.

**Fix:** Add `onlySentimentOracle` modifier.  
**File:** `contracts/agents/EnhancedLiquidityProviderAgent.sol:L~65`

---

## Frontend

| Issue | File | Severity |
|-------|------|----------|
| `useEventFeed` has `[]` deps — ignores `_pair` param | `hooks/useEventFeed.ts:130` | Medium |
| `priceHistory.ts` — entire module is dead code (nothing imports it) | `lib/priceHistory.ts` | Low |
| `CONTRACT_ADDRESSES` typed as `Record<string, any>` | `config/addresses.ts:4` | Low |
| `SOMNIA_CHAIN_ID` duplicated (addresses.ts + ContractsContext.tsx) | Both files | Low |
| No error boundaries — `catch { // silent }` in `useOraclePrice`, `useEventFeed` | Both hooks | Low |
| `PriceChart` tooltip always says "BTC-USD" regardless of pair | `components/PriceChart.tsx:37` | Low |

---

## Scripts

| Issue | Script | Severity |
|-------|--------|----------|
| `improveDemo.ts` references `keeperRegistry` key not in `deployed-addresses.json` | `improveDemo.ts:14` | High (crashes at runtime) |
| `wireOracle.ts` references `keeperRegistry` key not in deployed addresses | `wireOracle.ts:12` | High (crashes at runtime) |
| `redeployOracle.ts` references `keeperRegistry` key not in deployed addresses | `redeployOracle.ts:10` | High (crashes at runtime) |
| `priceFeed.ts` pushes fake jittered prices when CoinGecko is down | `priceFeed.ts:23-25` | Medium (corrupts on-chain data) |
| `redeployOracles.ts` hardcodes platform address (`0x037Bb...`) | `redeployOracles.ts:4` | Medium (breaks if platform changes) |
| `seedOrderBook.ts` uses hardcoded 2024 prices (BTC $50k) | `seedOrderBook.ts:13-17` | Low (stale) |
| `postPrice.ts` is a subset of `updatePrice.ts` — redundant | — | Low (duplicate) |
| `redeployOracle.ts` superseded by `wireOracle.ts` — redundant | — | Low (duplicate) |

---

## Subgraph

| Field | Current | Needs |
|-------|---------|-------|
| Contract addresses | `0x000...000` (placeholders) | Real deployed addresses |
| `Order.margin`, `Order.leverage` | `BigInt.zero()` | Event doesn't carry this data |
| `Match.volume` | Not tracked | Needs price × size computation |
| Deployment | Not deployed to Graph Node | Requires hosted service or self-hosted node |

---

## Known Stubs (from STUB_REVIEW.md)

Carried over from `docs/STUB_REVIEW.md` — still outstanding:

- `PerpEngine.applyFunding()` — declares event but never iterates positions or transfers margin
- SentimentOracle agent requests — contract ready but never funded/called on testnet
- Subgraph — scaffolded but not deployed
- LP agents only deployed for BTC-USD (ETH-USD and SOL-USD books exist but have no LP)
