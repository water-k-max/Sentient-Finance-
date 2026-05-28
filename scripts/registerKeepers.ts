import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const BOND = ethers.parseEther("0.1");

  // Deploy KeeperRegistry
  const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
  const registry = await KeeperRegistry.deploy();
  await registry.waitForDeployment();
  console.log(`KeeperRegistry: ${await registry.getAddress()}`);
  await registry.addKeeper(deployer.address, { value: BOND });
  console.log("Keeper:", deployer.address);

  console.log(`Keeper 3: ${deployer.address}`);

  // Deploy SomniaPriceOracle
  const Oracle = await ethers.getContractFactory("SomniaPriceOracle");
  const oracle = await Oracle.deploy(await registry.getAddress());
  await oracle.waitForDeployment();
  console.log(`SomniaPriceOracle: ${await oracle.getAddress()}`);

  // Deploy CompositeOracle for BTC-USD
  const btcAssetId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));
  const CompositeOracle = await ethers.getContractFactory("CompositeOracle");
  const composite = await CompositeOracle.deploy(await oracle.getAddress(), btcAssetId);
  await composite.waitForDeployment();
  console.log(`CompositeOracle: ${await composite.getAddress()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });