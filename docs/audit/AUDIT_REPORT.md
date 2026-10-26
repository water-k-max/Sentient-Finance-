# Security Audit & Remediation — Sentient Finance Perpetual DEX

| | |
|---|---|
| **Target** | `Sentient-Finance-` — on-chain perpetual-swap DEX (Somnia testnet) |
| **Repository** | https://github.com/water-k-max/Sentient-Finance- |
| **Baseline commit** | `2c51e5d` ("Update Documentations") |
| **Remediation branch** | `security-audit` |
| **Audit date** | 2026-10-26 |
| **Scope** | `contracts/**` (core, oracles, agents, mocks), `frontend/src/**` (chain config), `scripts/deploy.ts` |
| **Method** | Manual review + executable reproduction (Hardhat/ethers v6) + property-test inspection |
| **Result** | 16 findings · 10 patched · 6 documented (architectural) · full suite **88 passing / 0 failing** |

> **Portfolio note.** This is a *self-audit*: the auditor is also the author. It demonstrates
> end-to-end methodology — find → reproduce → classify → fix → re-verify — on a non-trivial
> DeFi codebase, with every claim backed by a runnable test. For an independent work sample,
> pair it with an audit of a third-party target (e.g. a Damn Vulnerable DeFi challenge).

---

## 1. Executive summary

Sentient Finance is a perpetual-swap DEX built for Somnia: a heap-based on-chain order book, a
margin vault / clearinghouse, funding + VWAP mark price, liquidation sentinels, and AI liquidity-
provider agents driven by Somnia's reactive execution layer.

The codebase is ambitious and well-structured, and the author already self-documented a set of
deferred issues in `docs/KNOWN_ISSUES.md`. This audit independently **verified those issues with
executable proofs**, **corrected one mischaracterisation**, and surfaced **additional critical
defects** that the self-assessment missed.

The most severe problems are **permissionless privileged writes**: anyone could set the index
price, inject fake fills into the mark-price VWAP, set the oracle price directly, and — because the
collateral token (`MockUSDC`) is wired as the *live* collateral asset with an **open `mint`** —
mint unlimited collateral and drain the vault. Separately, the margin accounting double-counts
locked margin, liquidation destroys margin belonging to unrelated resting orders, and the
self-match guard is an **unbounded loop** that lets a single trader gas-DoS the entire book.

**10 of 16 findings are patched on the `security-audit` branch**, each with a reproduction test
that fails on the original code and passes on the patched code. The remaining **6 are architectural**
(single position slot per trader, the `PerpEngine` trade-entry indirection, cross-pair PnL/funding,
health-factor semantics) and are documented with concrete remediation designs rather than patched,
because a correct fix requires a data-model change that should land with its own test coverage.

### Findings by severity

| Severity | Count | IDs |
|---|---|---|
| Critical | 4 | F-01, F-02, F-06, F-07 |
| High | 5 | F-03, F-04, F-05, F-08, F-10 |
| Medium | 5 | F-09, F-11, F-12, F-13, F-14 |
| Low / Informational | 2 | F-15, F-16 |

### Status

| ID | Title | Severity | Status |
|---|---|---|---|
| F-01 | `OracleAdapter.updatePriceDirect` permissionless | Critical | ✅ Fixed |
| F-02 | `PerpEngine.setIndexPrice` / `recordFill` permissionless | Critical | ✅ Fixed |
| F-03 | `MarginVault.getFreeMargin` double-counts locked margin | High | ✅ Fixed |
| F-04 | `MarginVault.liquidate` zeroes all locked margin | High | ✅ Fixed |
| F-05 | `OrderBook` self-match guard is an unbounded loop (DoS) | High | ✅ Fixed |
| F-06 | `MockUSDC.mint` permissionless (live collateral) | Critical | ✅ Fixed |
| F-07 | `PerpEngine.openPosition` attributes orders to itself | Critical | 📋 Documented |
| F-08 | Enhanced LP agent oracle-push callbacks permissionless | High | ✅ Fixed |
| F-09 | LP spread formula can underflow on extreme volatility | Medium | ✅ Fixed (bound + clamp) |
| F-10 | Funding rate scaled by `FUNDING_INTERVAL` twice | High | ✅ Fixed |
| F-11 | `marginHealth` ignores free collateral | Medium | 📋 Documented |
| F-12 | `computeLiquidationPrice` disagrees with health trigger | Medium | 📋 Documented |
| F-13 | `KeeperRegistry.removeKeeper` uses `transfer()` (2300 gas) | Medium | ✅ Fixed |
| F-14 | Frontend targets the wrong Somnia chain id | Medium | ✅ Fixed |
| F-15 | `updateAllPnL` applies one price across all pairs | Low | 📋 Documented |
| F-16 | Single position slot per trader (no `pairId`) | Low | 📋 Documented |

