// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault, Position} from "../interfaces/IMarginVault.sol";

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
    // Circular buffer: O(1) write instead of O(n) array shift
    // Note: Solidity requires literal for fixed array size in mapping
    struct FillRecord {
        uint256 price;
        uint256 size;
        uint256 timestamp;
    }
    mapping(bytes32 => FillRecord[50]) public fillBuffer;
    mapping(bytes32 => uint256) public fillHead;
    mapping(bytes32 => uint256) public fillCount;
    uint256 public constant FILL_HISTORY_WINDOW = 50;

    // Stats
    uint256 public totalVolume;
    uint256 public openInterest;
    uint256 public insuranceFundBalance;

    // Registered pairs
    bytes32[] public allPairs;
    mapping(bytes32 => bool) public pairRegistered;

    // F-02 FIX: explicit authorized set (order books + the oracle/engine relayer).
    // The owner is authorized by construction so the legitimate deployer flow keeps
    // working; every OrderBook must be authorized before its fills are accepted.
    // This closes the permissionless setIndexPrice / recordFill holes that let
    // anyone fabricate the index price or poison the VWAP mark-price buffer.
    mapping(address => bool) public authorized;

    modifier onlyOwner() {
        require(msg.sender == owner, "PerpEngine: not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(authorized[msg.sender], "PerpEngine: not authorized");
        _;
    }

    constructor(address _marginVault) {
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
        authorized[msg.sender] = true;
    }

    /// @notice Grant or revoke authorization (order books, oracle relayer). F-02.
    function setAuthorized(address _addr, bool _ok) external onlyOwner {
        authorized[_addr] = _ok;
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

        Position memory pos = marginVault.getPosition(msg.sender);
        require(pos.isOpen, "PerpEngine: no open position");

        IOrderBook orderBook = pairOrderBooks[pairId];

        // Place opposing order: if long, sell; if short, buy
        bool isBid = !pos.isLong; // Long → sell (ask), Short → buy (bid)
        uint256 price = isBid ? orderBook.bestAsk() : orderBook.bestBid();
        require(price > 0, "PerpEngine: no liquidity to close");

        // Close full position size
        uint256 orderId = orderBook.placeOrder(isBid, price, pos.size, pos.leverage);
        emit PositionClosed(pairId, msg.sender, orderId);
    }

    /// @notice Compute current funding rate for a pair
    function computeFundingRate(bytes32 pairId) external view returns (int256) {
        uint256 idxPrice = indexPrices[pairId];
        if (idxPrice == 0) return 0;

        int256 markPrice = int256Safe(_getMarkPrice(pairId));
        int256 idxPriceSigned = int256Safe(idxPrice);

        int256 diff = markPrice - idxPriceSigned;
        // F-10 FIX: the funding rate is a per-interval premium ratio. applyFunding
        // is already gated to fire once per FUNDING_INTERVAL, so dividing by the
        // interval (28800 s) a second time shrank the rate ~28800x and made funding
        // effectively zero. Return (mark - index) / index, scaled to 1e18.
        return (diff * 1e18) / idxPriceSigned;
    }

    /// @notice Apply funding payments between longs and shorts for a pair
    function applyFunding(bytes32 pairId) external {
        require(pairRegistered[pairId], "PerpEngine: pair not registered");
        require(
            block.timestamp >= lastFundingTimes[pairId] + FUNDING_INTERVAL,
            "PerpEngine: funding interval not reached"
        );

        uint256 markPrice = _getMarkPrice(pairId);
        uint256 indexPrice = indexPrices[pairId];
        require(indexPrice > 0, "PerpEngine: no index price");

        // fundingRate is positive when longs pay shorts, negative when shorts pay longs
        // F-10 FIX: removed the spurious second `/ FUNDING_INTERVAL` (see computeFundingRate).
        int256 fundingRate = (int256Safe(markPrice) - int256Safe(indexPrice))
            * 1e18
            / int256Safe(indexPrice);

        address[] memory traders = marginVault.getTrackedTraders();
        for (uint256 i = 0; i < traders.length; i++) {
            Position memory pos = marginVault.getPosition(traders[i]);
            if (!pos.isOpen) continue;

            // funding payment = fundingRate * positionSize / 1e18
            int256 payment = fundingRate * int256Safe(pos.size) / 1e18;

            // longs pay (deduct), shorts receive (add) when fundingRate > 0
            // vice versa when fundingRate < 0
            if (pos.isLong) {
                marginVault.adjustMargin(traders[i], -payment);
            } else {
                marginVault.adjustMargin(traders[i], payment);
            }
        }

        lastFundingTimes[pairId] = block.timestamp;
        emit FundingApplied(pairId, fundingRate, block.timestamp);
    }

    /// @notice Get mark price (VWAP of recent fills) for a pair
    function getMarkPrice(bytes32 pairId) external view returns (uint256) {
        return _getMarkPrice(pairId);
    }

    /// @notice Set index price for a pair (called by the authorized oracle relayer)
    /// F-02 FIX: was permissionless. Now restricted to the authorized set.
    function setIndexPrice(bytes32 pairId, uint256 price) external onlyAuthorized {
        require(price > 0, "PerpEngine: invalid price");
        indexPrices[pairId] = price;
    }

    /// @notice Record a fill for mark price computation — O(1) circular buffer
    /// F-02 FIX: was permissionless; anyone could inject fake fills to steer the
    /// VWAP mark price (and thus funding + liquidations). Now restricted to the
    /// authorized order books / engine.
    function recordFill(bytes32 pairId, uint256 price, uint256 size) external onlyAuthorized {
        uint256 count = fillCount[pairId];
        uint256 head = fillHead[pairId];

        if (count < FILL_HISTORY_WINDOW) {
            // Buffer not full yet — append
            fillBuffer[pairId][count] = FillRecord(price, size, block.timestamp);
            fillCount[pairId] = count + 1;
        } else {
            // Buffer full — overwrite oldest entry (head position)
            fillBuffer[pairId][head] = FillRecord(price, size, block.timestamp);
            fillHead[pairId] = (head + 1) % FILL_HISTORY_WINDOW;
        }
        totalVolume += size;
    }

    /// @notice Get all registered pairs
    function getAllPairs() external view returns (bytes32[] memory) {
        return allPairs;
    }

    event FundingApplied(bytes32 pairId, int256 fundingRate, uint256 timestamp);
    event PositionOpened(bytes32 pairId, address indexed trader, uint256 orderId);
    event PositionClosed(bytes32 pairId, address indexed trader, uint256 orderId);
    event PairRegistered(bytes32 pairId, address orderBookAddress);

    // ============ Internal Functions ============

    function _getMarkPrice(bytes32 pairId) internal view returns (uint256) {
        uint256 count = fillCount[pairId];
        if (count == 0) return indexPrices[pairId];

        uint256 head = fillHead[pairId];
        uint256 totalPriceWeighted = 0;
        uint256 totalSize = 0;

        for (uint256 i = 0; i < count; i++) {
            uint256 idx = (head + i) % FILL_HISTORY_WINDOW;
            FillRecord memory fill = fillBuffer[pairId][idx];
            totalPriceWeighted += fill.price * fill.size;
            totalSize += fill.size;
        }

        if (totalSize == 0) return indexPrices[pairId];
        return totalPriceWeighted / totalSize;
    }

    function int256Safe(uint256 value) internal pure returns (int256) {
        require(value <= uint256(type(int256).max), "PerpEngine: overflow");
        return int256(value);
    }
}
