# Sentient Finance — Stub/Mock Implementation Review

## What's Real vs. Stubbed/Mocked

### ✅ Fully Implemented (Production-Ready)
| Component | Status | Notes |
|-----------|--------|-------|
| `OrderBook.sol` | ✅ Complete | Heap-based matching, cancel, partial fills, depth query — all functional |
| `OrderBookFactory.sol` | ✅ Complete | Deploys per-pair OrderBooks, registry, duplicate protection |
| `MarginVault.sol` | ✅ Complete | Deposit/withdraw, lock/release margin, PnL, liquidation, health check, trackedTraders iteration |
| `LiquidationSentinel.sol` | ✅ Complete | Reverse-iterate trackedTraders, check health, liquidate — fully wired |
| `AgentInterface.sol` | ✅ Complete | `onEvent()` calls Sentinel and LP Agent directly (no stubs), reactive subscriptions |
| `LiquidityProviderAgent.sol` | ✅ Complete | Initialize, rebalance, adaptive spread, pause/resume — all functional |
| `MockPriceFeed.sol` | ✅ Complete | Admin-controlled price — intentional mock for testing |
| `OracleAdapter.sol` | ✅ Complete | Wraps mock or live feeds, emits PriceUpdated — functional |
| All 49 tests | ✅ Complete | Including property-based and invariant tests |
| Frontend UI | ✅ Complete | All pages build and render, Recharts charts work |

### ⚠️ Stub/Mock (Needs Real Implementation)
| Component | Current State | What's Needed |
|-----------|--------------|---------------|
| **Frontend → Contracts** | Mock data (random arrays) | Wire to deployed contracts via typechain-types ABIs + ethers.js |
| **AgentOracle → CoinGecko** | Contract deployed but not live (needs `SOMNIA_AGENTS_PLATFORM_ADDRESS`) | Set env var, fund with STT, call `requestPrice()` on testnet |
| **LP Agent per-pair** | Only deployed for BTC-USD | Deploy LP Agent for ETH-USD and SOL-USD in deploy.ts |
| **AgentOracle per-pair** | Single-pair (BTC-USD only) | Multi-pair CoinGecko URL construction + pairId mapping |
| **Subgraph deployment** | Schema + manifest + mappings created | Deploy to Graph Node + IPFS, update subgraph.yaml with real contract addresses |
| **PerpEngine.closePosition** | Reverts with message | Query position details from MarginVault, place opposing order |
| **PerpEngine.applyFunding** | Updates timestamp, emits event | Iterate positions, transfer funding between longs and shorts |
| **PerpEngine.recordFill** | External function | Should be called internally by OrderBook on match (currently not auto-called) |

### 📋 Stub Details — Line by Line

#### 1. `PerpEngine.closePosition()` — Stub
```solidity
// Line ~94
function closePosition(bytes32 pairId) external {
    require(pairRegistered[pairId], "PerpEngine: pair not registered");
    revert("PerpEngine: closePosition requires position query - use cancelOrder for now");
}
```
**Fix:** Query `marginVault.positions(msg.sender)`, check `isOpen`, place opposing order at market price via `orderBook.placeOrder()`.

#### 2. `PerpEngine.applyFunding()` — Partial
```solidity
// Line ~108
function applyFunding(bytes32 pairId) external {
    // ... checks interval, computes rate ...
    lastFundingTimes[pairId] = block.timestamp;
    emit FundingApplied(pairId, fundingRate, block.timestamp);
    // MISSING: iterate positions, transfer funding between longs and shorts
}
```
**Fix:** Iterate `marginVault.trackedTraders()`, for each open position compute `fundingPayment = margin * fundingRate * timeSinceLastFunding / FUNDING_INTERVAL`, transfer via `marginVault` internal accounting.

#### 3. `PerpEngine.recordFill()` — Not Auto-Called
```solidity
// Line ~123
function recordFill(bytes32 pairId, uint256 price, uint256 size) external {
    // Records fill for VWAP mark price computation
}
```
**Issue:** This function exists but is never called automatically. It should be called by `OrderBook._attemptMatch()` after each match. Currently `OrderBook` has no reference to `PerpEngine` or `pairId`.
**Fix options:**
- Add `PerpEngine` address + `pairId` to `OrderBook` constructor, call `recordFill` after match
- Or have `AgentInterface.onEvent` call `recordFill` after `attemptMatch`
- Or remove from PerpEngine and compute mark price from `OrderMatched` events in subgraph

#### 4. Frontend → Contract Wiring — Fully Mocked
All frontend components use hardcoded mock data:
- `TradingView.tsx`: `Math.random()` for order book sizes, `Math.sin()` for price history
- `PositionsPanel.tsx`: Hardcoded position object
- `EventFeed.tsx`: Static string array
- `Stats.tsx`: Static numbers
- `AgentDashboard.tsx`: Static numbers

**Fix:** Create React hooks that read from deployed contracts:
```typescript
// Use typechain-types (generated from ABIs)
import { OrderBook__factory, MarginVault__factory } from '../typechain-types';
const orderBook = OrderBook__factory.connect(orderBookAddress, signer);
const [bids, asks] = await orderBook.getOrderBookDepth(20);
```

#### 5. AgentOracle → Live CoinGecko — Not Activated
`AgentOracle.sol` is fully implemented but requires:
- `SOMNIA_AGENTS_PLATFORM_ADDRESS` env var (Somnia Agents platform contract address)
- STT testnet tokens for deposit
- Real network deployment

**Fix:** Once platform address is known, add to `.env` and deploy. The contract correctly sizes deposits using `getRequestDeposit() + pricePerAgent × subcommitteeSize`.

#### 6. Subgraph — Not Deployed
- Schema, manifest, mappings all created
- Manifest has placeholder addresses (`0x000...000`)
- No local Graph Node setup

**Fix:** After testnet deployment, update addresses in `subgraph.yaml`, run `graph codegen`, deploy to hosted service.

---

## Readiness Assessment

### For Hackathon Demo: **85% Ready**

| Criterion | Status | Gap |
|-----------|--------|-----|
| Smart contracts deployed | ⚠️ Needs testnet deployment | Set `.env`, run `deploy.ts --network somnia` |
| Tests passing | ✅ 49/49 | Complete |
| Frontend works | ✅ Builds and renders | Uses mock data, not live contracts |
| Reactive cascade works | ✅ Wired and tested | Verified in integration tests |
| Agent integration | ⚠️ Contract ready, not live | Needs `SOMNIA_AGENTS_PLATFORM_ADDRESS` |
| Multi-pair | ✅ Architecture complete | Only BTC-USD LP Agent deployed |
| Demo video | ❌ Not recorded | Requires live testnet deployment first |
| Devpost | ❌ Not submitted | Requires video + testnet addresses |

### For Production: **40% Ready**

| Concern | Status | Effort |
|---------|--------|--------|
| Close position flow | Stubbed | Medium |
| Funding rate settlement | Partial | Medium-High |
| Frontend on-chain wiring | Not started | High |
| Subgraph deployment | Not deployed | Medium |
| Multi-pair LP Agents | Single pair | Low-Medium |
| Security audit | Not done | High |
| Gas optimization | Linear iteration | Medium |
| Insurance fund distribution | Not implemented | Medium |
| Re-entrancy protection | Implicit (no external calls during mutation) | Low |
| Access control | Owner-only patterns | Medium (needs multi-sig) |