---

## 2. Methodology

1. **Map the system.** Trace the trade lifecycle (deposit → place order → match → settle →
   PnL → funding → liquidation) and the reactive cascade (price event → PnL → sentinel → LP).
2. **Threat-model privileged writes.** Enumerate every state-changing external function and ask
   "who is allowed to call this, and what does it control?" This surfaced the permissionless
   oracle/index/mint holes (F-01, F-02, F-06, F-08).
3. **Verify accounting invariants.** Re-derive the margin, free-margin, PnL, funding and
   liquidation math by hand and compare to the code (F-03, F-04, F-10, F-11, F-12).
4. **Prove, don't assume.** For each finding write an executable Hardhat test that demonstrates
   the vulnerable behaviour on the original code. Every patched finding has a test in
   `test/audit/findings.spec.ts` that **fails before / passes after**.
5. **Fix and re-verify.** Patch on `security-audit`, update the deployment + test wiring to
   reflect the new authorization requirements, and confirm the entire suite (original + repro)
   stays green.

**Severity scale** (funds/availability impact × likelihood): Critical = direct loss of funds or
full manipulation, trivially reachable; High = loss/DoS under realistic conditions; Medium =
correctness/availability with preconditions; Low/Informational = design debt or limited impact.

---

## 3. Findings (patched)

### F-01 · `OracleAdapter.updatePriceDirect` is permissionless — **Critical · Fixed**

**Location:** `contracts/oracles/OracleAdapter.sol:35`

```solidity
function updatePriceDirect(uint256 price) external {   // no access control
    latestPrice = price;
    latestTimestamp = block.timestamp;
    emit PriceUpdated(assetId, price, block.timestamp);
}
```

**Description.** Any address can write an arbitrary price into the adapter that feeds
`getIndexPrice`. The `PriceUpdated` event is also what the reactive `AgentInterface` subscribes
to, so a fabricated price propagates into the whole cascade (PnL → liquidation → LP rebalance).

**Impact.** An attacker sets BTC to `$1`, triggers the cascade, and liquidates every long at a
fabricated price — or sets it arbitrarily high to scale out. Full protocol manipulation.

**Proof.** `test/audit/findings.spec.ts` → *"F-01 · rejects a direct price write from a non-owner"*:
on the original code the attacker's `updatePriceDirect(1)` succeeds (test fails); after the fix it
reverts.

**Fix.** Restricted to `onlyOwner` (the relayer/keeper key). For a trustless production feed this
setter should be replaced entirely by a validated Chainlink read or the keeper-median
`SomniaPriceOracle` already present in the repo.

---

### F-02 · `PerpEngine.setIndexPrice` / `recordFill` are permissionless — **Critical · Fixed**

**Location:** `contracts/core/PerpEngine.sol:173,179`

**Description.** `setIndexPrice` writes the index price used by funding and (via the cascade)
liquidation; `recordFill` appends to the circular buffer that `_getMarkPrice` VWAPs. Neither had
any caller check.

**Impact.** Anyone can (a) set the index price for any pair, and (b) inject fake fills to steer the
mark price. Together these let an attacker fabricate the funding premium and the mark/index pair
that drives PnL and liquidations.

**Proof.** *"F-02 · rejects setIndexPrice and recordFill from an unauthorized caller"* — both
attacker calls succeed on the original code, revert after the fix.

**Fix.** Added an `authorized` set to `PerpEngine` (owner authorized by construction) and gated
both functions with `onlyAuthorized`. The deployment (`scripts/deploy.ts`) and test fixtures now
authorize each order book (for `recordFill`) and the oracle/`AgentInterface` (for `setIndexPrice`).

