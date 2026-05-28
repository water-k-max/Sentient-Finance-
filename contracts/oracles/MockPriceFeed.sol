// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockPriceFeed — @deprecated Replaced by SomniaPriceOracle + KeeperRegistry
/// Kept for test suite compatibility. Not used in production deployment.
contract MockPriceFeed {
    address public owner;
    uint256 public latestPrice;
    uint256 public latestTimestamp;

    modifier onlyOwner() {
        require(msg.sender == owner, "MockPriceFeed: not owner");
        _;
    }

    constructor(uint256 _initialPrice) {
        owner = msg.sender;
        latestPrice = _initialPrice; // e.g., 50000e8 for BTC at $50k
        latestTimestamp = block.timestamp;
    }

    function updatePrice(uint256 price) external onlyOwner {
        require(price > 0, "MockPriceFeed: price must be > 0");
        latestPrice = price;
        latestTimestamp = block.timestamp;
    }

    function getPrice() external view returns (uint256, uint256) {
        return (latestPrice, latestTimestamp);
    }
}
