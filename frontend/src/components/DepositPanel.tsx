import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../config/addresses";
import { getMockUSDCWithSigner, getVaultWithSigner } from "../lib/contracts";

export default function DepositPanel({ signer }: { signer: ethers.Signer | null }) {
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signer) return;
    const addr = await signer.getAddress();
    const usdc = getMockUSDCWithSigner(signer);
    const vault = getVaultWithSigner(signer);
    const [rawUsdc, rawVault] = await Promise.all([
      usdc.balanceOf(addr) as Promise<bigint>,
      vault.getCollateralBalance?.(addr).catch(() => 0n) as Promise<bigint>,
    ]);
    setUsdcBalance(Number(rawUsdc) / 1e6);
    setVaultBalance(Number(rawVault) / 1e6);
  }, [signer]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleDeposit = async () => {
    if (!signer || !amount) return;
    setStatus("pending");
    try {
      const amt = ethers.parseUnits(amount, 6);
      const usdc = getMockUSDCWithSigner(signer);
      const vault = getVaultWithSigner(signer);
      const vaultAddr = CONTRACT_ADDRESSES.marginVault;

      await (await usdc.approve(vaultAddr, amt)).wait();
      await (await vault.deposit(amt)).wait();
      setStatus("confirmed");
      refresh();
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const handleMint = async () => {
    if (!signer || !amount) return;
    setStatus("pending");
    try {
      const amt = ethers.parseUnits(amount, 6);
      const addr = await signer.getAddress();
      const usdc = getMockUSDCWithSigner(signer);
      await (await usdc.mint(addr, amt)).wait();
      setStatus("minted");
      refresh();
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus(null), 5000);
    }
  };

  return (
    <div className="border-t border-border p-4">
      <div className="text-xs text-gray-400 mb-2 font-heading">COLLATERAL</div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">Wallet USDC</span>
        <span className="text-white">{usdcBalance.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-xs mb-3">
        <span className="text-gray-500">Vault Balance</span>
        <span className="text-cyan">{vaultBalance.toFixed(2)}</span>
      </div>

      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (USDC)"
        className="w-full bg-surface border border-border rounded px-3 py-1.5 text-xs text-white focus:border-cyan outline-none mb-2"
      />

      <div className="flex gap-2">
        <button
          onClick={handleDeposit}
          disabled={!signer || !amount}
          className="flex-1 text-xs bg-cyan/10 text-cyan border border-cyan/30 py-1.5 rounded hover:bg-cyan/20 transition-colors disabled:opacity-30"
        >
          Deposit
        </button>
        <button
          onClick={handleMint}
          disabled={!signer || !amount}
          className="flex-1 text-xs bg-green/10 text-green border border-green/30 py-1.5 rounded hover:bg-green/20 transition-colors disabled:opacity-30"
        >
          Mint USDC
        </button>
      </div>

      {status === "pending" && <p className="text-xs text-yellow-400 mt-1">Confirming...</p>}
      {status === "confirmed" && <p className="text-xs text-green mt-1">Deposited</p>}
      {status === "minted" && <p className="text-xs text-green mt-1">Minted</p>}
      {status === "failed" && <p className="text-xs text-red mt-1">Failed</p>}
    </div>
  );
}
