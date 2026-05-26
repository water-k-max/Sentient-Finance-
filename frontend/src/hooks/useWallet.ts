import { useState, useEffect, useCallback } from "react";
import { ethers, BrowserProvider, JsonRpcSigner } from "ethers";
import { SOMNIA_CHAIN_ID } from "../config/addresses";

interface WalletState {
  address: string | null;
  signer: JsonRpcSigner | null;
  provider: BrowserProvider | null;
  connected: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);

  const checkNetwork = useCallback(async (prov: BrowserProvider) => {
    const network = await prov.getNetwork();
    setWrongNetwork(Number(network.chainId) !== SOMNIA_CHAIN_ID);
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask or another Web3 wallet");
      return;
    }

    try {
      const prov = new ethers.BrowserProvider(window.ethereum);
      const accounts = (await prov.send("eth_requestAccounts", [])) as string[];

      if (accounts.length > 0) {
        const s = await prov.getSigner();
        setProvider(prov);
        setSigner(s);
        setAddress(accounts[0]);
        setConnected(true);
        await checkNetwork(prov);
      }
    } catch (e) {
      console.error("Failed to connect wallet:", e);
    }
  }, [checkNetwork]);

  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setConnected(false);
    setWrongNetwork(false);
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        setAddress(accounts[0]);
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    const ethereum = window.ethereum as any;
    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [disconnect]);

  return { address, signer, provider, connected, wrongNetwork, connect, disconnect };
}
