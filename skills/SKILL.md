# Sentient Finance — Project Skills Reference

Project-specific integration patterns for building on Sentient Finance.

## Available Skills

| Skill | Purpose | Location |
|-------|---------|----------|
| **Somnia Agents Platform** | Core agent invocation from contracts | `~/.qwen/skills/somnia-agents/SKILL.md` |
| **JSON API Request** | Fetch live prices from REST APIs | `~/.qwen/skills/somnia-agents-json-fetch/SKILL.md` |
| **LLM Inference** | On-chain LLM (Qwen3-30B) for classification/scoring | `~/.qwen/skills/somnia-agents-llm-inference/SKILL.md` |
| **LLM Parse Website** | Extract structured data from webpages | `~/.qwen/skills/somnia-agents-llm-parse-website/SKILL.md` |
| **Agent Invoke CLI** | One-shot agent invocation without contracts | `~/.qwen/skills/somnia-agents-invoke/SKILL.md` |

## Integration Patterns Used in This Project

### Pattern 1: Reactive Event Cascade
```
OracleAdapter/AgentOracle → emit PriceUpdated
  → AgentInterface.onEvent() → marginVault.updateAllPnL()
    → sentinel.checkAllPositions() → liquidate()
    → lpAgent.rebalance() → cancel + place orders
```

### Pattern 2: Somnia JSON API Agent (AgentOracle)
```solidity
// See contracts/oracles/AgentOracle.sol
// 1. createRequest{deposit}(JSON_API_AGENT_ID, callback, payload)
// 2. handleResponse(requestId, responses[], status) → decode price
// 3. emit PriceUpdated → triggers reactive cascade
```

### Pattern 3: Two-Pot Gas Model
```
msg.value = getRequestDeposit() + pricePerAgent × subcommitteeSize
          = 0.03 STT          + 0.03 STT × 3
          = 0.12 STT (minimum)
```

### Pattern 4: Agent Interface Contracts
```
ILiquidationSentinel    — checkAllPositions(uint256)
ILiquidityProviderAgent — rebalance(uint256)
IJsonApiAgent           — fetchUint(url, selector, decimals)
```

## Agent IDs (same on mainnet + testnet)

| Agent | ID | Price |
|-------|----|-------|
| JSON API Request | `13174292974160097713` | 0.03 STT |
| LLM Inference | `12847293847561029384` | 0.07 STT |
| LLM Parse Website | `12875401142070969085` | 0.10 STT |
