import { ethers } from "hardhat";

const ORACLE = "0x5175AA5bd8DC3981346c22949faCf40Ae2479163";
const ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

async function main() {
  const [keeper] = await ethers.getSigners();

  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const data = (await resp.json()) as { bitcoin: { usd: number } };
  const priceFloat = data.bitcoin.usd;
  const price = BigInt(Math.floor(priceFloat * 1e18));

  console.log(`BTC: $${priceFloat.toLocaleString()} → ${price.toString()}`);

  const Oracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = Oracle.attach(ORACLE);
  const tx = await oracle.connect(keeper).postPrice(ASSET_ID, price);
  await tx.wait();
  console.log(`✅ Posted → tx: ${tx.hash}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });