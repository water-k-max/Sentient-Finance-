// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title PerpEngine — Top-level coordinator for the perpetual swap engine
/// Single entry point for frontend and agents. Handles funding rates and settlement.
/// Multi-pair: each trading pair has its own OrderBook, index price, and funding rate.
contract PerpEngine {
    IMarginVault public marginVault;
    address public owner;

    // pairId → OrderBook
    mapping(bytes32 => IOrderBook) public pairOrderBooks;

    // pairId → index price
    mapping(bytes32 => uint256) public indexPrices;

    // pairId → last funding time
    mapping(bytes32 => uint256) public lastFundingTimes;

    // Funding rate configuration
    uint256 public constant FUNDING_INTERVAL = 8 hours;

    // Price history for mark price computation (per pair)
    struct FillRecord {
        uint256 price;
        uint256 size;
        uint256 timestamp;
    }
    mapping(bytes32 => FillRecord[]) public recentFills;
    uint256 public constant FILL_HISTORY_WINDOW = 50;

    // Stats
    uint256 public totalVolume;
    uint256 public openInterest;
    uint256 public insuranceFundBalance;

    // Registered pairs
    bytes32[] public allPairs;
    mapping(bytes32 => bool) public pairRegistered;

    modifier onlyOwner() {
        require(msg.sender == owner, "PerpEngine: not owner");
        _;
    }

    constructor(address _marginVault) {
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
    }

    /// @notice Register a new trading pair with its OrderBook
    function registerPair(bytes32 pairId, address orderBookAddr) external onlyOwner {
        require(!pairRegistered[pairId], "PerpEngine: pair already registered");
        require(orderBookAddr != address(0), "PerpEngine: invalid address");

        pairOrderBooks[pairId] = IOrderBook(orderBookAddr);
        lastFundingTimes[pairId] = block.timestamp;
        allPairs.push(pairId);
        pairRegistered[pairId] = true;

        emit PairRegistered(pairId, orderBookAddr);
    }

    /// @notice Open a position via the order book for a specific pair
    function openPosition(
        bytes32 pairId,
        bool isLong,
        uint256 size,
        uint256 leverage,
        uint256 limitPrice
    ) external returns (uint256 orderId) {
        require(pairRegistered[pairId], "PerpEngine: pair not registered");

        IOrderBook orderBook = pairOrderBooks[pairId];
        uint256 price = limitPrice > 0 ? limitPrice : (isLong ? type(uint256).max : 0);

        if (limitPrice == 0) {
            if (isLong) {
                price = orderBook.bestAsk();
                require(price > 0, "PerpEngine: no ask available");
            } else {
                price = orderBook.bestBid();
                require(price > 0, "PerpEngine: no bid available");
            }
        }

        orderId = orderBook.placeOrder(isLong, price, size, leverage);
    }

    /// @notice Close a position by placing an opposing market order
    function closePosition(bytes32 pairId) external {
        require(pairRegistered[pairId], "PerpEngine: pair not registered");
        revert("PerpEngine: closePosition requires position query - use cancelOrder for now");
    }

    /// @notice Compute current funding rate for a pair
    function computeFundingRate(bytes32 pairId) external view returns (int256) {
        uint256 idxPrice = indexPrices[pairId];
        if (idxPrice == 0) return 0;

        int256 markPrice = int256Safe(_getMarkPrice(pairId));
        int256 idxPriceSigned = int256Safe(idxPrice);

        int256 diff = markPrice - idxPriceSigned;
        return (diff * 1e18) / idxPriceSigned / int256Safe(FUNDING_INTERVAL);
    }

    /// @notice Apply funding payments between longs and shorts for a pair
    function applyFunding(bytes32 pairId) external {
        require(pairRegistered[pairId], "PerpEngine: pair not registered");
        require(
            block.timestamp >= lastFundingTimes[pairId] + FUNDING_INTERVAL,
            "PerpEngine: funding interval not reached"
        );

        int256 fundingRate = int256Safe(_getMarkPrice(pairId)) - int256Safe(indexPrices[pairId]);
        lastFundingTimes[pairId] = block.timestamp;
        emit FundingApplied(pairId, fundingRate, block.timestamp);
    }

    /// @notice Get mark price (VWAP of recent fills) for a pair
    function getMarkPrice(bytes32 pairId) external view returns (uint256) {
        return _getMarkPrice(pairId);
    }

    /// @notice Set index price for a pair (called by oracle adapter reactively)
    function setIndexPrice(bytes32 pairId, uint256 price) external {
        require(price > 0, "PerpEngine: invalid price");
        indexPrices[pairId] = price;
    }

    /// @notice Record a fill for mark price computation
    function recordFill(bytes32 pairId, uint256 price, uint256 size) external {
        recentFills[pairId].push(FillRecord(price, size, block.timestamp));
        totalVolume += size;

        if (recentFills[pairId].length > FILL_HISTORY_WINDOW) {
            for (uint256 i = 0; i < recentFills[pairId].length - 1; i++) {
                recentFills[pairId][i] = recentFills[pairId][i + 1];
            }
            recentFills[pairId].pop();
        }
    }

    /// @notice Get all registered pairs
    function getAllPairs() external view returns (bytes32[] memory) {
        return allPairs;
    }

    event FundingApplied(bytes32 pairId, int256 fundingRate, uint256 timestamp);
    event PositionOpened(bytes32 pairId, address indexed trader, uint256 orderId);
    event PairRegistered(bytes32 pairId, address orderBookAddress);

    // ============ Internal Functions ============

    function _getMarkPrice(bytes32 pairId) internal view returns (uint256) {
        FillRecord[] memory fills = recentFills[pairId];
        if (fills.length == 0) return indexPrices[pairId];

        uint256 totalPriceWeighted = 0;
        uint256 totalSize = 0;

        for (uint256 i = 0; i < fills.length; i++) {
            totalPriceWeighted += fills[i].price * fills[i].size;
            totalSize += fills[i].size;
        }

        if (totalSize == 0) return indexPrices[pairId];
        return totalPriceWeighted / totalSize;
    }

    function int256Safe(uint256 value) internal pure returns (int256) {
        require(value <= uint256(type(int256).max), "PerpEngine: overflow");
        return int256(value);
    }
}
