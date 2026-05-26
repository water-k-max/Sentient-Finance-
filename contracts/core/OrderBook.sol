// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Order, OrderStatus, IOrderBook} from "../interfaces/IOrderBook.sol";
import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title IPerpEngine — Minimal interface for OrderBook to record fills
interface IPerpEngine {
    function recordFill(bytes32 pairId, uint256 price, uint256 size) external;
}

/// @title OrderBook — On-chain perpetual swap order book with native matching
contract OrderBook is IOrderBook {
    // ============ State ============

    mapping(uint256 => Order) public orders;
    uint256[] public bidHeap;
    uint256[] public askHeap;
    uint256 public override nextOrderId;

    IMarginVault public marginVault;
    IPerpEngine public perpEngine;
    bytes32 public pairId;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "OrderBook: not owner");
        _;
    }

    constructor(address _marginVault, address _perpEngine, bytes32 _pairId) {
        marginVault = IMarginVault(_marginVault);
        perpEngine = IPerpEngine(_perpEngine);
        pairId = _pairId;
        owner = msg.sender;
    }

    // ============ External Functions ============

    /// @notice Place a new order with leverage
    function placeOrder(
        bool isBid,
        uint256 price,
        uint256 size,
        uint256 leverage
    ) external returns (uint256 orderId) {
        require(price > 0, "OrderBook: price must be > 0");
        require(size > 0, "OrderBook: size must be > 0");
        require(leverage >= 1 && leverage <= 100, "OrderBook: invalid leverage");

        // Calculate required margin: size / leverage (simplified)
        uint256 notional = (size * price) / 1e18;
        uint256 requiredMargin = notional / leverage;
        require(requiredMargin > 0, "OrderBook: margin too small");

        // Lock margin via vault
        marginVault.lockMargin(msg.sender, requiredMargin);

        orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            trader: msg.sender,
            isBid: isBid,
            price: price,
            size: size,
            margin: requiredMargin,
            leverage: leverage,
            timestamp: block.timestamp,
            status: OrderStatus.OPEN
        });

        // Insert into appropriate heap
        if (isBid) {
            _insertBid(orderId);
        } else {
            _insertAsk(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, isBid, price, size);

        // Attempt to match immediately
        _attemptMatch();
    }

    /// @notice Cancel an open order
    function cancelOrder(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED,
            "OrderBook: order not cancellable");
        require(order.trader == msg.sender, "OrderBook: not your order");

        order.status = OrderStatus.CANCELLED;

        // Remove from heap
        _removeFromHeap(orderId, order.isBid);

        // Release remaining margin
        marginVault.releaseMargin(msg.sender, order.margin);

        emit OrderCancelled(orderId);
    }

    /// @notice Public entry point for reactive matching
    function attemptMatch() external override {
        _attemptMatch();
    }

    /// @notice Get best bid price (0 if no bids)
    function bestBid() external view returns (uint256) {
        if (bidHeap.length == 0) return 0;
        return orders[bidHeap[0]].price;
    }

    /// @notice Get best ask price (0 if no asks)
    function bestAsk() external view returns (uint256) {
        if (askHeap.length == 0) return 0;
        return orders[askHeap[0]].price;
    }

    /// @notice Get order book depth for frontend visualization
    function getOrderBookDepth(uint256 levels)
        external view
        returns (
            uint256[] memory bidPrices,
            uint256[] memory bidSizes,
            uint256[] memory askPrices,
            uint256[] memory askSizes
        )
    {
        uint256 bidCount = bidHeap.length < levels ? bidHeap.length : levels;
        uint256 askCount = askHeap.length < levels ? askHeap.length : levels;

        bidPrices = new uint256[](bidCount);
        bidSizes = new uint256[](bidCount);
        askPrices = new uint256[](askCount);
        askSizes = new uint256[](askCount);

        for (uint256 i = 0; i < bidCount; i++) {
            Order memory o = orders[bidHeap[i]];
            bidPrices[i] = o.price;
            bidSizes[i] = o.size;
        }

        for (uint256 i = 0; i < askCount; i++) {
            Order memory o = orders[askHeap[i]];
            askPrices[i] = o.price;
            askSizes[i] = o.size;
        }
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    // ============ Internal Matching Logic ============

    /// @notice Attempt to match crossing orders
    function _attemptMatch() internal {
        while (bidHeap.length > 0 && askHeap.length > 0) {
            uint256 bidId = bidHeap[0];
            uint256 askId = askHeap[0];

            Order storage bid = orders[bidId];
            Order storage ask = orders[askId];

            // Check if bid >= ask (crossing)
            if (bid.price < ask.price) break;

            // Fill price is the older order's price (price-time priority)
            uint256 fillPrice;
            if (bid.timestamp <= ask.timestamp) {
                fillPrice = bid.price;
            } else {
                fillPrice = ask.price;
            }

            // Determine fill size
            uint256 fillSize = bid.size < ask.size ? bid.size : ask.size;

            // Update orders
            bid.size -= fillSize;
            ask.size -= fillSize;

            if (bid.size == 0) {
                bid.status = OrderStatus.FILLED;
                _removeBestBid();
            } else {
                bid.status = OrderStatus.PARTIALLY_FILLED;
            }

            if (ask.size == 0) {
                ask.status = OrderStatus.FILLED;
                _removeBestAsk();
            } else {
                ask.status = OrderStatus.PARTIALLY_FILLED;
            }

            // Settle positions via MarginVault
            // Bid = long (buying), Ask = short (selling)
            marginVault.settlePosition(bid.trader, ask.trader, fillPrice, fillSize, bid.leverage, ask.leverage);

            // Record fill for mark price computation in PerpEngine
            if (address(perpEngine) != address(0)) {
                perpEngine.recordFill(pairId, fillPrice, fillSize);
            }

            emit OrderMatched(bidId, askId, fillPrice, fillSize);
        }
    }

    // ============ Heap Operations ============

    /// @notice Insert order ID into max-heap (bids: highest price first)
    function _insertBid(uint256 orderId) internal {
        bidHeap.push(orderId);
        _siftUpBid(bidHeap.length - 1);
    }

    /// @notice Insert order ID into min-heap (asks: lowest price first)
    function _insertAsk(uint256 orderId) internal {
        askHeap.push(orderId);
        _siftUpAsk(askHeap.length - 1);
    }

    /// @notice Sift up for max-heap (bids)
    function _siftUpBid(uint256 idx) internal {
        while (idx > 0) {
            uint256 parent = (idx - 1) / 2;
            if (orders[bidHeap[idx]].price > orders[bidHeap[parent]].price) {
                (bidHeap[idx], bidHeap[parent]) = (bidHeap[parent], bidHeap[idx]);
                idx = parent;
            } else {
                break;
            }
        }
    }

    /// @notice Sift up for min-heap (asks)
    function _siftUpAsk(uint256 idx) internal {
        while (idx > 0) {
            uint256 parent = (idx - 1) / 2;
            if (orders[askHeap[idx]].price < orders[askHeap[parent]].price) {
                (askHeap[idx], askHeap[parent]) = (askHeap[parent], askHeap[idx]);
                idx = parent;
            } else {
                break;
            }
        }
    }

    /// @notice Remove best bid and re-heapify
    function _removeBestBid() internal {
        if (bidHeap.length == 0) return;
        bidHeap[0] = bidHeap[bidHeap.length - 1];
        bidHeap.pop();
        if (bidHeap.length > 0) _siftDownBid(0);
    }

    /// @notice Remove best ask and re-heapify
    function _removeBestAsk() internal {
        if (askHeap.length == 0) return;
        askHeap[0] = askHeap[askHeap.length - 1];
        askHeap.pop();
        if (askHeap.length > 0) _siftDownAsk(0);
    }

    /// @notice Sift down for max-heap (bids)
    function _siftDownBid(uint256 idx) internal {
        uint256 length = bidHeap.length;
        while (true) {
            uint256 largest = idx;
            uint256 left = 2 * idx + 1;
            uint256 right = 2 * idx + 2;

            if (left < length && orders[bidHeap[left]].price > orders[bidHeap[largest]].price) {
                largest = left;
            }
            if (right < length && orders[bidHeap[right]].price > orders[bidHeap[largest]].price) {
                largest = right;
            }
            if (largest == idx) break;
            (bidHeap[idx], bidHeap[largest]) = (bidHeap[largest], bidHeap[idx]);
            idx = largest;
        }
    }

    /// @notice Sift down for min-heap (asks)
    function _siftDownAsk(uint256 idx) internal {
        uint256 length = askHeap.length;
        while (true) {
            uint256 smallest = idx;
            uint256 left = 2 * idx + 1;
            uint256 right = 2 * idx + 2;

            if (left < length && orders[askHeap[left]].price < orders[askHeap[smallest]].price) {
                smallest = left;
            }
            if (right < length && orders[askHeap[right]].price < orders[askHeap[smallest]].price) {
                smallest = right;
            }
            if (smallest == idx) break;
            (askHeap[idx], askHeap[smallest]) = (askHeap[smallest], askHeap[idx]);
            idx = smallest;
        }
    }

    /// @notice Remove a specific order ID from the heap
    function _removeFromHeap(uint256 orderId, bool isBid) internal {
        if (isBid) {
            for (uint256 i = 0; i < bidHeap.length; i++) {
                if (bidHeap[i] == orderId) {
                    bidHeap[i] = bidHeap[bidHeap.length - 1];
                    bidHeap.pop();
                    if (i < bidHeap.length) {
                        _siftDownBid(i);
                        _siftUpBid(i);
                    }
                    break;
                }
            }
        } else {
            for (uint256 i = 0; i < askHeap.length; i++) {
                if (askHeap[i] == orderId) {
                    askHeap[i] = askHeap[askHeap.length - 1];
                    askHeap.pop();
                    if (i < askHeap.length) {
                        _siftDownAsk(i);
                        _siftUpAsk(i);
                    }
                    break;
                }
            }
        }
    }
}
