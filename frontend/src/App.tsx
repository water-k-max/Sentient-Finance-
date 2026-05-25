import { useState } from "react";
import TradingView from "./pages/TradingView";
import AgentDashboard from "./pages/AgentDashboard";
import Stats from "./pages/Stats";

type Page = "trade" | "agents" | "stats";

export default function App() {
  const [page, setPage] = useState<Page>("trade");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="font-heading text-xl font-bold text-cyan glow-text">
            SENTIENT FINANCE
          </h1>
          <nav className="flex gap-4 text-sm">
            {(["trade", "agents", "stats"] as Page[]).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1 rounded transition-colors ${
                  page === p
                    ? "bg-cyan-dim text-cyan border border-cyan/30"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {p === "trade" ? "Trading" : p === "agents" ? "Agents" : "Stats"}
              </button>
            ))}
          </nav>
        </div>
        <WalletButton />
      </header>

      {/* Content */}
      <main className="flex-1">
        {page === "trade" && <TradingView />}
        {page === "agents" && <AgentDashboard />}
        {page === "stats" && <Stats />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-2 text-xs text-gray-600 flex justify-between">
        <span>Sentient Finance v0.1 — Somnia Agentathon 2026</span>
        <span>Built on Somnia L1 — Keeper-free, Agent-native</span>
      </footer>
    </div>
  );
}

function WalletButton() {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");

  const connect = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask or another Web3 wallet");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAddress(accounts[0]);
      setConnected(true);
    } catch (e) {
      console.error(e);
    }
  };

  if (connected) {
    return (
      <div className="text-sm text-cyan border border-cyan/30 px-3 py-1 rounded">
        {address.slice(0, 6)}...{address.slice(-4)}
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="text-sm bg-cyan/10 text-cyan border border-cyan/30 px-4 py-2 rounded hover:bg-cyan/20 transition-colors"
    >
      Connect Wallet
    </button>
  );
}