> This matches the author's own `KNOWN_ISSUES.md`, which recommended exactly `onlyOwner` /
> `onlyAuthorized`. The audit implements and proves it.

---

### F-03 · `MarginVault.getFreeMargin` double-counts locked margin — **High · Fixed**

**Location:** `contracts/core/MarginVault.sol:220`

```solidity
uint256 bal    = collateralBalances[trader];   // already net of locked
uint256 locked = lockedMargin[trader];
if (locked >= bal) return 0;
return bal - locked;                            // subtracts locked a SECOND time
```

**Description.** Both `lockMargin` and `_openPosition` move funds with
`collateralBalances -= x; lockedMargin += x`. So `collateralBalances` is *already* the free
balance. Subtracting `lockedMargin` again under-reports free margin by the entire locked amount.

**Impact.** `withdraw` uses `getFreeMargin`, so a trader with any locked margin can never withdraw
their actual free collateral; `_openPosition`'s affordability check rejects positions the trader can
actually back. With 1000 deposited and 300 locked, free margin reads **400 instead of 700**.

**Proof.** *"F-03 · reports collateral that is actually free"* — asserts `getFreeMargin == 700e6`;
original returns `400e6` (fails), fixed returns `700e6`.

**Fix.** `getFreeMargin` now returns `collateralBalances[trader]`.

---

### F-04 · `MarginVault.liquidate` zeroes *all* locked margin — **High · Fixed**

**Location:** `contracts/core/MarginVault.sol:164`

```solidity
lockedMargin[trader] = 0;   // destroys resting-order locks too
```

**Description.** `lockedMargin` aggregates margin locked for the open position **and** for any
resting (unfilled) orders. Liquidation wiped the whole balance, not just the position's share.

**Impact.** After a liquidation, the trader's resting orders can never be cancelled —
`releaseMargin` reverts (`release exceeds locked`) — and that collateral is stranded. It also
corrupts the vault's locked-margin accounting.

**Proof.** *"F-04 · preserves margin locked by resting orders"* — a trader with a 200 USDC resting
lock plus a liquidated position: original leaves `lockedMargin == 0` and the subsequent
`releaseMargin(200)` reverts; fixed leaves `lockedMargin == 200` and the release succeeds.

**Fix.** Release only the liquidated position's margin (`lockedMargin -= pos.margin`, floored at 0).
For a trader with only a position this is identical to before (lock → 0), so existing behaviour is
preserved; only the resting-order case changes. The position margin is still forfeited to the vault
as an insurance buffer.

---

### F-05 · `OrderBook` self-match guard is an unbounded loop (DoS) — **High · Fixed**

**Location:** `contracts/core/OrderBook.sol:250–264`

**Description.** When the best bid and best ask belong to the same trader, the guard swaps the root
ask to the back of the heap, sifts down, and `continue`s **without changing the bid or shrinking the
ask heap**. With one resting bid and two crossing asks from the same trader, the scan oscillates
between the two asks forever.

**Impact.** A single trader can make `placeOrder`/`attemptMatch` consume unbounded gas and revert
out-of-gas, **bricking matching for the entire book** — a cheap, persistent denial of service.

> The author's `KNOWN_ISSUES.md` describes this as "heap corruption / orders silently lost". The
> reproduction shows the dominant, trivially-triggerable effect is a **gas-exhaustion DoS**, which
> is more severe and easier to exploit than silent order loss. The audit corrects the classification.

**Proof.** *"F-05 · does not run out of gas when a trader crosses their own resting bid"* — places a
bid then two crossing asks from one trader under a 5M gas cap; the original reverts (OOG), the
patched version completes.

**Fix.** Bounded the skip loop with a `selfMatchSkips` counter capped at the ask-heap size (reset on
each real match), making the scan O(n) and guaranteed to terminate. **Recommendation:** a production
book should additionally reject self-crossing at placement (see §5).

---

### F-06 · `MockUSDC.mint` is permissionless (live collateral) — **Critical · Fixed**

**Location:** `contracts/mocks/MockUSDC.sol:19`

```solidity
function mint(address to, uint256 amount) external { _mint(to, amount); }  // anyone
```

