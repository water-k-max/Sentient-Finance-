import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getAgentContracts, getProvider, getSentimentOracleWithSigner } from "../lib/contracts";
import { useWallet } from "../hooks/useWallet";

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
  apiPrice: number | null;
  websitePrice: number | null;
  sentiment: string;
  volatilityScore: number;
  consensusPrice: number | null;
  lastUpdated: number;
}

interface DepositInfo {
  jsonApi: bigint;
  llmParseWebsite: bigint;
  llmInference: bigint;
}

export default function AgentDashboard() {
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [deposits, setDeposits] = useState<DepositInfo | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { signer, connected } = useWallet();

  // Tick every 1s for elapsed-time counters on awaiting cards
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = (since: number) => {
    if (!since) return 0;
    return Math.floor((now / 1000 - since));
  };

  const pendingStr = (since: number, label: string) => {
    const secs = elapsed(since);
    if (secs === 0) return `⏳ ${label} (waiting for callback...)`;
    return `⏳ ${label} (${secs}s — expected 30-120s for Somnia agent callback)`;
  };

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
          // Sanity cap: reject raw uint256 > 1e15 (~$10M in 1e8 units).
          // The Somnia validator sometimes writes garbage (e.g. 5.57e31) instead
          // of the actual scaled price. Null keeps the UI in "⏳ pending" state.
          apiPrice: Number(apiPrice) > 1e15 ? null : Number(apiPrice) / 1e8,
          websitePrice: Number(websitePrice) > 1e15 ? null : Number(websitePrice) / 1e8,
          sentiment: sentiment || "—",
          volatilityScore: Number(volScore),
          consensusPrice: Number(consensusPrice) > 1e15 ? null : Number(consensusPrice) / 1e8,
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

  // Fetch deposit amounts
  useEffect(() => {
    const provider = getProvider();
    const { sentimentOracle } = getAgentContracts(provider);
    sentimentOracle.getDepositRequired().then((d: [bigint, bigint, bigint]) => {
      setDeposits({ jsonApi: d[0], llmParseWebsite: d[1], llmInference: d[2] });
    }).catch(() => {});
  }, []);

  const triggerAgent = async (fnName: string, ...args: unknown[]) => {
    if (!signer) return;
    setTriggering(fnName);
    try {
      const oracle = getSentimentOracleWithSigner(signer);
      const method = (oracle as any)[fnName];
      if (!method) throw new Error(`unknown function: ${fnName}`);

      let deposit: bigint;
      if (fnName === "requestApiPrice") deposit = deposits?.jsonApi ?? 0n;
      else if (fnName === "requestWebsitePrice") deposit = deposits?.llmParseWebsite ?? 0n;
      else deposit = deposits?.llmInference ?? 0n;

      const tx = await method(...args, { value: deposit });
      await tx.wait();
      setTriggering(null);
    } catch (e) {
      console.error(`trigger ${fnName} failed:`, e);
      setTriggering(null);
    }
  };

  const s = agentState;
  const divBps = (s?.apiPrice && s?.websitePrice)
    ? Math.abs((s.apiPrice - s.websitePrice) / s.apiPrice * 10000)
    : null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="font-heading text-2xl font-bold text-cyan mb-8 glow-text">
        SOMNIA AGENTS CASCADE
      </h2>

      {loading && <p className="text-gray-500 text-sm text-center py-12">Pulling live agent data from testnet...</p>}

      {/* === Agent 1: JSON API Agent (CoinGecko) === */}
      <div className="border border-cyan/20 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-cyan-dim text-cyan px-2 py-0.5 rounded font-mono">Agent 1</span>
          <h3 className="font-heading text-base text-white">🌐 JSON API Request — CoinGecko Price Feed</h3>
          <a href="https://agents.testnet.somnia.network/agents/13174292974160097713" target="_blank" className="text-xs text-gray-600 hover:text-cyan ml-auto">Agent Explorer ↗</a>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Somnia validators independently fetch the BTC/USD price from the CoinGecko API via
          <code className="text-cyan-dim"> fetchUint()</code>. Each validator's response is compared — if 3 of 3 match
          (Majority consensus), the price is accepted. The result arrives asynchronously via
          <code className="text-cyan-dim"> handleApiPrice()</code>.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Function Called" value="fetchUint(coingecko_url, 'bitcoin.usd', 8)" />
          <Step label="Consensus" value="Majority (3 of 3 validators)" />
          <Step label="CoinGecko Price" value={s?.apiPrice ? `$${s.apiPrice.toLocaleString()}` : pendingStr(s?.lastUpdated ?? 0, "CoinGecko callback")} highlight />
          <Step label="Deposit" value={deposits ? `${ethers.formatEther(deposits.jsonApi)} STT` : "—"} />
        </div>
        {connected && !s?.apiPrice && (
          <button
            onClick={() => triggerAgent("requestApiPrice")}
            disabled={triggering === "requestApiPrice"}
            className="mt-3 text-xs bg-cyan/10 text-cyan border border-cyan/30 px-3 py-1.5 rounded hover:bg-cyan/20 transition-colors disabled:opacity-30"
          >
            {triggering === "requestApiPrice" ? "Requesting..." : `Request CoinGecko Price (${deposits ? ethers.formatEther(deposits.jsonApi) : "?"} STT)`}
          </button>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ async callback ↓</span>
      </div>

      {/* === Agent 2: LLM Parse Website (CoinDesk) === */}
      <div className="border border-purple-500/20 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-mono">Agent 2</span>
          <h3 className="font-heading text-base text-white">📄 LLM Parse Website — CoinDesk Price Extraction</h3>
          <a href="https://agents.testnet.somnia.network/agents/12875401142070969085" target="_blank" className="text-xs text-gray-600 hover:text-cyan ml-auto">Agent Explorer ↗</a>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Instead of a direct API call, this agent visits the CoinDesk homepage and uses LLM vision
          to locate and extract the current BTC price from the page content. 3 validators independently
          parse the page and must agree on the extracted number (Threshold consensus, 2 of 3).
        </p>
        {!s?.websitePrice && (
          <div className="text-xs text-amber-400/70 bg-amber-400/5 border border-amber-400/20 rounded px-3 py-2 mb-3">
            ⏱️ LLM vision parse takes 800s+ to return on testnet — may not complete during a live demo.
            For the demo video, show Agent 1 only (direct API call) and reference Agent 2 as an architectural callout.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Function Called" value="extractANumber(coindesk_url, search_query, 8)" />
          <Step label="Consensus" value="Threshold (2 of 3 validators)" />
          <Step label="CoinDesk Price" value={s?.websitePrice ? `$${s.websitePrice.toLocaleString()}` : pendingStr(s?.lastUpdated ?? 0, "CoinDesk callback")} highlight />
          <Step label="Deposit" value={deposits ? `${ethers.formatEther(deposits.llmParseWebsite)} STT` : "—"} />
        </div>
        {connected && !s?.websitePrice && (
          <button
            onClick={() => triggerAgent("requestWebsitePrice")}
            disabled={triggering === "requestWebsitePrice"}
            className="mt-3 text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 px-3 py-1.5 rounded hover:bg-purple-500/20 transition-colors disabled:opacity-30"
          >
            {triggering === "requestWebsitePrice" ? "Requesting..." : `Request CoinDesk Price (${deposits ? ethers.formatEther(deposits.llmParseWebsite) : "?"} STT)`}
          </button>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ async callbacks ↓</span>
      </div>

      {/* === Consensus Engine === */}
      <div className="border border-cyan/30 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-cyan-dim text-cyan px-2 py-0.5 rounded font-mono">Consensus</span>
          <h3 className="font-heading text-base text-white">🤝 Price Consensus — Divergence Check</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Once both prices arrive, <code className="text-cyan-dim">_checkDivergence()</code> compares them.
          If they differ by less than the threshold (100 bps / 1%), the average is used.
          If divergence exceeds 1%, the lower price wins (conservative). The final
          <code className="text-cyan-dim"> consensusPrice</code> feeds into the LP agents.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="CoinGecko" value={s?.apiPrice ? `$${s.apiPrice.toLocaleString()}` : "—"} />
          <Step label="CoinDesk" value={s?.websitePrice ? `$${s.websitePrice.toLocaleString()}` : "—"} />
          <Step label="Divergence" value={divBps !== null ? `${divBps.toFixed(1)} bps` : "—"} highlight />
          <Step label="Consensus Price" value={s?.consensusPrice ? `$${s.consensusPrice.toLocaleString()}` : "—"} highlight />
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ data flows ↓</span>
      </div>

      {/* === Agent 3: LLM Inference — Sentiment + Volatility === */}
      <div className="border border-yellow-500/20 rounded-lg p-5 mb-4 bg-surface">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded font-mono">Agent 3</span>
          <h3 className="font-heading text-base text-white">🧠 LLM Inference — Sentiment Analysis + Volatility Scoring</h3>
          <a href="https://agents.testnet.somnia.network/agents/12847293847561029384" target="_blank" className="text-xs text-gray-600 hover:text-cyan ml-auto">Agent Explorer ↗</a>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Runs Qwen3-30B deterministically (temperature=0) across 3 validators for two independent tasks:
          <strong className="text-white"> sentiment analysis</strong> (bullish/bearish/neutral classification of
          a crypto headline) and <strong className="text-white">volatility scoring</strong> (0–100 from recent
          price history). All 3 validators produce byte-identical output — AI consensus via determinism.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Function (Sentiment)" value="inferString(prompt, 'bullish|bearish|neutral')" />
          <Step label="Function (Volatility)" value="inferNumber(prompt, 0, 100, temp=0)" />
          <Step label="Sentiment" value={s?.sentiment === "—" ? pendingStr(s?.lastUpdated ?? 0, "sentiment callback") : s?.sentiment ?? "—"} highlight sentiment />
          <Step label="Volatility Score" value={s?.volatilityScore != null ? `${s.volatilityScore}/100` : pendingStr(s?.lastUpdated ?? 0, "volatility callback")} highlight />
        </div>
        {connected && (
          <div className="flex gap-2 mt-3">
            {!s?.sentiment || s?.sentiment === "—" ? (
              <button
                onClick={() => triggerAgent("analyzeSentiment", "Bitcoin market shows strong momentum as institutional demand surges")}
                disabled={triggering === "analyzeSentiment"}
                className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded hover:bg-yellow-500/20 transition-colors disabled:opacity-30"
              >
                {triggering === "analyzeSentiment" ? "Requesting..." : `Analyze Sentiment (${deposits ? ethers.formatEther(deposits.llmInference) : "?"} STT)`}
              </button>
            ) : null}
            {!s?.volatilityScore ? (
              <button
                onClick={() => triggerAgent("computeVolatilityScore", "62000,61800,62200,61900,62100")}
                disabled={triggering === "computeVolatilityScore"}
                className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded hover:bg-yellow-500/20 transition-colors disabled:opacity-30"
              >
                {triggering === "computeVolatilityScore" ? "Requesting..." : `Score Volatility (${deposits ? ethers.formatEther(deposits.llmInference) : "?"} STT)`}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Arrow */}
      <div className="flex justify-center py-2">
        <span className="text-cyan-dim text-lg">↓ all data collected ↓</span>
      </div>

      {/* === Final Output: Enhanced LP Agent === */}
      <div className="border border-green/20 rounded-lg p-5 bg-surface ring-1 ring-green/10">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs bg-green/10 text-green px-2 py-0.5 rounded font-mono">Output</span>
          <h3 className="font-heading text-base text-white">📊 AI-Augmented LP Agent — Takes Action</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          The <strong>contract takes action with all data returned by the three agents</strong>.
          Spread adjusts dynamically using the formula:<br />
          <code className="text-cyan-dim">effectiveSpread = baseSpread × (1 + volatilityScore/100) × sentimentMultiplier</code>
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Step label="Index Price (consensus)" value={s?.consensusPrice ? `$${s.consensusPrice.toLocaleString()}` : "—"} highlight />
          <Step label="Base Spread" value={`${(s?.enhancedLpSpreadBps ?? 0) / 100}%`} />
          <Step
            label="Sentiment Input"
            value={s?.sentiment === "—" ? "—" : `${s?.sentiment ?? "—"} → ${s?.enhancedLpSentimentMultiplier ?? 0}bps multiplier`}
            highlight
          />
          <Step label="Volatility Input" value={s?.enhancedLpVolatilityScore != null ? `${s.enhancedLpVolatilityScore}/100` : "—"} />
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
            <StatRow label="JSON API (CoinGecko)" value={s?.apiPrice ? "✅ Responded" : pendingStr(s?.lastUpdated ?? 0, "Pending")} />
            <StatRow label="LLM Parse (CoinDesk)" value={s?.websitePrice ? "✅ Responded" : pendingStr(s?.lastUpdated ?? 0, "Pending")} />
            <StatRow label="LLM Inference (Sentiment)" value={s?.sentiment !== "—" ? "✅ Responded" : pendingStr(s?.lastUpdated ?? 0, "Pending")} />
            <StatRow label="LLM Inference (Volatility)" value={s?.volatilityScore != null ? "✅ Responded" : pendingStr(s?.lastUpdated ?? 0, "Pending")} />
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
          All three Somnia Agents operate via async callbacks — when an agent returns data,
          <code className="text-cyan-dim"> handleResponse()</code> stores it on-chain, and the
          reactive cascade fires (PnL → Sentinel → LP rebalance) within the same block.
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
