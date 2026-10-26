import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../config/addresses";
import { ABIS } from "../lib/contracts";

interface WalletState {
  address: string | null;
  chainId: number | null;
  connected: boolean;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
}

interface ContractInstances {
  marginVault: ethers.Contract;
  orderBook: ethers.Contract;
  oracleAdapter: ethers.Contract;
  mockUSDC: ethers.Contract;
  liquidationSentinel: ethers.Contract;
  lpAgent: ethers.Contract;
  agentInterface: ethers.Contract;
  sentimentOracle: ethers.Contract | null;
  perpEngine: ethers.Contract;
}

interface ContractsContextValue {
  wallet: WalletState;
  contracts: ContractInstances | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  isLoading: boolean;
  error: string | null;
}

const SOMNIA_CHAIN_ID = 50312;
// F-14 FIX: was hardcoded "0xC478" (== 50296, the wrong network), so
// wallet_switchEthereumChain / wallet_addEthereumChain targeted a chain that
// isn't Somnia testnet. Derive the hex from the id so they can never diverge.
const SOMNIA_CHAIN_HEX = "0x" + SOMNIA_CHAIN_ID.toString(16); // 50312 -> 0xc488
const SOMNIA_CHAIN_PARAMS = {
  chainId: SOMNIA_CHAIN_HEX,
  chainName: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: ["https://dream-rpc.somnia.network"],
  blockExplorerUrls: ["https://somnia-testnet.socialscan.io"],
};

const ContractsContext = createContext<ContractsContextValue | null>(null);

export function ContractsProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    address: null, chainId: null, connected: false, provider: null, signer: null,
  });
  const [contracts, setContracts] = useState<ContractInstances | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<ethers.BrowserProvider | null>(null);

  const initContracts = useCallback(
    (signer: ethers.JsonRpcSigner): ContractInstances => {
      const c = (addr: string, abi: any[]) => new ethers.Contract(addr, abi, signer);
      return {
        marginVault: c(CONTRACT_ADDRESSES.marginVault, ABIS.marginVault),
        orderBook: c(CONTRACT_ADDRESSES.orderBooks["BTC-USD"] as string, ABIS.orderBook),
        oracleAdapter: c(CONTRACT_ADDRESSES.oracleAdapter, ABIS.oracleAdapter),
        mockUSDC: c(CONTRACT_ADDRESSES.mockUSDC, ABIS.mockUSDC),
        liquidationSentinel: c(CONTRACT_ADDRESSES.liquidationSentinel, ABIS.liquidationSentinel),
        lpAgent: c(CONTRACT_ADDRESSES.liquidityProviderAgent, ABIS.lpAgent),
        agentInterface: c(CONTRACT_ADDRESSES.agentInterface, ABIS.agentInterface),
        sentimentOracle: CONTRACT_ADDRESSES.sentimentOracle !== ethers.ZeroAddress
          ? c(CONTRACT_ADDRESSES.sentimentOracle, ABIS.sentimentOracle)
          : null,
        perpEngine: c(CONTRACT_ADDRESSES.perpEngine, ABIS.perpEngine),
      };
    },
    []
  );

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setError("No wallet detected. Install MetaMask.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const provider = new ethers.BrowserProvider(eth);
      providerRef.current = provider;

      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);

      if (chainId !== SOMNIA_CHAIN_ID) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SOMNIA_CHAIN_HEX }],
          });
        } catch (switchErr: any) {
          if (switchErr.code === 4902) {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [SOMNIA_CHAIN_PARAMS],
            });
          }
        }
        const newNetwork = await provider.getNetwork();
        if (Number(newNetwork.chainId) !== SOMNIA_CHAIN_ID) {
          throw new Error("Please switch to Somnia Testnet");
        }
      }

      const instances = initContracts(signer);
      setWallet({ address, chainId: SOMNIA_CHAIN_ID, connected: true, provider, signer });
      setContracts(instances);
    } catch (e: any) {
      setError(e?.message || "Connection failed");
    } finally {
      setIsLoading(false);
    }
  }, [initContracts]);

  const disconnect = useCallback(() => {
    setWallet({ address: null, chainId: null, connected: false, provider: null, signer: null });
    setContracts(null);
    providerRef.current = null;
  }, []);

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect();
      } else if (wallet.signer) {
        connect();
      }
    };

    const handleChainChanged = () => {
      if (wallet.connected) connect();
    };

    eth.on("accountsChanged", handleAccountsChanged);
    eth.on("chainChanged", handleChainChanged);

    return () => {
      eth.removeListener("accountsChanged", handleAccountsChanged);
      eth.removeListener("chainChanged", handleChainChanged);
    };
  }, [wallet.connected, wallet.signer, connect, disconnect]);

  useEffect(() => {
    const wasConnected = localStorage.getItem("sf_wallet_connected");
    if (wasConnected === "true" && (window as any).ethereum) {
      connect();
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    localStorage.setItem("sf_wallet_connected", wallet.connected ? "true" : "false");
  }, [wallet.connected]);

  return (
    <ContractsContext.Provider value={{ wallet, contracts, connect, disconnect, isLoading, error }}>
      {children}
    </ContractsContext.Provider>
  );
}

export function useContracts() {
  const ctx = useContext(ContractsContext);
  if (!ctx) throw new Error("useContracts must be used inside <ContractsProvider>");
  return ctx;
}

export function useWalletAddress() {
  return useContracts().wallet.address;
}

export function useIsConnected() {
  return useContracts().wallet.connected;
}
