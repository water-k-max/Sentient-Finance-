// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED }

struct Order {
    uint256 id;
    address trader;
    bool isBid;
    uint256 price;
    uint256 size;
    uint256 margin;
    uint256 leverage;
    uint256 timestamp;
    OrderStatus status;
}

interface IOrderBook {
    function placeOrder(bool isBid, uint256 price, uint256 size, uint256 leverage) external returns (uint256);
    function cancelOrder(uint256 orderId) external;
    function attemptMatch() external;
    function bestBid() external view returns (uint256);
    function bestAsk() external view returns (uint256);
    function getOrderBookDepth(uint256 levels) external view returns (uint256[] memory bidPrices, uint256[] memory bidSizes, uint256[] memory askPrices, uint256[] memory askSizes);
    function getOrder(uint256 orderId) external view returns (Order memory);
    function nextOrderId() external view returns (uint256);

    event OrderPlaced(uint256 indexed orderId, address indexed trader, bool isBid, uint256 price, uint256 size);
    event OrderMatched(uint256 indexed bidOrderId, uint256 indexed askOrderId, uint256 fillPrice, uint256 fillSize);
    event OrderCancelled(uint256 indexed orderId);
}
