// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRequester, IJsonApiAgent, Response, Request, ResponseStatus, ConsensusType} from "../interfaces/IAgentRequester.sol";

/// @title AgentOracle — Live price feed via Somnia's JSON API Agent
/// Fetches BTC/USD price from CoinGecko API using Somnia's decentralized
/// JSON API Request agent. The result arrives asynchronously via callback,
/// then triggers the full reactive cascade (PnL update → Sentinel check → LP rebalance).
///
/// This is the core "contract takes action with data returned by the agent" use case.
contract AgentOracle {
    address public owner;
    bytes32 public assetId;

    // Somnia Agents platform contract
    IAgentRequester public platform;

    // JSON API Request agent ID (same on mainnet and testnet)
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant THRESHOLD = 2; // 2 of 3 — faster, tolerates 1 failure
    uint256 public constant PRICE_PER_AGENT = 0.03 ether;

    // CoinGecko API config
    string public constant COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    string public constant COINGECKO_SELECTOR = "bitcoin.usd";
    uint8 public constant COINGECKO_DECIMALS = 8;

    // State
    uint256 public latestPrice;
    uint256 public lastUpdated;
    mapping(uint256 => bool) public pendingRequests;

    // Events
    event PriceUpdated(bytes32 assetId, uint256 price, uint256 timestamp);
    event PriceRequested(uint256 requestId);

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentOracle: not owner");
        _;
    }

    constructor(address _platform, bytes32 _assetId) {
        owner = msg.sender;
        platform = IAgentRequester(_platform);
        assetId = _assetId;
    }

    /// @notice Request a fresh price from CoinGecko via Somnia's JSON API Agent
    /// Uses Threshold consensus (2 of 3 validators) for faster finalization
    /// Caller must send enough ETH to cover: operations reserve + pricePerAgent × subcommitteeSize
    function requestPrice() external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            COINGECKO_URL,
            COINGECKO_SELECTOR,
            COINGECKO_DECIMALS
        );

        uint256 deposit = platform.getAdvancedRequestDeposit(SUBCOMMITTEE_SIZE)
                        + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= deposit, "AgentOracle: insufficient deposit");

        requestId = platform.createAdvancedRequest{value: deposit}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            THRESHOLD,
            ConsensusType.Threshold,
            900 // timeout: 15 minutes
        );

        pendingRequests[requestId] = true;
        emit PriceRequested(requestId);
    }

    /// @notice Callback from Somnia Agents platform with the fetched price
    function handleResponse(
        uint256 requestId,
        Response[] calldata responses,
        ResponseStatus status,
        Request calldata /* details */
    ) external {
        require(msg.sender == address(platform), "AgentOracle: only platform");
        require(pendingRequests[requestId], "AgentOracle: unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            uint256 price = abi.decode(responses[0].result, (uint256));
            latestPrice = price;
            lastUpdated = block.timestamp;
            emit PriceUpdated(assetId, price, block.timestamp);
        }
        // Failed/TimedOut: just clean up. Caller can retry.
    }

    /// @notice Get current index price
    function getIndexPrice(bytes32 /* _assetId */) external view returns (uint256) {
        return latestPrice;
    }

    /// @notice Compute required deposit for a price request
    function getRequestDeposit() external view returns (uint256) {
        return platform.getRequestDeposit() + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
    }

    // Accept native token rebates from Somnia Agents platform
    receive() external payable {}
}
