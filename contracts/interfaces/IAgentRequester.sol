// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ Somnia Agents Platform Interface ============

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);

    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

// ============ Agent Response Types ============

enum ConsensusType { Majority, Threshold }

enum ResponseStatus { None, Pending, Success, Failed, TimedOut }

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    uint256 consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

// ============ JSON API Agent Interface ============

interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata selector, uint8 decimals)
        external returns (uint256);
}
