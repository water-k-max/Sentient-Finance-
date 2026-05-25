// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title PerpEngine — Top-level coordinator for the perpetual swap engine
/// Single entry point for frontend and agents. Handles funding rates and settlement.
contract PerpEngine {
    IOrderBook public orderBook;
    IMarginVault public marginVault;
    address public owner;

    // Funding rate configuration
    uint256 public constant FUNDING_INTERVAL = 8 hours;
    uint256 public lastFundingTime;
    uint256 public indexPrice;

    // Price history for mark price computation
    struct FillRecord {
        uint256 price;
        uint256 size;
        uint256 timestamp;
    }
    FillRecord[] public recentFills;
    uint256 public constant FILL_HISTORY_WINDOW = 50;

    // Stats
    uint256 public totalVolume;
    uint256 public openInterest;
    uint256 public insuranceFundBalance;

    modifier onlyOwner() {
        require(msg.sender == owner, "PerpEngine: not owner");
        _;
    }

    constructor(address _orderBook, address _marginVault) {
        orderBook = IOrderBook(_orderBook);
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
        lastFundingTime = block.timestamp;
    }

    /// @notice Open a position via the order book
    function openPosition(
        bool isLong,
        uint256 size,
        uint256 leverage,
        uint256 limitPrice
    ) external returns (uint256 orderId) {
        // For a market order, set price to 0 (will match at best available)
        // For a limit order, use the specified price
        uint256 price = limitPrice > 0 ? limitPrice : (isLong ? type(uint256).max : 0);

        // If market order, we need best ask/bid for price
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
    function closePosition() external {
        // Get the trader's position
        // In production, position is keyed by address in MarginVault
        // For the hackathon, we place an opposing order at market
        // This is simplified - full implementation would query position details
        revert("PerpEngine: closePosition requires position query - use cancelOrder for now");
    }

    /// @notice Compute current funding rate
    /// fundingRate = (markPrice - indexPrice) / indexPrice / fundingInterval
    function computeFundingRate() external view returns (int256) {
        if (indexPrice == 0) return 0;

        int256 markPrice = int256Safe(_getMarkPrice());
        int256 idxPrice = int256Safe(indexPrice);

        int256 diff = markPrice - idxPrice;
        // Normalize to per-second rate
        return (diff * 1e18) / idxPrice / int256Safe(FUNDING_INTERVAL);
    }

    /// @notice Apply funding payments between longs and shorts
    function applyFunding() external {
        require(block.timestamp >= lastFundingTime + FUNDING_INTERVAL, "PerpEngine: funding interval not reached");

        int256 fundingRate = int256Safe(_getMarkPrice()) - int256Safe(indexPrice);
        // Transfer funding between positions
        // Simplified: in production, iterate positions and transfer

        lastFundingTime = block.timestamp;
        emit FundingApplied(fundingRate, block.timestamp);
    }

    /// @notice Get mark price (VWAP of recent fills)
    function getMarkPrice() external view returns (uint256) {
        return _getMarkPrice();
    }

    /// @notice Set index price (called by oracle adapter reactively)
    function setIndexPrice(uint256 price) external {
        require(price > 0, "PerpEngine: invalid price");
        indexPrice = price;
    }

    /// @notice Record a fill for mark price computation
    function recordFill(uint256 price, uint256 size) external {
        recentFills.push(FillRecord(price, size, block.timestamp));
        totalVolume += size;

        if (recentFills.length > FILL_HISTORY_WINDOW) {
            // Remove oldest fill
            for (uint256 i = 0; i < recentFills.length - 1; i++) {
                recentFills[i] = recentFills[i + 1];
            }
            recentFills.pop();
        }
    }

    event FundingApplied(int256 fundingRate, uint256 timestamp);
    event PositionOpened(address indexed trader, uint256 orderId);

    // ============ Internal Functions ============

    function _getMarkPrice() internal view returns (uint256) {
        if (recentFills.length == 0) return indexPrice;

        uint256 totalPriceWeighted = 0;
        uint256 totalSize = 0;

        for (uint256 i = 0; i < recentFills.length; i++) {
            totalPriceWeighted += recentFills[i].price * recentFills[i].size;
            totalSize += recentFills[i].size;
        }

        if (totalSize == 0) return indexPrice;
        return totalPriceWeighted / totalSize;
    }

    function int256Safe(uint256 value) internal pure returns (int256) {
        require(value <= uint256(type(int256).max), "PerpEngine: overflow");
        return int256(value);
    }
}
