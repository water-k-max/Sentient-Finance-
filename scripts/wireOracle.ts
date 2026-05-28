import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const REGISTRY = "0xAb3b04A51f052c817969EF28DeF409FAF9544756";
  const AGENT_INTERFACE = "0x517Df8d1A94588eBb504CB864DD9B6d9d1c5A499";
  const ASSET = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  console.log("Redeploying SomniaPriceOracle (fixed event layout)...\n");

  // Deploy new SomniaPriceOracle
  const Oracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = await Oracle.deploy(REGISTRY);
  await oracle.waitForDeployment();
  console.log(`✅ SomniaPriceOracle: ${await oracle.getAddress()}`);

  // Deploy new CompositeOracle
  const CompositeOracle = await ethers.getContractFactory("CompositeOracle");
  const composite = await CompositeOracle.deploy(await oracle.getAddress(), ASSET);
  await composite.waitForDeployment();
  console.log(`✅ CompositeOracle: ${await composite.getAddress()}`);

  // Subscribe AgentInterface to SomniaPriceOracle PriceUpdated events
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const ai = AgentInterface.attach(AGENT_INTERFACE);
  const PRICE_UPDATED_TOPIC = await ai.PRICE_UPDATED_TOPIC();
  await ai.subscribe(await oracle.getAddress(), PRICE_UPDATED_TOPIC);
  console.log("✅ AgentInterface subscribed to SomniaPriceOracle");

  // Post a keeper price — should trigger reactive cascade
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const data = (await resp.json()) as { bitcoin: { usd: number } };
  const price = BigInt(Math.floor(data.bitcoin.usd * 1e18));

  console.log(`\nPosting keeper price: $${data.bitcoin.usd.toLocaleString()}...`);
  const tx = await oracle.connect(deployer).postPrice(ASSET, price);
  const receipt = await tx.wait();

  console.log(`✅ Posted — tx: ${tx.hash}`);

  // Check if PriceUpdated was emitted (reactive cascade fired)
  const priceEvent = receipt?.logs.find(
    (l: any) => l.fragment?.name === "PriceUpdated"
  );
  if (priceEvent) {
    console.log("✅ PriceUpdated event emitted → reactive cascade fired!");
  } else {
    console.log("⚠️  No PriceUpdated event found in receipt");
  }

  console.log(`\nUpdate frontend/src/config/addresses.ts:`);
  console.log(`  somniaPriceOracle: "${await oracle.getAddress()}"`);
  console.log(`  compositeOracle: "${await composite.getAddress()}"`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });