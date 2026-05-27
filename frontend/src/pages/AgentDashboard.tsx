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
      } catch (e) {
        console.error("Failed to fetch agent data:", e);
        if (!cancelled) setLoading(false);
      }
    };

    fetchAgentData();
    const interval = setInterval(fetchAgentData, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const s = agentState;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        SOMNIA AGENTS CASCADE
      </h2>

      {loading && <p className="text-gray-500 text-sm text-center py-12">Pulling live agent data from testnet...</p>}

      {/* === Agent 1: JSON API Agent === */}
      <div className="border border-cyan/20 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-cyan-dim text-cyan px-2 py-0.5 rounded font-mono">Agent 1</span>
          <h3 className="font-heading text-base text-white">🌐 JSON API Request — CoinGecko Price Feed</h3>
          <a href="https://agents.testnet.somnia.network/agents/13174292974160097713" target="_blank" className="text-xs text-gray-600 hover:text-cyan ml-auto">Agent Explorer ↗</a>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Somnia validators independently fetch the BTC/USD price from the CoinGecko API.
          Each validator's response is compared — if 3 of 3 match (Majority consensus), the price is accepted.
          The result arrives asynchronously via <code className="text-cyan-dim">handleResponse()</code> callback.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Function Called" value="fetchUint(coingecko_url, 'bitcoin.usd', 8)" />
          <Step label="Consensus" value="Majority (3 of 3 validators must agree)" />
          <Step label="Result" value={s?.apiPrice ? `$${s.apiPrice.toLocaleString()}` : "⏳ Awaiting callback..."} highlight />
          <Step label="Deposit Cost" value="0.09 STT (π×3) + 0.03 reserve = 0.12 STT" />
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ async callback ↓</span>
      </div>

      {/* === Agent 2: LLM Inference — Sentiment === */}
      <div className="border border-yellow-500/20 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded font-mono">Agent 2</span>
          <h3 className="font-heading text-base text-white">🧠 LLM Inference — Sentiment Analysis</h3>
          <a href="https://agents.testnet.somnia.network/agents/12847293847561029384" target="_blank" className="text-xs text-gray-600 hover:text-cyan ml-auto">Agent Explorer ↗</a>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Runs Qwen3-30B deterministically (temperature=0) across 3 validators.
          Classifies a crypto news headline as bullish, bearish, or neutral.
          All 3 validators independently produce <em>byte-identical</em> output — that's how consensus on AI is possible.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Function Called" value="inferString(prompt, 'bullish|bearish|neutral')" />
          <Step label="Consensus" value="Majority (deterministic, temp=0)" />
          <Step label="Result" value={s?.sentiment === "—" ? "⏳ Awaiting callback..." : s?.sentiment ?? "—"} highlight sentiment />
          <Step label="Deposit Cost" value="0.21 STT (π×3) + 0.03 reserve = 0.24 STT" />
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ async callback ↓</span>
      </div>

      {/* === Final Output: Enhanced LP Agent === */}
      <div className="border border-green/20 rounded-lg p-5 bg-surface ring-1 ring-green/10">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-green/10 text-green px-2 py-0.5 rounded font-mono">Output</span>
          <h3 className="font-heading text-base text-white">📊 AI-Augmented LP Agent — Takes Action</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          The <strong>contract takes action with the data returned by the agents</strong>.
          Spread adjusts dynamically: wider when bearish/volatile, tighter when bullish/stable.
          This is the core agentathon use case — smart contract behavior driven by decentralized AI output.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Base Spread" value={`${(s?.enhancedLpSpreadBps ?? 0) / 100}%`} />
          <Step
            label="Sentiment Input"
            value={s?.sentiment === "—" ? "—" : `${s?.sentiment ?? "—"} → ${s?.enhancedLpSentimentMultiplier ?? 0}bps multiplier`}
            highlight
          />
          <Step label="Volatility Input" value={s?.enhancedLpVolatilityScore != null ? String(s.enhancedLpVolatilityScore) : "—"} />
          <Step
            label="Effective Spread"
            value={`${(
              ((s?.enhancedLpSpreadBps ?? 0) * (1 + (s?.enhancedLpVolatilityScore ?? 0) / 100)) / 100
            ).toFixed(3)}%`}
            highlight
          />
        </div>
      </div>

      {/* Side cards: Sentinel + Stats */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="border border-border rounded-lg p-4 bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${!s?.sentinelPaused ? "bg-green" : "bg-gray-600"}`} />
            <span className="font-heading text-sm text-white">Liquidation Sentinel</span>
          </div>
          <div className="text-xs space-y-1">
            <StatRow label="Status" value={s?.sentinelPaused ? "Paused" : "Monitoring"} />
            <StatRow label="Tracked Positions" value={String(s?.trackedPositions ?? 0)} />
            <StatRow label="Threshold" value="5% margin health" />
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-heading text-sm text-white">Protocol Status</span>
          </div>
          <div className="text-xs space-y-1">
            <StatRow label="JSON API Agent" value={s?.apiPrice ? "✅ Responded" : "⏳ Pending"} />
            <StatRow label="LLM Inference" value={s?.sentiment !== "—" ? "✅ Responded" : "⏳ Pending"} />
            <StatRow label="LP Agent" value={s?.lpBidActive ? "✅ Active" : "❌ Idle"} />
            <StatRow label="Sentinel" value={s?.sentinelPaused ? "⏸️ Paused" : "✅ Monitoring"} />
          </div>
        </div>
      </div>

      {/* Zero Keeper */}
      <div className="mt-8 border border-cyan/20 rounded-lg p-5 bg-cyan-dim/5">
        <h4 className="font-heading text-sm text-cyan mb-2">ZERO KEEPER PROOF</h4>
        <p className="text-xs text-gray-400 leading-relaxed">
          No off-chain script, cron job, or Chainlink Automation node is used.
          All three Somnia Agents operate via async callbacks — when CoinGecko returns a price,
          <code className="text-cyan-dim"> handleResponse()</code> stores it on-chain, emits
          <code className="text-cyan-dim"> PriceUpdated</code>, and the reactive cascade fires
          (PnL → Sentinel → LP rebalance) — all within the same block.
        </p>
      </div>
    </div>
  );
}

function Step({
  label,
  value,
  highlight,
  sentiment: isSentiment,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  sentiment?: boolean;
}) {
  return (
    <div>
      <div className="text-gray-500 text-xs mb-0.5">{label}</div>
      <div className={`font-mono text-xs ${highlight ? (isSentiment ? (
        value.includes("bullish") ? "text-green" : value.includes("bearish") ? "text-red" : "text-cyan"
      ) : "text-cyan") : "text-gray-300"}`}>
        {value}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}