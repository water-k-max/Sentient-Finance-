import { expect } from "chai";
import { ethers } from "hardhat";
import { SentimentOracle } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SentimentOracle", function () {
  let sentimentOracle: SentimentOracle;
  let owner: HardhatEthersSigner;

  // Somnia testnet platform address (dummy for local testing)
  const DUMMY_PLATFORM = "0x0000000000000000000000000000000000000001";

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    const SentimentOracleFactory = await ethers.getContractFactory("SentimentOracle");
    sentimentOracle = await SentimentOracleFactory.deploy(DUMMY_PLATFORM);
    await sentimentOracle.waitForDeployment();
  });

  describe("deployment", function () {
    it("should set owner correctly", async function () {
      expect(await sentimentOracle.owner()).to.equal(await owner.getAddress());
    });

    it("should have correct JSON API agent ID", async function () {
      expect(await sentimentOracle.JSON_API_AGENT_ID()).to.equal(13174292974160097713n);
    });

    it("should have correct LLM Inference agent ID", async function () {
      expect(await sentimentOracle.LLM_INFERENCE_AGENT_ID()).to.equal(12847293847561029384n);
    });

    it("should have correct LLM Parse Website agent ID", async function () {
      expect(await sentimentOracle.LLM_PARSE_WEBSITE_AGENT_ID()).to.equal(12875401142070969085n);
    });

    it("should have correct agent prices", async function () {
      expect(await sentimentOracle.JSON_API_PRICE()).to.equal(ethers.parseEther("0.03"));
      expect(await sentimentOracle.LLM_INFERENCE_PRICE()).to.equal(ethers.parseEther("0.07"));
      expect(await sentimentOracle.LLM_PARSE_WEBSITE_PRICE()).to.equal(ethers.parseEther("0.10"));
    });

    it("should have correct subcommittee size", async function () {
      expect(await sentimentOracle.SUBCOMMITTEE_SIZE()).to.equal(3);
    });
  });

  describe("initial state", function () {
    it("should have zero prices before any agent calls", async function () {
      expect(await sentimentOracle.apiPrice()).to.equal(0);
      expect(await sentimentOracle.websitePrice()).to.equal(0);
      expect(await sentimentOracle.consensusPrice()).to.equal(0);
      expect(await sentimentOracle.volatilityScore()).to.equal(0);
    });

    it("should have empty sentiment before analysis", async function () {
      expect(await sentimentOracle.sentiment()).to.equal("");
    });

    it("should have default divergence threshold", async function () {
      expect(await sentimentOracle.divergenceThresholdBps()).to.equal(100);
    });
  });

  describe("CoinGecko configuration", function () {
    it("should have correct CoinGecko URL", async function () {
      const url = await sentimentOracle.COINGECKO_URL();
      expect(url).to.include("coingecko.com");
      expect(url).to.include("bitcoin");
    });

    it("should have correct CoinGecko selector", async function () {
      expect(await sentimentOracle.COINGECKO_SELECTOR()).to.equal("bitcoin.usd");
    });

    it("should have correct decimals", async function () {
      expect(await sentimentOracle.COINGECKO_DECIMALS()).to.equal(8);
    });
  });

  describe("CoinDesk configuration", function () {
    it("should have correct CoinDesk URL", async function () {
      const url = await sentimentOracle.COINDESK_URL();
      expect(url).to.include("coindesk.com");
    });

    it("should have correct search query", async function () {
      const query = await sentimentOracle.COINDESK_SEARCH_QUERY();
      expect(query).to.include("Bitcoin");
      expect(query).to.include("price");
    });
  });

  describe("divergence threshold", function () {
    it("should allow owner to set threshold", async function () {
      await sentimentOracle.setDivergenceThreshold(200);
      expect(await sentimentOracle.divergenceThresholdBps()).to.equal(200);
    });

    it("should reject invalid threshold", async function () {
      await expect(sentimentOracle.setDivergenceThreshold(0)).to.be.reverted;
      await expect(sentimentOracle.setDivergenceThreshold(5000)).to.be.reverted;
    });

    it("should reject non-owner setting threshold", async function () {
      const [, nonOwner] = await ethers.getSigners();
      await expect(
        sentimentOracle.connect(nonOwner).setDivergenceThreshold(200)
      ).to.be.reverted;
    });
  });

  describe("sentiment values", function () {
    it("should have correct sentiment values array", async function () {
      expect(await sentimentOracle.SENTIMENT_VALUES(0)).to.equal("bullish");
      expect(await sentimentOracle.SENTIMENT_VALUES(1)).to.equal("bearish");
      expect(await sentimentOracle.SENTIMENT_VALUES(2)).to.equal("neutral");
    });
  });
});
