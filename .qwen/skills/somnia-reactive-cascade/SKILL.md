---
name: somnia-reactive-cascade
description: Build an autonomous reactive event cascade on Somnia — Smart contracts that self-execute in response to on-chain events using Somnia's reactive layer, with no off-chain keepers or bots.
source: auto-skill
extracted_at: '2026-05-27T22:26:01.353Z'
---

# Somnia Reactive Cascade Architecture

Build a system where smart contracts autonomously respond to on-chain events using Somnia's reactive execution layer — no off-chain keepers, cron jobs, or MEV bots needed.

## Mental Model

Somnia's reactive layer allows contracts to subscribe to events from other contracts. When a subscribed event fires, the reactive layer automatically calls `onEvent()` on the subscriber contract **within the same block**.

```
Event Source (emits event)
    │
    ▼
Somnia Reactive Layer (detects event, finds subscribers)
    │
    ▼
AgentInterface.onEvent(source, topic, data)
    ├── dispatch action 1  (e.g., PnL update)
    ├── dispatch action 2  (e.g., liquidation check)
    └── dispatch action 3  (e.g., LP rebalance)
```

## Implementation Pattern

### 1. Define the Reactive Gateway Contract

```solidity
contract AgentInterface {
    // Event topics to subscribe to
    bytes32 public constant PRICE_UPDATED_TOPIC =
        keccak256("PriceUpdated(bytes32,uint256,uint256)");
    bytes32 public constant ORDER_PLACED_TOPIC =
        keccak256("OrderPlaced(uint256,address,bool,uint256,uint256)");

    // Subscription registry
    mapping(address => mapping(bytes32 => bool)) public subscriptions;

    // Called by Somnia's reactive layer
    function onEvent(address source, bytes32 topic, bytes calldata data)
        external
    {
        require(subscriptions[source][topic], "not subscribed");

        if (topic == PRICE_UPDATED_TOPIC) {
            (, uint256 newPrice) = abi.decode(data, (bytes32, uint256));
            _handlePriceUpdate(newPrice);
        }

        if (topic == ORDER_PLACED_TOPIC) {
            _handleNewOrder();
        }
    }

    function _handlePriceUpdate(uint256 price) internal {
        vault.updateAllPnL(price);
        sentinel.checkAllPositions(price);
        lpAgent.rebalance(price);
    }

    function _handleNewOrder() internal {
        orderBook.attemptMatch();
    }
}
```

### 2. Subscribe Events

```solidity
// In deploy script or admin function
bytes32 priceTopic = oracleAdapter.PRICE_UPDATED_TOPIC();
bytes32 orderTopic = orderBook.ORDER_PLACED_TOPIC();
agentInterface.subscribe(oracleAdapterAddress, priceTopic);
agentInterface.subscribe(orderBookAddress, orderTopic);
```

### 3. Emit Events from Source Contracts

```solidity
contract OracleAdapter {
    function updatePrice(uint256 price) external {
        latestPrice = price;
        emit PriceUpdated(assetId, price, block.timestamp);
        // Reactive layer detects this and triggers subscribers
    }
}
```

### 4. Simulate the Cascade (for testing)

```solidity
// For local testing without Somnia reactive layer
function simulatePriceUpdate(uint256 newPrice) external {
    vault.updateAllPnL(newPrice);
    sentinel.checkAllPositions(newPrice);
    lpAgent.rebalance(newPrice);
}
```

## Key Points
- **Sub-second finality** — Somnia's MultiStream BFT means the entire cascade resolves in one block
- **No keeper** — No external wallet, cron job, or Chainlink Automation needed
- **Cascade chaining** — Multiple actions in one onEvent() call (PnL → liquidation → rebalance)
- **Gas budget** — Keep the total cascade gas within block limit; use `MAX_MATCHES_PER_CALL` patterns for unbounded loops
- **Parallelizable** — Independent actions (liquidation check vs LP rebalance) can run on separate Somnia streams

## Testing

```solidity
// Hardhat test snippet
it("should trigger full cascade on price update", async function () {
    await oracleAdapter.updatePriceDirect(45000n * 10n ** 8n);

    // Simulate reactive detection
    await agentInterface.simulatePriceUpdate(45000n * 10n ** 8n);

    // Verify liquidation happened
    const events = await sentinel.queryFilter(
        sentinel.filters.LiquidationExecuted()
    );
    expect(events.length).to.be.gt(0);
});
```