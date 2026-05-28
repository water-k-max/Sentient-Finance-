import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const REGISTRY = "0xAb3b04A51f052c817969EF28DeF409FAF9544756";
  const ASSET = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  const Oracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = await Oracle.deploy(REGISTRY);
  await oracle.waitForDeployment();
  console.log(`SomniaPriceOracle: ${await oracle.getAddress()}`);

  const CompositeOracle = await ethers.getContractFactory("CompositeOracle");
  const composite = await CompositeOracle.deploy(
    await oracle.getAddress(),
    ASSET
  );
  await composite.waitForDeployment();
  console.log(`CompositeOracle: ${await composite.getAddress()}`);

  // Post price as keeper (1 keeper = median accepted for demo)
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const data = (await resp.json()) as { bitcoin: { usd: number } };
  const priceFloat = data.bitcoin.usd;
  const price = BigInt(Math.floor(priceFloat * 1e18));

  console.log(`BTC: $${priceFloat.toLocaleString()}`);
  await (await oracle.connect(deployer).postPrice(ASSET, price)).wait();
  console.log("✅ Keeper median accepted");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });