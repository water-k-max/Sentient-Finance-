export default function AgentDashboard() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        AGENT DASHBOARD
      </h2>

      <div className="grid grid-cols-2 gap-6">
        {/* LP Agent Card */}
        <div className="border border-border rounded-lg p-6 bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-cyan pulse-active" />
            <h3 className="font-heading text-lg text-white">Liquidity Provider Agent</h3>
          </div>
          <div className="space-y-3 text-sm">
            <StatRow label="Status" value="Active" valueClass="text-green" />
            <StatRow label="Current Bid" value="$49,950.00" />
            <StatRow label="Current Ask" value="$50,050.00" />
            <StatRow label="Spread" value="0.20%" />
            <StatRow label="Order Size" value="1.0000 BTC" />
            <StatRow label="Total Fills" value="147" />
            <StatRow label="PnL from Fees" value="+$2,340.50" valueClass="text-green" />
          </div>
          <div className="mt-4 flex gap-2">
            <button className="text-xs bg-red/10 text-red border border-red/30 px-3 py-1 rounded hover:bg-red/20">
              Pause
            </button>
            <button className="text-xs bg-cyan/10 text-cyan border border-cyan/30 px-3 py-1 rounded hover:bg-cyan/20">
              Rebalance Now
            </button>
          </div>
        </div>

        {/* Sentinel Card */}
        <div className="border border-border rounded-lg p-6 bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-green pulse-active" />
            <h3 className="font-heading text-lg text-white">Liquidation Sentinel</h3>
          </div>
          <div className="space-y-3 text-sm">
            <StatRow label="Status" value="Monitoring" valueClass="text-green" />
            <StatRow label="Tracked Positions" value="3" />
            <StatRow label="Total Liquidations" value="7" />
            <StatRow label="Insurance Fund" value="$12,450.00" />
            <StatRow label="Last Liquidation" value="$42,100 (0xabc...def)" />
            <StatRow label="Health Threshold" value="5.00%" />
          </div>
          <div className="mt-4 flex gap-2">
            <button className="text-xs bg-red/10 text-red border border-red/30 px-3 py-1 rounded hover:bg-red/20">
              Pause
            </button>
            <button className="text-xs bg-cyan/10 text-cyan border border-cyan/30 px-3 py-1 rounded hover:bg-cyan/20">
              Check All Positions
            </button>
          </div>
        </div>
      </div>

      {/* Architecture Note */}
      <div className="mt-8 border border-cyan/20 rounded-lg p-6 bg-cyan-dim/5">
        <h4 className="font-heading text-sm text-cyan mb-2">ZERO KEEPER PROOF</h4>
        <p className="text-sm text-gray-400 leading-relaxed">
          No off-chain script, cron job, or Chainlink Automation node is used in the matching
          or liquidation pipeline. Both agents operate entirely on-chain via Somnia&apos;s reactive
          execution layer — events trigger contract calls within the same block.
        </p>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${valueClass || "text-white"}`}>{value}</span>
    </div>
  );
}
