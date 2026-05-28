---
name: somnia-keeper-median-oracle
description: Design and deploy a keeper-median price oracle with bonding, slashing, spread checks, circuit breaker, and TWAP — providing sub-3s decentralized price feeds for perpetual DEXes on Somnia.
source: auto-skill
extracted_at: '2026-05-28T01:23:26.625Z'
---

# Keeper-Median Oracle Architecture

For perpetual DEXes that need real-time on-chain prices without the 30-120s latency of Somnia Agents, deploy a **keeper-median oracle** where authorized keepers post prices directly via transactions (~2-3s).

## Architecture Overview

```
PostPrice Script (off-chain HTTP → CoinGecko)
  │
  │ tx (~2s)
  ▼
SomniaPriceOracle.postPrice(asset, price)
  │
  ├── Record keeper's post (with timestamp)
  ├── Sort all fresh keeper posts (≤15s old)
  ├── Spread check: reject if high-low > 5%
  ├── Compute median
  ├── Store: lastAcceptedPrice[asset] = median
  └── emit PriceUpdated(asset, median, timestamp)
        │
        ▼
  CompositeOracle.getMarkPrice() → returns median
        │
        ▼
  MarginVault.updatePnL() / PerpEngine funding / Frontend chart
```

## Contract Stack

```
KeeperRegistry (keeper auth, bonding, slashing)
    │
SomniaPriceOracle (price posting, median computation, circuit breaker)
    │
CompositeOracle (single DEX facade)
    ├── getMarkPrice()       → perps PnL + funding
    └── getLiquidationPrice() → liquidation decisions
```

## Contract 1: KeeperRegistry

Manages the authorized keeper set. Keepers bond STT to participate.

```solidity
contract KeeperRegistry {
    uint256 public constant MIN_BOND = 0.1 ether;
    uint256 public constant SLASH_AMOUNT = 0.05 ether;
    uint256 public constant MAX_KEEPERS = 10;

    struct Keeper {
        bool active;
        uint256 bond;
        uint256 lastPost;
        uint256 totalPosts;
        uint256 totalSlashes;
    }
    mapping(address => Keeper) public keepers;
    address[] public keeperList;

    function addKeeper(address keeper) external payable onlyOwner {
        require(msg.value >= MIN_BOND, "bond too low");
        keepers[keeper] = Keeper({active: true, bond: msg.value, ...});
        keeperList.push(keeper);
    }

    function slash(address keeper, string calldata reason) external onlyOwner {
        keepers[keeper].bond -= SLASH_AMOUNT;
        // Auto-remove if bond falls below MIN_BOND
    }

    function recordPost(address keeper) external {
        // Called by SomniaPriceOracle to update lastPost timestamp
    }
}
```

## Contract 2: SomniaPriceOracle

Keepers post prices. Fresh posts are collected, sorted, and the median becomes the accepted price.

```solidity
contract SomniaPriceOracle {
    uint256 public constant MIN_KEEPERS_FOR_MEDIAN = 1;  // demo: 1; production: 3
    uint256 public constant KEEPER_STALENESS = 15 seconds;
    uint256 public constant CIRCUIT_BREAKER_WINDOW = 30 seconds;
    uint256 public constant MAX_KEEPER_DEVIATION_BPS = 500; // 5%

    mapping(bytes32 => mapping(address => PricePost)) public keeperPosts;
    mapping(bytes32 => uint256) public lastAcceptedPrice;
    mapping(bytes32 => uint256) public lastAcceptedTimestamp;
    bool public halted;

    function postPrice(bytes32 asset, uint256 price) external onlyKeeper notHalted {
        require(price > 0, "zero price");
        keeperPosts[asset][msg.sender] = PricePost(price, block.timestamp, msg.sender);
        registry.recordPost(msg.sender);
        _tryCommitMedian(asset);
    }

    function _tryCommitMedian(bytes32 asset) internal {
        // 1. Collect fresh posts (≤KEEPER_STALENESS old)
        // 2. Insertion sort prices
        // 3. Spread check: (high - low) * 10000 / low <= MAX_KEEPER_DEVIATION_BPS
        // 4. Compute median (odd count = middle, even = average of two middle)
        // 5. Store: lastAcceptedPrice[asset] = median
        // 6. emit PriceUpdated
        // If spread too high → _halt("Keeper spread too high")
    }

    function getPrice(bytes32 asset) external view notHalted
        returns (uint256 price, uint256 timestamp)
    {
        // Reverts if price > 30s stale
        require(block.timestamp - lastAcceptedTimestamp <= CIRCUIT_BREAKER_WINDOW,
            "price stale");
    }

    function _halt(string memory reason) internal {
        halted = true;
        emit OracleHalted(reason, block.timestamp);
    }
}
```

