import { ethers } from "hardhat";

const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
const AGENT_INTERFACE = "0x517Df8d1A94588eBb504CB864DD9B6d9d1c5A499";

async function main() {
  const [deployer] = await ethers.getSigners();
  const ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  console.log("Redeploying AgentOracle + SentimentOracle with Threshold (2/3) consensus...\n");

  const AgentOracle = await ethers.getContractFactory("AgentOracle");
  const agentOracle = await AgentOracle.deploy(PLATFORM, ASSET_ID);
  await agentOracle.waitForDeployment();
  console.log(`✅ AgentOracle: ${await agentOracle.getAddress()}`);

  const SentimentOracleFactory = await ethers.getContractFactory("SentimentOracle");
  const sentimentOracle = await SentimentOracleFactory.deploy(PLATFORM);
  await sentimentOracle.waitForDeployment();
  console.log(`✅ SentimentOracle: ${await sentimentOracle.getAddress()}`);

  // Subscribe new AgentOracle to AgentInterface
  const AgentInterface = await ethers.getContractFactory("AgentInterface");
  const agentInterface = AgentInterface.attach(AGENT_INTERFACE);
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
  await agentInterface.subscribe(await agentOracle.getAddress(), PRICE_UPDATED_TOPIC);
  console.log("✅ AgentOracle subscribed to AgentInterface");

  console.log("\nUpdate frontend/src/config/addresses.ts with:");
  console.log(`  agentOracle: "${await agentOracle.getAddress()}"`);
  console.log(`  sentimentOracle: "${await sentimentOracle.getAddress()}"`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });