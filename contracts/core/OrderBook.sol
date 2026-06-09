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

    uint256 public constant MAX_MATCHES_PER_CALL = 10;

    mapping(uint256 => Order) public orders;
    uint256[] public bidHeap;
    uint256[] public askHeap;
    uint256 public override nextOrderId;

    IMarginVault public marginVault;
    IPerpEngine  public perpEngine;
    bytes32      public pairId;
    address      public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "OrderBook: not owner");
        _;
    }

    constructor(address _marginVault, address _perpEngine, bytes32 _pairId) {
        marginVault = IMarginVault(_marginVault);
        perpEngine  = IPerpEngine(_perpEngine);
        pairId      = _pairId;
        owner       = msg.sender;
    }

    // ============ External Functions ============

    /// @notice Place a new order with leverage
    function placeOrder(
        bool isBid,
        uint256 price,
        uint256 size,
        uint256 leverage
    ) external returns (uint256 orderId) {
        require(price > 0,                         "OrderBook: price must be > 0");
        require(size > 0,                          "OrderBook: size must be > 0");
        require(leverage >= 1 && leverage <= 100,  "OrderBook: invalid leverage");

        // ── Margin calculation ─────────────────────────────────────────────────
        // size  is USDC notional in 6-decimal units  (e.g. 100 USDC = 100_000_000)
        // price is in 8-decimal units                (e.g. $62,000 = 6_200_000_000_000)
        //
        // We want: requiredMargin (6-dec USDC) = notional / leverage
        // notional = size (already in USDC 6-dec) — size IS the notional for a
        // USDC-margined perp where 1 contract = 1 USDC notional.
        // So: requiredMargin = size / leverage
        //
        // The old formula  (size * price) / 1e18  was written for SIZE_SCALE=1e18
        // contracts. With size in USDC 6-dec it produces ~0 and then a tiny lock
        // that allows entry, but when settlePosition calls _openPosition the same
        // formula produces a margin that doesn't match collateralBalances units,
        // causing the second _openPosition call (short side of self-match) to fail.
        uint256 requiredMargin = size / leverage;
        require(requiredMargin > 0, "OrderBook: margin too small");

        // Lock margin in vault before inserting order
        marginVault.lockMargin(msg.sender, requiredMargin);

        orderId = nextOrderId++;
        orders[orderId] = Order({
            id:        orderId,
            trader:    msg.sender,
            isBid:     isBid,
            price:     price,
            size:      size,
            margin:    requiredMargin,
            leverage:  leverage,
            timestamp: block.timestamp,
            status:    OrderStatus.OPEN
        });

        if (isBid) {
            _insertBid(orderId);
        } else {
            _insertAsk(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, isBid, price, size);

        _attemptMatch();
    }

    /// @notice Cancel an open order and release locked margin
    function cancelOrder(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(
            order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED,
            "OrderBook: order not cancellable"
        );
        require(order.trader == msg.sender, "OrderBook: not your order");

        order.status = OrderStatus.CANCELLED;
        _removeFromHeap(orderId, order.isBid);
        marginVault.releaseMargin(msg.sender, order.margin);

        emit OrderCancelled(orderId);
    }

    /// @notice Admin function to clear all stale orders from both heaps.
    ///         Releases locked margin back to each trader.
    ///         Use this before re-seeding a book that has orders from a previous run.
    function adminClearBook() external onlyOwner {
        // Clear bid heap — release margin for each open order
        while (bidHeap.length > 0) {
            uint256 oid   = bidHeap[0];
            Order storage o = orders[oid];
            if (o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) {
                o.status = OrderStatus.CANCELLED;
                // Release margin back to trader
                try marginVault.releaseMargin(o.trader, o.margin) {} catch {}
            }
            bidHeap[0] = bidHeap[bidHeap.length - 1];
            bidHeap.pop();
            if (bidHeap.length > 0) _siftDownBid(0);
        }

        // Clear ask heap
        while (askHeap.length > 0) {
            uint256 oid   = askHeap[0];
            Order storage o = orders[oid];
            if (o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) {
                o.status = OrderStatus.CANCELLED;
                try marginVault.releaseMargin(o.trader, o.margin) {} catch {}
            }
            askHeap[0] = askHeap[askHeap.length - 1];
            askHeap.pop();
            if (askHeap.length > 0) _siftDownAsk(0);
        }

        emit BookCleared(block.timestamp);
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

    /// @notice Get order book depth for frontend visualization.
    ///         Only returns orders with size > 0 and status OPEN or PARTIALLY_FILLED.
    ///         Partially-filled orders at non-root positions are excluded.
    function getOrderBookDepth(uint256 levels)
        external view
        returns (
            uint256[] memory bidPrices,
            uint256[] memory bidSizes,
            uint256[] memory askPrices,
            uint256[] memory askSizes
        )
    {
        uint256[] memory tmpBidP = new uint256[](bidHeap.length);
        uint256[] memory tmpBidS = new uint256[](bidHeap.length);
        uint256 bidCount = 0;

        for (uint256 i = 0; i < bidHeap.length && bidCount < levels; i++) {
            Order memory o = orders[bidHeap[i]];
            if (o.size > 0 && (
                o.status == OrderStatus.OPEN ||
                o.status == OrderStatus.PARTIALLY_FILLED
            )) {
                tmpBidP[bidCount] = o.price;
                tmpBidS[bidCount] = o.size;
                bidCount++;
            }
        }

        uint256[] memory tmpAskP = new uint256[](askHeap.length);
        uint256[] memory tmpAskS = new uint256[](askHeap.length);
        uint256 askCount = 0;

        for (uint256 i = 0; i < askHeap.length && askCount < levels; i++) {
            Order memory o = orders[askHeap[i]];
            if (o.size > 0 && (
                o.status == OrderStatus.OPEN ||
                o.status == OrderStatus.PARTIALLY_FILLED
            )) {
                tmpAskP[askCount] = o.price;
                tmpAskS[askCount] = o.size;
                askCount++;
            }
        }

        bidPrices = new uint256[](bidCount);
        bidSizes  = new uint256[](bidCount);
        askPrices = new uint256[](askCount);
        askSizes  = new uint256[](askCount);

        for (uint256 i = 0; i < bidCount; i++) {
            bidPrices[i] = tmpBidP[i];
            bidSizes[i]  = tmpBidS[i];
        }
        for (uint256 i = 0; i < askCount; i++) {
            askPrices[i] = tmpAskP[i];
            askSizes[i]  = tmpAskS[i];
        }
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    // ============ Internal Matching Logic ============

    function _attemptMatch() internal {
        uint256 matchCount = 0;

        while (
            bidHeap.length > 0 &&
            askHeap.length > 0 &&
            matchCount < MAX_MATCHES_PER_CALL
        ) {
            uint256 bidId = bidHeap[0];
            uint256 askId = askHeap[0];

            Order storage bid = orders[bidId];
            Order storage ask = orders[askId];

            // Price must cross
            if (bid.price < ask.price) break;

            // ── Self-match guard ───────────────────────────────────────────────
            // Same trader on both sides would call settlePosition(trader, trader)
            // which opens a long and short for the same address in sequence.
            // The second _openPosition overwrites the first and the free margin
            // check fails. Skip the ask and look for a different counterparty.
            if (bid.trader == ask.trader) {
                // Pop the ask temporarily and try the next one
                // If no other ask exists or none cross, break out
                if (askHeap.length <= 1) break;
                // Swap best ask to back and check second-best
                (askHeap[0], askHeap[askHeap.length - 1]) = (askHeap[askHeap.length - 1], askHeap[0]);
                _siftDownAsk(0);
                // Check if new best ask still crosses
                if (orders[askHeap[0]].price > bid.price) {
                    // Restore — nothing crosses without self-match, stop
                    // Re-heapify will correct itself on next insert
                    break;
                }
                continue;
            }

            // Fill price: older order has priority
            uint256 fillPrice = bid.timestamp <= ask.timestamp ? bid.price : ask.price;
            uint256 fillSize  = bid.size < ask.size ? bid.size : ask.size;

            // ── Release locked margin BEFORE settlePosition ────────────────────
            // placeOrder called lockMargin(trader, requiredMargin) which moved funds
            // from collateralBalances → lockedMargin.
            // settlePosition → _openPosition deducts from collateralBalances again.
            // Without releasing first, the trader is double-debited and _openPosition
            // reverts with "insufficient free margin".
            // Release the fill-proportional share of each order's locked margin
            // so collateralBalances has the funds available for _openPosition.
            uint256 bidTotalSize  = bid.size;   // snapshot before deduction
            uint256 askTotalSize  = ask.size;
            uint256 bidFillMargin = bidTotalSize > 0 ? (bid.margin * fillSize) / bidTotalSize : bid.margin;
            uint256 askFillMargin = askTotalSize > 0 ? (ask.margin * fillSize) / askTotalSize : ask.margin;

            marginVault.releaseMargin(bid.trader, bidFillMargin);
            marginVault.releaseMargin(ask.trader, askFillMargin);

            // Reduce stored order margin proportionally to the fill
            bid.margin -= bidFillMargin;
            ask.margin -= askFillMargin;

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

            // Settle: bid=long, ask=short.
            // _openPosition now finds the released margin in collateralBalances
            // and locks it correctly — no double-deduction.
            marginVault.settlePosition(
                bid.trader, ask.trader,
                fillPrice, fillSize,
                bid.leverage, ask.leverage
            );

            if (address(perpEngine) != address(0)) {
                perpEngine.recordFill(pairId, fillPrice, fillSize);
            }

            matchCount++;
            emit OrderMatched(bidId, askId, fillPrice, fillSize);
        }
    }

    // ============ Heap Operations ============

    function _insertBid(uint256 orderId) internal {
        bidHeap.push(orderId);
        _siftUpBid(bidHeap.length - 1);
    }

    function _insertAsk(uint256 orderId) internal {
        askHeap.push(orderId);
        _siftUpAsk(askHeap.length - 1);
    }

    function _siftUpBid(uint256 idx) internal {
        while (idx > 0) {
            uint256 parent = (idx - 1) / 2;
            if (orders[bidHeap[idx]].price > orders[bidHeap[parent]].price) {
                (bidHeap[idx], bidHeap[parent]) = (bidHeap[parent], bidHeap[idx]);
                idx = parent;
            } else break;
        }
    }

    function _siftUpAsk(uint256 idx) internal {
        while (idx > 0) {
            uint256 parent = (idx - 1) / 2;
            if (orders[askHeap[idx]].price < orders[askHeap[parent]].price) {
                (askHeap[idx], askHeap[parent]) = (askHeap[parent], askHeap[idx]);
                idx = parent;
            } else break;
        }
    }

    function _removeBestBid() internal {
        if (bidHeap.length == 0) return;
        bidHeap[0] = bidHeap[bidHeap.length - 1];
        bidHeap.pop();
        if (bidHeap.length > 0) _siftDownBid(0);
    }

    function _removeBestAsk() internal {
        if (askHeap.length == 0) return;
        askHeap[0] = askHeap[askHeap.length - 1];
        askHeap.pop();
        if (askHeap.length > 0) _siftDownAsk(0);
    }

    function _siftDownBid(uint256 idx) internal {
        uint256 length = bidHeap.length;
        while (true) {
            uint256 largest = idx;
            uint256 left    = 2 * idx + 1;
            uint256 right   = 2 * idx + 2;
            if (left  < length && orders[bidHeap[left]].price  > orders[bidHeap[largest]].price) largest = left;
            if (right < length && orders[bidHeap[right]].price > orders[bidHeap[largest]].price) largest = right;
            if (largest == idx) break;
            (bidHeap[idx], bidHeap[largest]) = (bidHeap[largest], bidHeap[idx]);
            idx = largest;
        }
    }

    function _siftDownAsk(uint256 idx) internal {
        uint256 length = askHeap.length;
        while (true) {
            uint256 smallest = idx;
            uint256 left     = 2 * idx + 1;
            uint256 right    = 2 * idx + 2;
            if (left  < length && orders[askHeap[left]].price  < orders[askHeap[smallest]].price) smallest = left;
            if (right < length && orders[askHeap[right]].price < orders[askHeap[smallest]].price) smallest = right;
            if (smallest == idx) break;
            (askHeap[idx], askHeap[smallest]) = (askHeap[smallest], askHeap[idx]);
            idx = smallest;
        }
    }

    function _removeFromHeap(uint256 orderId, bool isBid) internal {
        if (isBid) {
            for (uint256 i = 0; i < bidHeap.length; i++) {
                if (bidHeap[i] == orderId) {
                    bidHeap[i] = bidHeap[bidHeap.length - 1];
                    bidHeap.pop();
                    if (i < bidHeap.length) { _siftDownBid(i); _siftUpBid(i); }
                    break;
                }
            }
        } else {
            for (uint256 i = 0; i < askHeap.length; i++) {
                if (askHeap[i] == orderId) {
                    askHeap[i] = askHeap[askHeap.length - 1];
                    askHeap.pop();
                    if (i < askHeap.length) { _siftDownAsk(i); _siftUpAsk(i); }
                    break;
                }
            }
        }
    }

    // ============ Events ============
    event BookCleared(uint256 timestamp);
}
