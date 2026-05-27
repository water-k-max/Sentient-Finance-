import { useState, useEffect } from "react";
import { getAgentContracts, getProvider } from "../lib/contracts";

interface AgentState {
  trackedPositions: number;
  sentinelPaused: boolean;
  lpSpreadBps: number;
  lpBidActive: boolean;
  lpAskActive: boolean;
  lpPaused: boolean;
  enhancedLpSpreadBps: number;
  enhancedLpSentimentMultiplier: number;
  enhancedLpVolatilityScore: number;
  enhancedLpPaused: boolean;
  apiPrice: number;
  websitePrice: number;
  sentiment: string;
  volatilityScore: number;
  consensusPrice: number;
  lastUpdated: number;
}

export default function AgentDashboard() {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAgentData = async () => {
      try {
        const provider = getProvider();
        const { vault, sentinel, lpAgent, enhancedLp, sentimentOracle } =
          getAgentContracts(provider);

        const [
          trackedCount,
          sentinelPaused,
          lpSpread,
          lpBidActive,
          lpAskActive,
          lpPaused,
          enhancedSpread,
          enhancedSentiment,
          enhancedVol,
          enhancedLpPaused,
          apiPrice,
          websitePrice,
          sentiment,
          volScore,
          consensusPrice,
          lastUpdated,
        ] = await Promise.all([
          vault.trackedTradersCount(),
          sentinel.paused(),
          lpAgent.spreadBps(),
          lpAgent.activeBidExists(),
          lpAgent.activeAskExists(),
          lpAgent.paused(),
          enhancedLp.spreadBps(),
          enhancedLp.sentimentMultiplierBps(),
          enhancedLp.lastVolatilityScore(),
          enhancedLp.paused(),
          sentimentOracle.apiPrice(),
          sentimentOracle.websitePrice(),
          sentimentOracle.sentiment(),
          sentimentOracle.volatilityScore(),
          sentimentOracle.consensusPrice(),
          sentimentOracle.lastUpdated(),
        ]);

        if (cancelled) return;

        setAgentState({
          trackedPositions: Number(trackedCount),
          sentinelPaused,
          lpSpreadBps: Number(lpSpread),
          lpBidActive,
          lpAskActive,
          lpPaused,
          enhancedLpSpreadBps: Number(enhancedSpread),
          enhancedLpSentimentMultiplier: Number(enhancedSentiment),
          enhancedLpVolatilityScore: Number(enhancedVol),
          enhancedLpPaused,
          apiPrice: Number(apiPrice) / 1e8,
          websitePrice: Number(websitePrice) / 1e8,
          sentiment: sentiment || "—",
          volatilityScore: Number(volScore),
          consensusPrice: Number(consensusPrice) / 1e8,
          lastUpdated: Number(lastUpdated),
        });
        setLoading(false);
        setError(null);
      } catch (e: any) {
        console.error("Failed to fetch agent data:", e);
        if (!cancelled) {
          setError(e?.message || "Failed to fetch agent data");
          setLoading(false);
        }
      }
    };

    fetchAgentData();
    const interval = setInterval(fetchAgentData, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex items-center justify-center min-h-[50vh]">
        <span className="text-gray-500 text-sm">Loading agent data...</span>
      </div>
    );
  }

  if (error && !agentState) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="border border-red/30 bg-red/5 rounded-lg p-6">
          <p className="text-red text-sm">⚠️ Failed to load agent data: {error}</p>
          <p className="text-gray-500 text-xs mt-2">Showing cached data if available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        AGENT DASHBOARD
      </h2>

      <div className="grid grid-cols-2 gap-6">
        {/* Enhanced LP Agent Card (AI-Augmented) — spans full width */}
        <div className="border border-cyan/20 rounded-lg p-6 bg-surface col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-3 h-3 rounded-full ${
                !agentState?.enhancedLpPaused ? "bg-cyan pulse-active" : "bg-gray-600"
              }`}
            />
            <h3 className="font-heading text-lg text-white">
              Enhanced LP Agent (AI-Augmented)
            </h3>
            <span className="text-xs bg-cyan-dim text-cyan px-2 py-0.5 rounded">
              All 3 Agents
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <StatRow
              label="Base Spread"
              value={`${(agentState?.enhancedLpSpreadBps ?? 0) / 100}%`}
            />
            <StatRow
              label="Status"
              value={agentState?.enhancedLpPaused ? "Paused" : "Active"}
              valueClass={agentState?.enhancedLpPaused ? "text-red" : "text-green"}
            />
            <StatRow
              label="Sentiment (LLM Inference)"
              value={agentState?.sentiment ?? "—"}
              valueClass={
                agentState?.sentiment === "bullish"
                  ? "text-green"
                  : agentState?.sentiment === "bearish"
                  ? "text-red"
                  : "text-gray-300"
              }
            />
            <StatRow
              label="Sentiment Multiplier"
              value={
                agentState?.enhancedLpSentimentMultiplier != null
                  ? `${agentState.enhancedLpSentimentMultiplier} bps`
                  : "—"
              }
            />
            <StatRow
              label="Volatility Score (LLM Inference)"
              value={
                agentState?.enhancedLpVolatilityScore != null
                  ? String(agentState.enhancedLpVolatilityScore)
                  : "—"
              }
            />
            <StatRow
              label="Effective Spread (AI-adjusted)"
              value={`${(
                ((agentState?.enhancedLpSpreadBps ?? 0) *
                  (1 + (agentState?.enhancedLpVolatilityScore ?? 0) / 100)) /
                100
              ).toFixed(3)}%`}
              valueClass="text-cyan"
            />
          </div>
        </div>

        {/* LP Agent Card */}
        <div className="border border-border rounded-lg p-6 bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-3 h-3 rounded-full ${
                !agentState?.lpPaused ? "bg-cyan pulse-active" : "bg-gray-600"
              }`}
            />
            <h3 className="font-heading text-lg text-white">Base LP Agent</h3>
          </div>
          <div className="space-y-3 text-sm">
            <StatRow
              label="Status"
              value={agentState?.lpPaused ? "Paused" : "Active"}
              valueClass={agentState?.lpPaused ? "text-red" : "text-green"}
            />
            <StatRow
              label="Spread"
              value={`${(agentState?.lpSpreadBps ?? 0) / 100}%`}
            />
            <StatRow
              label="Bid Active"
              value={agentState?.lpBidActive ? "✅ Yes" : "❌ No"}
              valueClass={agentState?.lpBidActive ? "text-green" : "text-red"}
            />
            <StatRow
              label="Ask Active"
              value={agentState?.lpAskActive ? "✅ Yes" : "❌ No"}
              valueClass={agentState?.lpAskActive ? "text-green" : "text-red"}
            />
          </div>
        </div>

        {/* Sentinel Card */}
        <div className="border border-border rounded-lg p-6 bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-3 h-3 rounded-full ${
                !agentState?.sentinelPaused ? "bg-green pulse-active" : "bg-gray-600"
              }`}
            />
            <h3 className="font-heading text-lg text-white">Liquidation Sentinel</h3>
          </div>
          <div className="space-y-3 text-sm">
            <StatRow
              label="Status"
              value={agentState?.sentinelPaused ? "Paused" : "Monitoring"}
              valueClass={agentState?.sentinelPaused ? "text-red" : "text-green"}
            />
            <StatRow
              label="Tracked Positions"
              value={String(agentState?.trackedPositions ?? 0)}
            />
            <StatRow label="Health Threshold" value="5.00%" />
          </div>
        </div>

        {/* SentimentOracle Card */}
        <div className="border border-border rounded-lg p-6 bg-surface">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-yellow-500 pulse-active" />
            <h3 className="font-heading text-lg text-white">SentimentOracle</h3>
            <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded">
              3 Agents
            </span>
          </div>
          <div className="space-y-3 text-sm">
            <StatRow
              label="API Price (CoinGecko)"
              value={agentState?.apiPrice ? `$${agentState.apiPrice.toLocaleString()}` : "—"}
              valueClass="text-cyan"
            />
            <StatRow
              label="Website Price (CoinDesk)"
              value={
                agentState?.websitePrice
                  ? `$${agentState.websitePrice.toLocaleString()}`
                  : "—"
              }
              valueClass="text-yellow-400"
            />
            <StatRow
              label="Consensus Price"
              value={
                agentState?.consensusPrice
                  ? `$${agentState.consensusPrice.toLocaleString()}`
                  : "—"
              }
              valueClass="text-green"
            />
            <StatRow label="Sentiment" value={agentState?.sentiment ?? "—"} />
            <StatRow
              label="Volatility (0-100)"
              value={agentState?.volatilityScore != null ? String(agentState.volatilityScore) : "—"}
            />
            <StatRow
              label="Last Updated"
              value={
                agentState?.lastUpdated
                  ? new Date(agentState.lastUpdated * 1000).toLocaleString()
                  : "—"
              }
              valueClass="text-gray-500"
            />
          </div>
        </div>
      </div>

      {/* Zero Keeper Proof */}
      <div className="mt-8 border border-cyan/20 rounded-lg p-6 bg-cyan-dim/5">
        <h4 className="font-heading text-sm text-cyan mb-2">ZERO KEEPER PROOF</h4>
        <p className="text-sm text-gray-400 leading-relaxed">
          No off-chain script, cron job, or Chainlink Automation node is used in the
          matching or liquidation pipeline. All three agents operate entirely on-chain via
          Somnia's reactive execution layer — events trigger contract calls within the same
          block.
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