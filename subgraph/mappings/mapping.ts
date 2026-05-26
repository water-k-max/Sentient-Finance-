import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import {
  OrderPlaced,
  OrderMatched,
  OrderCancelled,
} from "../generated/OrderBook/OrderBook";
import {
  LiquidationExecuted,
  PositionSettled,
} from "../generated/MarginVault/MarginVault";
import { Order, Match, Liquidation, Position, Stats } from "../generated/schema";

export function handleOrderPlaced(event: OrderPlaced): void {
  const order = new Order(event.params.orderId.toString());
  order.trader = event.params.trader;
  order.isBid = event.params.isBid;
  order.price = event.params.price;
  order.size = event.params.size;
  order.margin = BigInt.zero(); // Set from margin lock event if needed
  order.leverage = BigInt.zero(); // Would need Order struct access
  order.timestamp = event.block.timestamp;
  order.status = "OPEN";
  order.save();

  // Increment stats
  incrementMatches();
}

export function handleOrderMatched(event: OrderMatched): void {
  const id = event.params.bidOrderId.toString() + "-" + event.params.askOrderId.toString();
  const match = new Match(id);
  match.bidOrderId = event.params.bidOrderId;
  match.askOrderId = event.params.askOrderId;
  match.fillPrice = event.params.fillPrice;
  match.fillSize = event.params.fillSize;
  match.timestamp = event.block.timestamp;
  match.blockNumber = event.block.number;
  match.save();

  // Update both orders to FILLED
  const bidOrder = Order.load(event.params.bidOrderId.toString());
  if (bidOrder) {
    bidOrder.status = "FILLED";
    bidOrder.save();
  }

  const askOrder = Order.load(event.params.askOrderId.toString());
  if (askOrder) {
    askOrder.status = "FILLED";
    askOrder.save();
  }

  incrementMatches();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  const order = Order.load(event.params.orderId.toString());
  if (order) {
    order.status = "CANCELLED";
    order.save();
  }
}

export function handleLiquidationExecuted(event: LiquidationExecuted): void {
  const id = event.params.trader.toHexString() + "-" + event.timestamp.toString();
  const liq = new Liquidation(id);
  liq.trader = event.params.trader;
  liq.liquidationPrice = event.params.liquidationPrice;
  liq.remainingMargin = event.params.remainingMargin;
  liq.timestamp = event.block.timestamp;
  liq.blockNumber = event.block.number;
  liq.save();

  // Update position to closed
  const position = Position.load(event.params.trader.toHexString());
  if (position) {
    position.isOpen = false;
    position.closedAt = event.block.timestamp;
    position.save();
  }

  incrementLiquidations();
}

export function handlePositionSettled(event: PositionSettled): void {
  // Create position for long trader (bid)
  const longId = event.params.longTrader.toHexString();
  const longPos = new Position(longId);
  longPos.trader = event.params.longTrader;
  longPos.isLong = true;
  longPos.entryPrice = event.params.fillPrice;
  longPos.size = event.params.fillSize;
  longPos.margin = BigInt.zero(); // Would need margin data
  longPos.leverage = BigInt.zero(); // Would need leverage data
  longPos.liquidationPrice = BigInt.zero(); // Would need computed liq price
  longPos.isOpen = true;
  longPos.createdAt = event.block.timestamp;
  longPos.save();

  // Create position for short trader (ask)
  const shortId = event.params.shortTrader.toHexString();
  const shortPos = new Position(shortId);
  shortPos.trader = event.params.shortTrader;
  shortPos.isLong = false;
  shortPos.entryPrice = event.params.fillPrice;
  shortPos.size = event.params.fillSize;
  shortPos.margin = BigInt.zero();
  shortPos.leverage = BigInt.zero();
  shortPos.liquidationPrice = BigInt.zero();
  shortPos.isOpen = true;
  shortPos.createdAt = event.block.timestamp;
  shortPos.save();
}

function incrementMatches(): void {
  let stats = Stats.load("global");
  if (!stats) {
    stats = new Stats("global");
    stats.totalVolume = BigInt.zero();
    stats.totalMatches = BigInt.zero();
    stats.totalLiquidations = BigInt.zero();
  }
  stats.totalMatches = stats.totalMatches + BigInt.fromI32(1);
  stats.save();
}

function incrementLiquidations(): void {
  let stats = Stats.load("global");
  if (!stats) {
    stats = new Stats("global");
    stats.totalVolume = BigInt.zero();
    stats.totalMatches = BigInt.zero();
    stats.totalLiquidations = BigInt.zero();
  }
  stats.totalLiquidations = stats.totalLiquidations + BigInt.fromI32(1);
  stats.save();
}
