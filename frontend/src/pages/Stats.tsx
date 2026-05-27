import { useProtocolStats, useOraclePrice } from "../hooks/useOraclePrice";

export default function Stats() {
  const stats = useProtocolStats();
  const btcPrice = useOraclePrice("BTC-USD");

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        PROTOCOL STATISTICS
      </h2>

      {/* Live stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Total Volume"
          value={`${stats.totalVolume.toFixed(2)} BTC`}
          sub={stats.totalVolume > 0 ? "Live on-chain" : "No trades yet"}
        />
        <StatCard
          label="BTC Index Price"
          value={btcPrice ? `$${btcPrice.toLocaleString()}` : "—"}
          sub={btcPrice ? "From OracleAdapter" : "Awaiting oracle"}
        />
        <StatCard
          label="Mark Price (VWAP)"
          value={stats.markPrice ? `$${stats.markPrice.toLocaleString()}` : "—"}
          sub="Volume-weighted from fills"
        />
        <StatCard
          label="Active Pairs"
          value={String(stats.activePairs)}
          sub="BTC-USD, ETH-USD, SOL-USD"
        />
        <StatCard
          label="Maintenance Margin"
          value="5.00%"
          sub="Liquidation threshold"
        />
        <StatCard
          label="Chain"
          value="Somnia Testnet"
          sub="Chain ID 50312"
        />
      </div>

      {/* Architecture summary */}
      <div className="border border-cyan/20 rounded-lg p-6 bg-surface">
        <h3 className="font-heading text-sm text-cyan mb-4">HOW IT WORKS</h3>
        <div className="space-y-3 text-sm text-gray-400 leading-relaxed">
          <p>
            <span className="text-white">1. Order Matching</span> — When a new order crosses the spread,
            <code className="text-cyan-dim"> _attemptMatch()</code> fires within the same transaction.
            No keeper bot monitors the mempool. The OrderBook emits{' '}
            <code className="text-yellow-400/70">OrderPlaced</code>, Somnia's reactive layer detects
            it, and <code className="text-cyan-dim">AgentInterface.onEvent()</code> calls{' '}
            <code className="text-cyan-dim">attemptMatch()</code> again — all within one block.
          </p>
          <p>
            <span className="text-white">2. Liquidations</span> — When the oracle emits{' '}
            <code className="text-yellow-400/70">PriceUpdated</code>, the reactive layer triggers
            PnL recalculation for every tracked position. The Liquidation Sentinel then scans all
            positions and liquidates any with health below 5%. No MEV bot. No off-chain cron.
          </p>
          <p>
            <span className="text-white">3. AI-Augmented Market Making</span> — SentimentOracle
            calls all three Somnia Agents (JSON API for CoinGecko, LLM Parse Website for CoinDesk,
            LLM Inference for sentiment). The Enhanced LP Agent uses this data to dynamically
            adjust its spread — wider when bearish, tighter when bullish.
          </p>
          <p>
            <span className="text-white">4. Zero Off-Chain Infrastructure</span> — Every component
            (matching, liquidation, market making, price updates) operates entirely on-chain via
            Somnia's reactive extensions. There are no keeper scripts, no Chainlink Automation
            nodes, and no MEV searchers anywhere in the system.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-surface">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-medium text-white">{value}</div>
      <div className="text-xs text-gray-600 mt-1">{sub}</div>
    </div>
  );
}