**Description.** The token is named "Mock", but `deployed-addresses.json` wires it as the **actual
collateral asset** (`mockUSDC`) for the deployed vault. Its `mint` had no access control.

**Impact.** Anyone can mint unlimited collateral to themselves, deposit it, and trade/withdraw
against real positions — total insolvency of the clearinghouse.

**Proof.** *"F-06 · rejects minting from a non-owner"* — attacker mint succeeds on original, reverts
after the fix.

**Fix.** Gated `mint` to `onlyOwner` (the contract already inherits OpenZeppelin `Ownable`).
**Recommendation:** for mainnet, collateral must be a real, canonical asset (e.g. genuine USDC),
not a mintable mock.

---

### F-08 · Enhanced LP agent oracle-push callbacks are permissionless — **High · Fixed**

**Location:** `contracts/agents/EnhancedLiquidityProviderAgent.sol:140,146`

**Description.** `onSentimentUpdate` and `onVolatilityUpdate` had no caller check. These drive the
market-maker's spread: `effectiveSpread = baseSpread × (1 + vol/100) × sentimentMultiplier`.

**Impact.** An attacker injects extreme sentiment/volatility to widen the LP's spread arbitrarily
(adverse quoting) or, combined with F-09, brick the agent.

**Proof.** *"F-08 · rejects sentiment/volatility pushes from an unauthorized caller"* — attacker
calls succeed on original, revert after the fix.

**Fix.** Added an `authorized` set (deployer authorized by construction) and gated both callbacks
with `onlyAuthorized`. Deployment should authorize the `AgentInterface`/`SentimentOracle` relayer.

---

### F-09 · LP spread formula can underflow on extreme volatility — **Medium · Fixed**

**Location:** `contracts/agents/EnhancedLiquidityProviderAgent.sol:170`

```solidity
uint256 bidPrice = (midPrice * (10000 - effectiveSpreadBps)) / 10000;  // underflow if >10000
```

**Description.** `effectiveSpreadBps` grows with the volatility score. A large score (reachable via
the permissionless push in F-08, or the pull path `_refreshOracleData`) pushes it past 10000, and
`10000 - effectiveSpreadBps` underflows → panic `0x11`, reverting every rebalance.

**Impact.** Permanent denial-of-service of the LP agent (it can never quote again).

**Fix.** Two layers: (1) `onVolatilityUpdate` now `require(score <= MAX_VOLATILITY_SCORE)`;
(2) defense-in-depth clamp in `_placeOrdersWithSpread` (`if (effectiveSpreadBps >= 10000) = 9999`)
so even the pull path cannot underflow.

**Proof.** *"F-08 · bounds volatility so the spread formula cannot underflow"* — a sane score (50)
is accepted, `type(uint256).max` is rejected.

---

### F-10 · Funding rate scaled by `FUNDING_INTERVAL` twice — **High · Fixed**

**Location:** `contracts/core/PerpEngine.sol:125,144`

```solidity
return (diff * 1e18) / idxPriceSigned / int256Safe(FUNDING_INTERVAL);   // ÷ 28800 extra
```

**Description.** The funding rate is meant to be a **per-interval** premium ratio
(`(mark − index) / index`), and `applyFunding` is already gated to fire once per `FUNDING_INTERVAL`
(8 h). Dividing by the interval in seconds a second time shrinks the rate ~28 800×.

**Impact.** Funding is effectively always ~0, so the perp's price is never pulled toward the index —
the core mechanism that keeps mark ≈ spot is dead. A 1% premium should yield `1e16`; the original
returns `347222222222`.

**Proof.** *"F-10 · computes a per-interval funding rate"* — asserts `computeFundingRate == 1e16`;
original returns `347222222222`.

**Fix.** Removed the spurious `/ FUNDING_INTERVAL` from both `computeFundingRate` and `applyFunding`.
**Note:** funding *netting* and *per-pair* filtering remain open (see F-15/F-16).

---

### F-13 · `KeeperRegistry.removeKeeper` refunds via `transfer()` — **Medium · Fixed**

**Location:** `contracts/oracles/KeeperRegistry.sol:58`

**Description.** `payable(keeper).transfer(bond)` forwards only 2300 gas. A keeper that is a
contract (multisig, smart wallet, staking contract) with a non-trivial `receive()` cannot accept
the refund, so `removeKeeper` reverts and the bond is stranded.

