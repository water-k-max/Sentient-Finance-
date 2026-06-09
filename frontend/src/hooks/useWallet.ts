import { useContracts } from "../context/ContractsContext";

export function useWallet() {
  const { wallet, connect, disconnect, isLoading, error } = useContracts();
  return {
    address: wallet.address,
    signer: wallet.signer,
    provider: wallet.provider,
    connected: wallet.connected,
    wrongNetwork: wallet.connected && wallet.chainId !== 50312,
    connect,
    disconnect,
    isLoading,
    error,
  };
}
