import { useWallet } from "../hooks/useWallet";
import { SOMNIA_CHAIN_ID } from "../config/addresses";

export default function WalletButton() {
  const { address, connected, wrongNetwork, connect, disconnect } = useWallet();

  const switchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      await (window.ethereum as any).request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + SOMNIA_CHAIN_ID.toString(16) }],
      });
    } catch (e: any) {
      if (e.code === 4902) {
        await (window.ethereum as any).request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x" + SOMNIA_CHAIN_ID.toString(16),
            chainName: "Somnia Testnet",
            rpcUrls: ["https://dream-rpc.somnia.network"],
            nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
          }],
        });
      }
    }
  };

  if (wrongNetwork) {
    return (
      <button
        onClick={switchNetwork}
        className="text-xs bg-red/10 text-red border border-red/30 px-3 py-1.5 rounded hover:bg-red/20 transition-colors"
      >
        Switch to Somnia
      </button>
    );
  }

  if (connected && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-cyan border border-cyan/30 px-3 py-1 rounded">
          <span className="w-1.5 h-1.5 bg-green rounded-full" />
          {address.slice(0, 6)}...{address.slice(-4)}
        </div>
        <button
          onClick={disconnect}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Disconnect
        </button>
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