## Contract 3: CompositeOracle

Single entry point for the DEX. Selects the right source per use case.

```solidity
contract CompositeOracle {
    SomniaPriceOracle public immutable keeperOracle;

    /// @notice Mark price for perps — keeper median (primary)
    function getMarkPrice() external view returns (uint256) {
        if (keeperOracle.isHealthy(asset)) {
            (price,) = keeperOracle.getPrice(asset);
            return price;
        }
    }

    /// @notice Liquidation price — requires keeper median
    function getLiquidationPrice() external view returns (uint256) { ... }
}
```

## Deployment Order

```bash
# 1. Deploy KeeperRegistry + bond keepers
npx hardhat run scripts/registerKeepers.ts --network somnia

# 2. Deploy SomniaPriceOracle + CompositeOracle + post price
npx hardhat run scripts/redeployOracle.ts --network somnia

# 3. Update frontend addresses to point to CompositeOracle
# Edit: frontend/src/config/addresses.ts
# compositeOracle: "0x..."

# 4. Post price periodically (for demo)
npx hardhat run scripts/postPrice.ts --network somnia
```

## Post-Processing Price Script

The price posting script fetches CoinGecko off-chain and posts as keeper:

```typescript
// scripts/postPrice.ts
async function main() {
  const [keeper] = await ethers.getSigners();
  const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
  const data = await resp.json();
  const priceFloat = data.bitcoin.usd;
  const price = BigInt(Math.floor(priceFloat * 1e18)); // 18 decimals for keeper median

  const Oracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = Oracle.attach(ORACLE_ADDRESS);
  await oracle.connect(keeper).postPrice(ASSET_ID, price);
}
```

## Production Considerations

- **MIN_KEEPERS_FOR_MEDIAN**: Set to 3+ in production. 1 is for demo only.
- **Keeper diversity**: Use different wallets with independent CoinGecko/Exchange sources.
- **Slashing**: Implement challenge mechanism for provably false prices.
- **Budget**: Each keeper bonds 0.1 STT. Slashing removes 0.05 STT per violation.
- **Circuit breaker**: Auto-halts if prices go stale or keepers disagree. Manual resume via `resumeOracle()`.

## Pros vs. Somnia Agents

| Criteria | Keeper Median | Somnia JSON API Agent |
|----------|--------------|----------------------|
| Latency | ~2-3s (direct tx) | 30-120s (async consensus) |
| Decentralization | N bonded keepers | 3 validator subcommittee |
| Consensus | Median of independent posts | Threshold (2/3) byte-identical |
| TX cost | Standard gas + keeper bonding | Agent deposit (0.12 STT min) |
| Frontend display | Real-time (~3s poll) | Awaiting callback indicator |
| Agentathon narrative | Strong ("decentralized keepers") | Strong ("zero keeper proof") |

## Hybrid Strategy for Agentathon

Use **both** to maximize the narrative:
1. **Keeper median** for real-time trading price (CompositeOracle — frontend trades smoothly)
2. **Somnia JSON API Agent** for async verification (AgentDashboard shows "Verified by Somnia ✅")

This demonstrates the innovation (keeper oracle solves latency) while preserving the agentathon narrative (Somnia agents provide decentralized verification).