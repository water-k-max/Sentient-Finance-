// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
//  SOMNIA DEX ORACLE ARCHITECTURE
//  Multi-source oracle: Keeper Median + Push Oracle Bound +
//  TWAP + Reactive Circuit Breaker
// ============================================================

// ─────────────────────────────────────────────────────────────
// SECTION 1 — INTERFACES
// ─────────────────────────────────────────────────────────────

/// @notice DIA Oracle interface (mainnet: 0xbA0E0750A56e995506CA458b2BdD752754CF39C4)
interface IDIAOracle {
    function getValue(string memory key)
        external
        view
        returns (uint128 price, uint128 timestamp);
}

/// @notice Chainlink/Protofire compatible interface
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @notice Somnia on-chain reactivity handler base
/// @dev Inherit this to receive validator-invoked event callbacks
interface ISomniaEventHandler {
    function onEvent(bytes calldata eventData) external;
}

// ─────────────────────────────────────────────────────────────
// SECTION 2 — KEEPER REGISTRY
//  Manages the authorised keeper set, their bonds, and
//  slashing logic for misbehaviour.
// ─────────────────────────────────────────────────────────────

contract KeeperRegistry {

    // ── State ──────────────────────────────────────────────

    address public owner;
    uint256 public constant MIN_BOND          = 0.1 ether;   // SOMI bond per keeper
    uint256 public constant SLASH_AMOUNT      = 0.05 ether;  // slash on provable bad price
    uint256 public constant MAX_KEEPERS       = 10;

    struct Keeper {
        bool    active;
        uint256 bond;
        uint256 lastPost;
        uint256 totalPosts;
        uint256 totalSlashes;
    }

    mapping(address => Keeper) public keepers;
    address[] public keeperList;

    // ── Events ─────────────────────────────────────────────

    event KeeperAdded(address indexed keeper, uint256 bond);
    event KeeperRemoved(address indexed keeper);
    event KeeperSlashed(address indexed keeper, uint256 amount, string reason);

    // ── Modifiers ──────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── External ───────────────────────────────────────────

    function addKeeper(address keeper) external payable onlyOwner {
        require(!keepers[keeper].active,         "Already keeper");
        require(msg.value >= MIN_BOND,           "Bond too low");
        require(keeperList.length < MAX_KEEPERS, "Max keepers");

        keepers[keeper] = Keeper({
            active:       true,
            bond:         msg.value,
            lastPost:     0,
            totalPosts:   0,
            totalSlashes: 0
        });
        keeperList.push(keeper);
        emit KeeperAdded(keeper, msg.value);
    }

    function removeKeeper(address keeper) external onlyOwner {
        require(keepers[keeper].active, "Not active keeper");
        keepers[keeper].active = false;
        uint256 bond = keepers[keeper].bond;
        keepers[keeper].bond = 0;
        payable(keeper).transfer(bond);
        emit KeeperRemoved(keeper);
    }

    /// @notice Slash a keeper for a provably bad price post
    /// @dev    Called by oracle contract after deviation check
    function slash(address keeper, string calldata reason) external onlyOwner {
        require(keepers[keeper].active,           "Not active keeper");
        require(keepers[keeper].bond >= SLASH_AMOUNT, "Bond too low to slash");
        keepers[keeper].bond         -= SLASH_AMOUNT;
        keepers[keeper].totalSlashes += 1;
        emit KeeperSlashed(keeper, SLASH_AMOUNT, reason);

        // Auto-remove keeper if bond falls below minimum
        if (keepers[keeper].bond < MIN_BOND) {
            keepers[keeper].active = false;
            emit KeeperRemoved(keeper);
        }
    }

    // ── View ───────────────────────────────────────────────

    function isActiveKeeper(address keeper) external view returns (bool) {
        return keepers[keeper].active;
    }

    function activeKeeperCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < keeperList.length; i++) {
            if (keepers[keeperList[i]].active) count++;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 3 — PUSH ORACLE BOUND ADAPTER
//  Wraps DIA + Protofire into a unified sanity rail.
//  Returns the average of available sources as the bound price.
//  Oracle contract uses this only for deviation checking —
//  never as the primary execution price.
// ─────────────────────────────────────────────────────────────

contract PushOracleBound {

    // ── Config ─────────────────────────────────────────────

    IDIAOracle  public immutable diaOracle;
    IAggregatorV3 public immutable protofireOracle;

    uint256 public constant STALENESS_THRESHOLD = 60 seconds;

    // ── Constructor ────────────────────────────────────────

    constructor(address _dia, address _protofire) {
        diaOracle       = IDIAOracle(_dia);
        protofireOracle = IAggregatorV3(_protofire);
    }

    // ── External ───────────────────────────────────────────

    /// @notice Returns the best available bound price (18 decimals)
    /// @dev    Averages non-stale sources. Reverts if ALL sources stale.
    function getBoundPrice(string memory diaKey)
        external
        view
        returns (uint256 boundPrice)
    {
        uint256 sum;
        uint256 count;

        // ── DIA source ──
        try diaOracle.getValue(diaKey) returns (uint128 price, uint128 ts) {
            if (block.timestamp - ts <= STALENESS_THRESHOLD && price > 0) {
                // DIA returns 8 decimals — scale to 18
                sum   += uint256(price) * 1e10;
                count += 1;
            }
        } catch {}

        // ── Protofire/Chainlink source ──
        try protofireOracle.latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (
                block.timestamp - updatedAt <= STALENESS_THRESHOLD &&
                answer > 0
            ) {
                // Chainlink returns 8 decimals — scale to 18
                sum   += uint256(answer) * 1e10;
                count += 1;
            }
        } catch {}

        require(count > 0, "All push oracles stale");
        boundPrice = sum / count;
    }

    /// @notice Check whether a price is within the allowed band of the bound
    /// @param  candidate  Price to validate (18 decimals)
    /// @param  bound      Bound price from getBoundPrice (18 decimals)
    /// @param  bpsTolerance  Allowed deviation in basis points (e.g. 200 = 2%)
    function withinBand(
        uint256 candidate,
        uint256 bound,
        uint256 bpsTolerance
    ) external pure returns (bool) {
        uint256 delta = candidate > bound
            ? candidate - bound
            : bound - candidate;
        return delta * 10_000 <= bound * bpsTolerance;
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4 — SOMNIA PRICE ORACLE
//  Core oracle contract.
//
//  Price resolution order:
//    1. Keeper median  — primary, ~1-3s latency (direct tx)
//    2. Push oracle    — sanity bound only, NOT execution price
//    3. Circuit breaker — halts if both sources stale
//
//  TWAP is implemented in the AMM pool itself (Section 5).
//  This contract serves perps mark price and spot execution.
// ─────────────────────────────────────────────────────────────

contract SomniaOracle {

    // ── Config ─────────────────────────────────────────────

    uint256 public constant MIN_KEEPERS_FOR_MEDIAN  = 3;
    uint256 public constant KEEPER_STALENESS        = 15 seconds;
    uint256 public constant CIRCUIT_BREAKER_WINDOW  = 30 seconds;
    uint256 public constant MAX_DEVIATION_BPS       = 200;  // 2% band vs push oracle
    uint256 public constant MAX_KEEPER_DEVIATION_BPS = 500; // 5% max spread between keepers

    // ── Dependencies ───────────────────────────────────────

    KeeperRegistry   public immutable registry;
    PushOracleBound  public immutable boundAdapter;
    address          public owner;

    // ── State ──────────────────────────────────────────────

    struct PricePost {
        uint256 price;      // 18 decimals
        uint256 timestamp;
        address keeper;
    }

    // asset key => keeper address => latest post
    mapping(bytes32 => mapping(address => PricePost)) public keeperPosts;

    // asset key => last accepted oracle price
    mapping(bytes32 => uint256) public lastAcceptedPrice;
    mapping(bytes32 => uint256) public lastAcceptedTimestamp;

    // asset key => DIA string key mapping
    mapping(bytes32 => string) public diaKeys;

    // Circuit breaker
    bool   public halted;
    uint256 public haltedAt;

    // ── Events ─────────────────────────────────────────────

    event PriceUpdated(bytes32 indexed asset, uint256 price, uint256 timestamp, uint256 keeperCount);
    event OracleHalted(string reason, uint256 timestamp);
    event OracleResumed(uint256 timestamp);
    event KeeperPostRejected(address indexed keeper, bytes32 indexed asset, uint256 price, string reason);
    event AssetRegistered(bytes32 indexed asset, string diaKey);

    // ── Modifiers ──────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier notHalted() {
        require(!halted, "Oracle halted");
        _;
    }

    modifier onlyKeeper() {
        require(registry.isActiveKeeper(msg.sender), "Not active keeper");
        _;
    }

    // ── Constructor ────────────────────────────────────────

    constructor(address _registry, address _boundAdapter) {
        registry     = KeeperRegistry(_registry);
        boundAdapter = PushOracleBound(_boundAdapter);
        owner        = msg.sender;
    }

    // ── Admin ──────────────────────────────────────────────

    function registerAsset(bytes32 asset, string calldata diaKey) external onlyOwner {
        diaKeys[asset] = diaKey;
        emit AssetRegistered(asset, diaKey);
    }

    function resumeOracle() external onlyOwner {
        require(halted, "Not halted");
        halted = false;
        emit OracleResumed(block.timestamp);
    }

    // ── Keeper Price Posting ────────────────────────────────

    /// @notice Keeper posts a signed price for an asset
    /// @dev    No signature verification here — keeper identity enforced
    ///         by KeeperRegistry. Signature verification optional extension.
    /// @param  asset    keccak256 of asset symbol e.g. keccak256("BTC/USD")
    /// @param  price    Price in 18 decimals
    function postPrice(bytes32 asset, uint256 price)
        external
        onlyKeeper
        notHalted
    {
        require(price > 0,                         "Zero price");
        require(bytes(diaKeys[asset]).length > 0,  "Asset not registered");

        // ── Bound check against push oracle ──
        // This is a soft check — if push oracle is stale, we skip the band check
        // and rely purely on keeper median spread check below.
        try boundAdapter.getBoundPrice(diaKeys[asset]) returns (uint256 bound) {
            bool inBand = boundAdapter.withinBand(price, bound, MAX_DEVIATION_BPS);
            if (!inBand) {
                emit KeeperPostRejected(
                    msg.sender, asset, price, "Exceeds push oracle band"
                );
                return; // Reject silently — keeper is not slashed for this alone
            }
        } catch {
            // Push oracle stale — proceed, median spread check still applies
        }

        // ── Record keeper's post ──
        keeperPosts[asset][msg.sender] = PricePost({
            price:     price,
            timestamp: block.timestamp,
            keeper:    msg.sender
        });

        registry.keepers(msg.sender); // touch keeper state (update lastPost externally)

        // ── Attempt median computation ──
        _tryCommitMedian(asset);
    }

    // ── Internal: Median Computation ───────────────────────

    /// @notice Collect all fresh keeper posts and compute median
    /// @dev    Sorts prices using insertion sort (gas-acceptable for MAX_KEEPERS=10)
    function _tryCommitMedian(bytes32 asset) internal {
        address[] memory allKeepers = registry.keeperList();
        uint256   freshCount;

        uint256[] memory prices = new uint256[](allKeepers.length);

        for (uint256 i = 0; i < allKeepers.length; i++) {
            address k = allKeepers[i];
            if (!registry.isActiveKeeper(k)) continue;

            PricePost storage post = keeperPosts[asset][k];
            if (
                post.timestamp > 0 &&
                block.timestamp - post.timestamp <= KEEPER_STALENESS &&
                post.price > 0
            ) {
                prices[freshCount] = post.price;
                freshCount++;
            }
        }

        if (freshCount < MIN_KEEPERS_FOR_MEDIAN) return; // Not enough keepers yet

        // ── Insertion sort ──
        uint256[] memory sorted = new uint256[](freshCount);
        for (uint256 i = 0; i < freshCount; i++) sorted[i] = prices[i];

        for (uint256 i = 1; i < freshCount; i++) {
            uint256 key = sorted[i];
            uint256 j   = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
        }

        // ── Spread check: reject if keepers disagree too much ──
        uint256 low  = sorted[0];
        uint256 high = sorted[freshCount - 1];
        uint256 spread = (high - low) * 10_000 / low;
        if (spread > MAX_KEEPER_DEVIATION_BPS) {
            // Keepers disagree — do not commit price, halt oracle
            _halt("Keeper spread too high");
            return;
        }

        // ── Compute median ──
        uint256 median;
        if (freshCount % 2 == 1) {
            median = sorted[freshCount / 2];
        } else {
            median = (sorted[freshCount / 2 - 1] + sorted[freshCount / 2]) / 2;
        }

        lastAcceptedPrice[asset]     = median;
        lastAcceptedTimestamp[asset] = block.timestamp;

        emit PriceUpdated(asset, median, block.timestamp, freshCount);
    }

    // ── Internal: Circuit Breaker ───────────────────────────

    function _halt(string memory reason) internal {
        halted    = true;
        haltedAt  = block.timestamp;
        emit OracleHalted(reason, block.timestamp);
    }

    // ── Price Read ─────────────────────────────────────────

    /// @notice Primary price read for DEX execution
    /// @dev    Reverts if oracle is halted or price is stale.
    ///         DEX contracts MUST call this — never read state directly.
    function getPrice(bytes32 asset)
        external
        view
        notHalted
        returns (uint256 price, uint256 timestamp)
    {
        price     = lastAcceptedPrice[asset];
        timestamp = lastAcceptedTimestamp[asset];

        require(price > 0,                                  "No price available");
        require(
            block.timestamp - timestamp <= CIRCUIT_BREAKER_WINDOW,
            "Price stale: oracle circuit breaker"
        );
    }

    /// @notice Check oracle health without reverting
    function isHealthy(bytes32 asset) external view returns (bool) {
        if (halted) return false;
        uint256 ts = lastAcceptedTimestamp[asset];
        return ts > 0 && block.timestamp - ts <= CIRCUIT_BREAKER_WINDOW;
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 5 — TWAP ACCUMULATOR
//  Plugs into your AMM pool. Accumulates price-seconds every
//  block. DEX uses this for spot execution price — immune to
//  single-block manipulation on Somnia's high-TPS chain.
//
//  Usage: call _updateTWAP() inside your pool's swap() function.
//  Read:  getTWAP(windowSeconds) for the execution price.
// ─────────────────────────────────────────────────────────────

contract TWAPAccumulator {

    // ── Config ─────────────────────────────────────────────

    uint256 public constant MIN_TWAP_WINDOW  = 15;  // seconds
    uint256 public constant MAX_TWAP_WINDOW  = 300; // 5 minutes
    uint256 public constant OBSERVATION_SIZE = 180; // circular buffer

    // ── State ──────────────────────────────────────────────

    struct Observation {
        uint256 timestamp;
        uint256 priceCumulativeLast; // price * time (Q112 fixed point style)
    }

    Observation[OBSERVATION_SIZE] public observations;
    uint256 public observationIndex;
    uint256 public observationCount;

    address public pool; // only the pool can write

    // ── Modifiers ──────────────────────────────────────────

    modifier onlyPool() {
        require(msg.sender == pool, "Not pool");
        _;
    }

    // ── Constructor ────────────────────────────────────────

    constructor(address _pool) {
        pool = _pool;
    }

    // ── Pool writes ────────────────────────────────────────

    /// @notice Called by pool on every swap to accumulate price-time
    /// @param  spotPrice  Current instantaneous pool price (18 decimals)
    function updateObservation(uint256 spotPrice) external onlyPool {
        uint256 idx  = observationIndex;
        uint256 last = observationCount > 0
            ? observations[(idx + OBSERVATION_SIZE - 1) % OBSERVATION_SIZE].priceCumulativeLast
            : 0;

        uint256 elapsed = observationCount > 0
            ? block.timestamp - observations[(idx + OBSERVATION_SIZE - 1) % OBSERVATION_SIZE].timestamp
            : 0;

        observations[idx] = Observation({
            timestamp:           block.timestamp,
            priceCumulativeLast: last + (spotPrice * elapsed)
        });

        observationIndex = (idx + 1) % OBSERVATION_SIZE;
        if (observationCount < OBSERVATION_SIZE) observationCount++;
    }

    // ── DEX reads ──────────────────────────────────────────

    /// @notice Returns the TWAP price over the requested window
    /// @param  windowSeconds  How far back to average (15–300s)
    function getTWAP(uint256 windowSeconds)
        external
        view
        returns (uint256 twapPrice)
    {
        require(windowSeconds >= MIN_TWAP_WINDOW, "Window too short");
        require(windowSeconds <= MAX_TWAP_WINDOW, "Window too long");
        require(observationCount >= 2,            "Not enough observations");

        uint256 currentIdx = (observationIndex + OBSERVATION_SIZE - 1) % OBSERVATION_SIZE;
        Observation memory latest = observations[currentIdx];

        // Walk back through circular buffer to find the target observation
        uint256 targetTime = latest.timestamp - windowSeconds;
        Observation memory oldest;
        bool found;

        for (uint256 i = 1; i < observationCount; i++) {
            uint256 checkIdx = (currentIdx + OBSERVATION_SIZE - i) % OBSERVATION_SIZE;
            if (observations[checkIdx].timestamp <= targetTime) {
                oldest = observations[checkIdx];
                found  = true;
                break;
            }
        }

        require(found, "Window exceeds observation history");

        uint256 elapsed = latest.timestamp - oldest.timestamp;
        require(elapsed > 0, "Zero elapsed");

        twapPrice = (latest.priceCumulativeLast - oldest.priceCumulativeLast) / elapsed;
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 6 — COMPOSITE ORACLE FACADE
//  Single entry point for the DEX.
//  Selects the right price source based on use case,
//  and enforces fallback ordering + circuit breaker.
//
//  ┌─────────────────────────────────────────────┐
//  │  Spot swap  →  TWAP (primary)               │
//  │                Keeper median (fallback)      │
//  │                                             │
//  │  Perps mark →  Keeper median (primary)      │
//  │                Push oracle (last resort)    │
//  │                                             │
//  │  Liquidation → Keeper median + DIA confirm  │
//  └─────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────

contract CompositeOracle {

    // ── Dependencies ───────────────────────────────────────

    SomniaOracle    public immutable keeperOracle;
    TWAPAccumulator public immutable twap;
    PushOracleBound public immutable pushOracle;

    uint256 public constant LIQUIDATION_CONFIRM_BPS = 100; // 1% — keeper vs DIA must agree

    string  public diaKey; // e.g. "ETH/USD"
    bytes32 public asset;  // e.g. keccak256("ETH/USD")

    // ── Constructor ────────────────────────────────────────

    constructor(
        address _keeperOracle,
        address _twap,
        address _pushOracle,
        string memory _diaKey,
        bytes32 _asset
    ) {
        keeperOracle = SomniaOracle(_keeperOracle);
        twap         = TWAPAccumulator(_twap);
        pushOracle   = PushOracleBound(_pushOracle);
        diaKey       = _diaKey;
        asset        = _asset;
    }

    // ── Spot Swap Price ────────────────────────────────────

    /// @notice Returns execution price for spot DEX swap
    /// @dev    Prefers TWAP. Falls back to keeper median if TWAP history thin.
    function getSpotPrice() external view returns (uint256 price) {
        // Try TWAP first (manipulation-resistant, self-referential)
        try twap.getTWAP(30) returns (uint256 twapPrice) {
            return twapPrice;
        } catch {}

        // Fallback to keeper median
        (price,) = keeperOracle.getPrice(asset);
    }

    // ── Perps Mark Price ───────────────────────────────────

    /// @notice Returns mark price for perps funding and PnL
    /// @dev    Keeper median is primary. Push oracle is last resort.
    function getMarkPrice() external view returns (uint256 price) {
        // Try keeper median
        if (keeperOracle.isHealthy(asset)) {
            (price,) = keeperOracle.getPrice(asset);
            return price;
        }

        // Last resort: push oracle (may be up to 60s stale — log and alert)
        price = pushOracle.getBoundPrice(diaKey);
    }

    // ── Liquidation Price ──────────────────────────────────

    /// @notice Returns price for liquidation decisions — requires dual confirmation
    /// @dev    Keeper median and push oracle MUST agree within 1% band.
    ///         Reverts if they disagree — do NOT liquidate on uncertain price.
    function getLiquidationPrice() external view returns (uint256 price) {
        require(keeperOracle.isHealthy(asset), "Keeper oracle unhealthy — cannot liquidate");

        (uint256 keeperPrice,) = keeperOracle.getPrice(asset);

        uint256 pushPrice = pushOracle.getBoundPrice(diaKey);

        bool confirmed = pushOracle.withinBand(
            keeperPrice, pushPrice, LIQUIDATION_CONFIRM_BPS
        );
        require(confirmed, "Liquidation price not confirmed by push oracle");

        return keeperPrice;
    }

    // ── Oracle Health ──────────────────────────────────────

    function oracleHealthStatus() external view returns (
        bool keeperHealthy,
        bool twapHealthy,
        bool pushHealthy
    ) {
        keeperHealthy = keeperOracle.isHealthy(asset);

        try twap.getTWAP(30) returns (uint256) {
            twapHealthy = true;
        } catch {
            twapHealthy = false;
        }

        try pushOracle.getBoundPrice(diaKey) returns (uint256) {
            pushHealthy = true;
        } catch {
            pushHealthy = false;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// SECTION 7 — DEPLOYMENT REFERENCE
// ─────────────────────────────────────────────────────────────

/*

DEPLOYMENT ORDER:
────────────────────────────────────────────────────

1. KeeperRegistry.deploy()
   - owner = multisig / timelock
   - addKeeper(keeper1, {value: 0.1 ether})  x MIN 3 keepers
   - addKeeper(keeper2, {value: 0.1 ether})
   - addKeeper(keeper3, {value: 0.1 ether})

2. PushOracleBound.deploy(
       DIA_ORACLE   = 0xbA0E0750A56e995506CA458b2BdD752754CF39C4,  // mainnet
       PROTOFIRE    = <AggregatorV3 adapter addr per asset>
   )

3. SomniaOracle.deploy(registry.address, boundAdapter.address)
   - registerAsset(keccak256("ETH/USD"), "ETH/USD")
   - registerAsset(keccak256("BTC/USD"), "BTC/USD")

4. TWAPAccumulator.deploy(pool.address)
   - pool must call updateObservation() on every swap

5. CompositeOracle.deploy(
       keeperOracle.address,
       twap.address,
       pushOracle.address,
       "ETH/USD",
       keccak256("ETH/USD")
   )

KEEPER POSTING FLOW:
────────────────────────────────────────────────────
Keepers are off-chain bots (TypeScript/Go) that:
  1. Fetch price from CEX APIs (Binance, Coinbase, Kraken)
  2. Compute VWAP across sources
  3. Call SomniaOracle.postPrice(asset, price) every ~3-5 seconds
  4. Cost: ~1 SOMI tx per update — covered by keeper profit

SECURITY PARAMETERS (tune per asset):
────────────────────────────────────────────────────
  MIN_KEEPERS_FOR_MEDIAN    = 3      (increase for high-value assets)
  KEEPER_STALENESS          = 15s    (tight for perps, 30s acceptable for spot)
  CIRCUIT_BREAKER_WINDOW    = 30s    (halt if no fresh price in 30s)
  MAX_DEVIATION_BPS         = 200    (2% band vs DIA — widen for volatile assets)
  MAX_KEEPER_DEVIATION_BPS  = 500    (5% — keepers must broadly agree)
  LIQUIDATION_CONFIRM_BPS   = 100    (1% — tightest check, protects users)

*/