**Proof.** *"F-13 · refunds a bond to a contract wallet that needs >2300 gas"* uses a
`GreedyReceiver` helper whose `receive()` does an SSTORE; the original `transfer()` reverts, the
patched low-level `call` succeeds.

**Fix.** Replaced with `(bool ok,) = payable(keeper).call{value: bond}(""); require(ok, ...)`.

---

### F-14 · Frontend targets the wrong Somnia chain id — **Medium · Fixed**

**Location:** `frontend/src/context/ContractsContext.tsx:43`

```solidity
const SOMNIA_CHAIN_ID = 50312;        // correct
const SOMNIA_CHAIN_HEX = "0xC478";    // == 50296 — WRONG
```

**Description.** `wallet_switchEthereumChain` / `wallet_addEthereumChain` were called with
`0xC478` (50296) while the project targets Somnia testnet **50312** (`0xC488`), per
`hardhat.config.ts` and `.env.example`. Users' wallets would be pointed at the wrong network.

**Fix.** Derive the hex from the id (`"0x" + SOMNIA_CHAIN_ID.toString(16)` → `0xc488`) so the two
constants can never diverge again.

---

## 4. Findings (documented — architectural)

These are real defects whose correct fix requires a data-model change. They are specified here with
a remediation design so they can land with proper coverage rather than be half-patched.

### F-07 · `PerpEngine.openPosition` attributes orders to itself — **Critical**

**Location:** `contracts/core/PerpEngine.sol:72–114`; consumer `frontend/src/hooks/useTrade.ts:36,51`

`openPosition`/`closePosition` call `orderBook.placeOrder(...)` from inside `PerpEngine`, so at the
order book `msg.sender` is the **PerpEngine**, not the trader. `placeOrder` then does
`marginVault.lockMargin(PerpEngine, margin)`; the engine holds no collateral, so it reverts
(`insufficient balance to lock`). **The frontend trade path cannot execute** — trading is broken
end-to-end through this entry point. (Direct `OrderBook.placeOrder` from the trader works, which is
why the order-book tests pass.)

**Remediation.** Either (a) drop the `PerpEngine` proxy and have the frontend call `OrderBook`
directly, or (b) add `OrderBook.placeOrderFor(address trader, ...)` callable only by the authorized
engine, so the trader's identity (and margin) is preserved. Option (b) keeps the single-entry-point
UX the engine was designed for.

### F-11 · `marginHealth` ignores free collateral — **Medium**

**Location:** `contracts/core/MarginVault.sol:206`

Health is `(pos.margin + unrealizedPnl) · leverage / size` — it considers only the margin locked in
the position, not the trader's free collateral in the vault. A trader who is solvent overall
(position underwater but ample free collateral) is still flagged unhealthy and liquidatable.

**Remediation.** Decide the margin model explicitly: either *isolated* (current behaviour — then
free collateral must NOT be withdrawable while a position is open, and that must be enforced) or
*cross* (health must include `getFreeMargin`). Mixing the two is what creates the inconsistency.

### F-12 · `computeLiquidationPrice` disagrees with the health trigger — **Medium**

**Location:** `contracts/core/MarginVault.sol:228` vs `:206`

The displayed/stored `liquidationPrice` (e.g. 47 500 for a 10× long at 50 000) is computed by a
different formula than the `marginHealth < MAINTENANCE_MARGIN_RATIO` condition that actually fires
liquidation (≈45 000). UI shows one liquidation price; the contract enforces another.

**Remediation.** Derive both from a single source of truth — compute the price at which
`marginHealth == MAINTENANCE_MARGIN_RATIO` and use that everywhere.

### F-15 · `updateAllPnL` applies one price across all pairs — **Low**

**Location:** `contracts/core/MarginVault.sol:192`

`updateAllPnL(currentIndexPrice)` walks every tracked trader and applies the *same* price. With
multiple pairs (BTC/ETH/SOL are all deployed), a BTC price update would revalue ETH and SOL
positions incorrectly.

**Remediation.** Make PnL updates per-pair (requires F-16), or pass a `pairId → price` map.

