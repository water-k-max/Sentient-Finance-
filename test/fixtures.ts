import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  OrderBook,
  MarginVault,
  PerpEngine,
  OracleAdapter,
  MockPriceFeed,
  AgentInterface,
  LiquidationSentinel,
  LiquidityProviderAgent,
} from "../typechain-types";

export const PRICE_SCALE = 10n ** 8n;
export const SIZE_SCALE = 10n ** 18n;
export const BTC_USD_ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));
export const INITIAL_BTC_PRICE = 50000n * PRICE_SCALE;

export interface DeployedContracts {
  mockPriceFeed: MockPriceFeed;
  oracleAdapter: OracleAdapter;
  marginVault: MarginVault;
  orderBook: OrderBook;
  perpEngine: PerpEngine;
  sentinel: LiquidationSentinel;
  lpAgent: LiquidityProviderAgent;
  agentInterface: AgentInterface;
}

export interface Signers {
  owner: HardhatEthersSigner;
  trader1: HardhatEthersSigner;
  trader2: HardhatEthersSigner;
  trader3: HardhatEthersSigner;
}

/**
 * Deploy all core contracts in dependency order.
 */
export async function deployContracts(): Promise<DeployedContracts> {
  const mockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
  const mockPriceFeed = await mockPriceFeedFactory.deploy(INITIAL_BTC_PRICE);
  await mockPriceFeed.waitForDeployment();

  const oracleAdapterFactory = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await oracleAdapterFactory.deploy(
    await mockPriceFeed.getAddress(),
    BTC_USD_ASSET_ID
  );
  await oracleAdapter.waitForDeployment();

  const marginVaultFactory = await ethers.getContractFactory("MarginVault");
  const marginVault = await marginVaultFactory.deploy();
  await marginVault.waitForDeployment();

  const orderBookFactory = await ethers.getContractFactory("OrderBook");
  const orderBook = await orderBookFactory.deploy(await marginVault.getAddress());
  await orderBook.waitForDeployment();

  const perpEngineFactory = await ethers.getContractFactory("PerpEngine");
  const perpEngine = await perpEngineFactory.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress()
  );
  await perpEngine.waitForDeployment();

  const sentinelFactory = await ethers.getContractFactory("LiquidationSentinel");
  const sentinel = await sentinelFactory.deploy(await marginVault.getAddress());
  await sentinel.waitForDeployment();

  const lpAgentFactory = await ethers.getContractFactory("LiquidityProviderAgent");
  const lpAgent = await lpAgentFactory.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress()
  );
  await lpAgent.waitForDeployment();

  const agentInterfaceFactory = await ethers.getContractFactory("AgentInterface");
  const agentInterface = await agentInterfaceFactory.deploy(
    await orderBook.getAddress(),
    await marginVault.getAddress(),
    await sentinel.getAddress(),
    await lpAgent.getAddress(),
    await oracleAdapter.getAddress()
  );
  await agentInterface.waitForDeployment();

  // Wire permissions
  await marginVault.setAuthorized(await orderBook.getAddress(), true);
  await marginVault.setAuthorized(await sentinel.getAddress(), true);

  // Subscribe reactive hooks
  const ORDER_PLACED_TOPIC = await agentInterface.ORDER_PLACED_TOPIC();
  const PRICE_UPDATED_TOPIC = await agentInterface.PRICE_UPDATED_TOPIC();
  await agentInterface.subscribe(await orderBook.getAddress(), ORDER_PLACED_TOPIC);
  await agentInterface.subscribe(await oracleAdapter.getAddress(), PRICE_UPDATED_TOPIC);

  return {
    mockPriceFeed,
    oracleAdapter,
    marginVault,
    orderBook,
    perpEngine,
    sentinel,
    lpAgent,
    agentInterface,
  };
}

/**
 * Get standard test signers with pre-funded accounts.
 */
export async function getSigners(): Promise<Signers> {
  const [owner, trader1, trader2, trader3] = await ethers.getSigners();
  return { owner, trader1: trader1 as HardhatEthersSigner, trader2: trader2 as HardhatEthersSigner, trader3: trader3 as HardhatEthersSigner };
}

/**
 * Fund a trader with USDC collateral in the MarginVault.
 */
export async function fundTrader(
  marginVault: MarginVault,
  trader: HardhatEthersSigner,
  amount: bigint
): Promise<void> {
  await marginVault.connect(trader).deposit(amount);
}
