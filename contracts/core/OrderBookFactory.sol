// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrderBook} from "../core/OrderBook.sol";

/// @title OrderBookFactory — Deploys a new OrderBook per trading pair
/// Enables multi-pair support: BTC-USD, ETH-USD, SOL-USD, etc.
/// Each pair gets its own isolated order book contract.
contract OrderBookFactory {
    address public owner;
    address public marginVault;

    // pairId → OrderBook address
    mapping(bytes32 => address) public pairOrderBooks;
    bytes32[] public allPairs;
    mapping(bytes32 => bool) public pairExists;

    modifier onlyOwner() {
        require(msg.sender == owner, "Factory: not owner");
        _;
    }

    constructor(address _marginVault) {
        marginVault = _marginVault;
        owner = msg.sender;
    }

    /// @notice Deploy a new OrderBook for the given trading pair
    function createOrderBook(bytes32 pairId) external onlyOwner returns (address) {
        require(!pairExists[pairId], "Factory: pair already exists");

        OrderBook orderBook = new OrderBook(marginVault);
        address orderBookAddr = address(orderBook);

        pairOrderBooks[pairId] = orderBookAddr;
        allPairs.push(pairId);
        pairExists[pairId] = true;

        emit OrderBookCreated(pairId, orderBookAddr);
        return orderBookAddr;
    }

    /// @notice Get all registered pairs
    function getAllPairs() external view returns (bytes32[] memory) {
        return allPairs;
    }

    /// @notice Get the number of registered pairs
    function getPairCount() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Check if a pair exists
    function hasPair(bytes32 pairId) external view returns (bool) {
        return pairExists[pairId];
    }

    event OrderBookCreated(bytes32 pairId, address orderBookAddress);
}