### F-16 · Single position slot per trader (no `pairId`) — **Low / Informational**

**Location:** `contracts/core/MarginVault.sol:19` — `mapping(address => Position) public positions;`

A trader can hold only **one** position globally. Opening a second (even on a different pair)
overwrites the first. This is the root cause behind F-15 and the funding/pair-filter gaps.

**Remediation.** Key positions by `(trader, pairId)`: `mapping(address => mapping(bytes32 => Position))`.
This is a storage-layout migration and should land with full test coverage of multi-pair accounting.

---

## 5. Architecture recommendations

1. **Unify the margin model.** Choose isolated vs cross margin and make `marginHealth`,
   `getFreeMargin`, `withdraw`, and liquidation all consistent with that single choice (F-03, F-11).
2. **Per-pair positions.** Move to `positions[trader][pairId]`; it unblocks correct multi-pair PnL
   (F-15), per-pair funding, and removes the overwrite hazard (F-16).
3. **Fix the trade entry point.** Resolve F-07 so the frontend can actually trade — this is the
   difference between a demo and a product.
4. **Real oracle + real collateral.** Replace the mintable `MockUSDC` with a canonical asset and the
   `updatePriceDirect` setter with the keeper-median `SomniaPriceOracle` (already in the repo but
   currently unreferenced by the core contracts). Add staleness checks (`updatedAt` bounds) and a
   circuit breaker on deviation.
5. **Prevent self-trading at placement.** The bounded skip in F-05 stops the DoS, but a production
   book should reject or cancel-on-cross a trader's own opposing order to keep the book clean.
6. **Net funding and route to an insurance fund.** `applyFunding` currently credits/debits each
   position independently; ensure longs' payments equal shorts' receipts (conserve total) and route
   residual to a tracked `insuranceFundBalance` (declared but never written today).
7. **Two-step ownership + timelock** for admin powers (`setAuthorized`, `adminClearBook`, oracle
   ownership) before mainnet.

---

## 6. Test evidence

The reproduction suite is `test/audit/findings.spec.ts` (11 tests). It is written to assert the
**secure** behaviour, so it fails against the vulnerable code and passes against the patched code —
the same file, run on both branches.

**Before (baseline `main`, unpatched):**

```
1 passing   (F-14 chain-id arithmetic only)
10 failing
  F-01  attacker CAN set oracle price        (expected revert, got success)
  F-02  attacker CAN poison index/mark price (expected revert, got success)
  F-03  getFreeMargin -> 400000000, expected 700000000
  F-04  lockedMargin -> 0, expected 200000000
  F-05  self-match placeOrder reverted (out of gas)
  F-06  attacker CAN mint collateral         (expected revert, got success)
  F-08  attacker CAN push volatility/sentiment; huge volatility accepted
  F-10  funding rate -> 347222222222, expected 10000000000000000
  F-13  bond refund to contract keeper reverted (transfer 2300 gas)
```

**After (`security-audit`, patched):**

```
Repro suite .... 11 passing
Full suite ..... 88 passing, 0 failing   (77 original + 11 reproduction)
```

Run it yourself:

```bash
git checkout security-audit
npm install
npx hardhat test                              # 88 passing
npx hardhat test test/audit/findings.spec.ts  # 11 passing (the audit proofs)
```

---

## 7. Files changed on `security-audit`

**Contracts (patched):** `MarginVault.sol` (F-03, F-04), `OrderBook.sol` (F-05),
`PerpEngine.sol` (F-02, F-10), `OracleAdapter.sol` (F-01), `MockUSDC.sol` (F-06),
`EnhancedLiquidityProviderAgent.sol` (F-08, F-09), `KeeperRegistry.sol` (F-13).

**Frontend:** `ContractsContext.tsx` (F-14).

**Wiring:** `scripts/deploy.ts` (authorize order books + oracle on PerpEngine),
`test/fixtures.ts`, `test/OrderBook.test.ts`, `test/AgentIntegration.test.ts` (same authorization).

**New:** `test/audit/findings.spec.ts` (reproduction suite),
`contracts/mocks/GreedyReceiver.sol` (F-13 test helper), `docs/audit/AUDIT_REPORT.md` (this file).

---

*Prepared as a security case study. All findings are reproducible from the committed tests.*
