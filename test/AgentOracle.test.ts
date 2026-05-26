import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentOracle } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentOracle", function () {
  let agentOracle: AgentOracle;
  let owner: HardhatEthersSigner;

  const BTC_PRICE = 50000n * 10n ** 8n; // $50,000 with 8 decimals
  const ASSET_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));

  // Somnia testnet platform address (dummy for local testing)
  const DUMMY_PLATFORM = "0x0000000000000000000000000000000000000001";

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    // We can't deploy AgentOracle without a real Somnia platform contract
    // So we test the view functions and the structure
    const AgentOracleFactory = await ethers.getContractFactory("AgentOracle");

    // For local testing, we deploy with a dummy platform address
    // The constructor doesn't validate the platform address
    agentOracle = await AgentOracleFactory.deploy(DUMMY_PLATFORM, ASSET_ID);
    await agentOracle.waitForDeployment();
  });

  describe("deployment", function () {
    it("should set owner correctly", async function () {
      expect(await agentOracle.owner()).to.equal(await owner.getAddress());
    });

    it("should set assetId correctly", async function () {
      expect(await agentOracle.assetId()).to.equal(ASSET_ID);
    });

    it("should have zero initial price", async function () {
      expect(await agentOracle.latestPrice()).to.equal(0);
    });

    it("should have correct agent ID constant", async function () {
      // JSON API Agent ID: 13174292974160097713
      expect(await agentOracle.JSON_API_AGENT_ID()).to.equal(13174292974160097713n);
    });

    it("should have correct price per agent", async function () {
      expect(await agentOracle.PRICE_PER_AGENT()).to.equal(ethers.parseEther("0.03"));
    });

    it("should have correct subcommittee size", async function () {
      expect(await agentOracle.SUBCOMMITTEE_SIZE()).to.equal(3);
    });
  });

  describe("constants", function () {
    it("should have correct CoinGecko URL", async function () {
      const url = await agentOracle.COINGECKO_URL();
      expect(url).to.include("coingecko.com");
      expect(url).to.include("bitcoin");
    });

    it("should have correct CoinGecko selector", async function () {
      expect(await agentOracle.COINGECKO_SELECTOR()).to.equal("bitcoin.usd");
    });

    it("should have correct decimals", async function () {
      expect(await agentOracle.COINGECKO_DECIMALS()).to.equal(8);
    });
  });

  describe("getIndexPrice", function () {
    it("should return 0 before any price update", async function () {
      expect(await agentOracle.getIndexPrice(ASSET_ID)).to.equal(0);
    });
  });
});
