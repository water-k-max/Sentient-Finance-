// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OracleAdapter — @deprecated Replaced by SomniaPriceOracle (keeper median)
/// Kept for test suite compatibility. Not used in production deployment.
contract OracleAdapter {
    address public owner;
    address public priceFeed;
    bytes32 public assetId;
    uint256 public latestPrice;
    uint256 public latestTimestamp;

    bytes32 public constant PRICE_UPDATED_TOPIC = keccak256("PriceUpdated(bytes32,uint256,uint256)");

    modifier onlyOwner() {
        require(msg.sender == owner, "OracleAdapter: not owner");
        _;
    }

    constructor(address _priceFeed, bytes32 _assetId) {
        owner = msg.sender;
        priceFeed = _priceFeed;
        assetId = _assetId;
    }

    /// @notice Update price from the feed (can be called by anyone for mock, or only feed for live)
    function updatePrice() external {
        (uint256 price, uint256 timestamp) = _fetchPrice();
        latestPrice = price;
        latestTimestamp = timestamp;
        emit PriceUpdated(assetId, price, timestamp);
    }

    /// @notice Update price with a direct value (for mock feed)
    /// F-01 FIX: was permissionless — anyone could set the index price to an
    /// arbitrary value and drive liquidation/PnL/funding off a fabricated number.
    /// Restricted to the owner (the relayer/keeper key). For a trustless feed,
    /// replace with a validated Chainlink/keeper-median read instead of a setter.
    function updatePriceDirect(uint256 price) external onlyOwner {
        latestPrice = price;
        latestTimestamp = block.timestamp;
        emit PriceUpdated(assetId, price, block.timestamp);
    }

    /// @notice Get current index price
    function getIndexPrice(bytes32 /* assetId */) external view returns (uint256) {
        return latestPrice;
    }

    event PriceUpdated(bytes32 assetId, uint256 price, uint256 timestamp);

    function _fetchPrice() internal view returns (uint256 price, uint256 timestamp) {
        // For mock feed: call getPrice()
        // For Chainlink/Protofire: would call latestRoundData()
        // This is simplified — in production, use proper interface
        (price, timestamp) = _callPriceFeed();
    }

    function _callPriceFeed() internal view returns (uint256, uint256) {
        // Mock interface: function getPrice() returns (uint256, uint256)
        (bool success, bytes memory data) = priceFeed.staticcall(
            abi.encodeWithSignature("getPrice()")
        );
        if (success && data.length >= 64) {
            return abi.decode(data, (uint256, uint256));
        }
        return (latestPrice, latestTimestamp);
    }
}
