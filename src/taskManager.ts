import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { PumpFunSDK } from "./pumpfun";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  CreateEvent,
  TradeEvent,
  LimitOrder,
  SniperTask,
  Filter,
} from "./types";
import { v4 as uuid } from "uuid";

export const PRICE_BASE = BigInt(1e9);
const SLIPPAGE_BASIS_POINTS = BigInt(500);
const defaultOptions = {
  priorityFee: {
    unitLimit: 1000,
    unitPrice: 1000_000,
  },
  commitment: "finalized",
};

export class TaskManager {
  sniperTasks: SniperTask[] = [];
  limitOrders: LimitOrder[] = [];
  constructor(public readonly sdk: PumpFunSDK) {}

  async executeOrders(orders: LimitOrder[]) {
    let executedResults;
    for (const order of orders) {
      if (order.isBuy) {
        executedResults = await this.sdk.buy(
          order.keypair,
          order.mint,
          order.solAmount,
          SLIPPAGE_BASIS_POINTS,
          defaultOptions.priorityFee,
        );
      } else {
        executedResults = await this.sdk.sell(
          order.keypair,
          order.mint,
          order.tokenAmount,
          SLIPPAGE_BASIS_POINTS,
          defaultOptions.priorityFee,
        );
      }
      if (executedResults.success) {
        console.log(`Execute successs for orderId: ${order.orderId}`);
      } else {
        console.log("Execute failed");
      }
    }
  }

  public createLimitOrder(
    mint: PublicKey,
    amount: bigint,
    isBuy: boolean,
    limitPrice: bigint,
    keypair: Keypair,
  ) {
    const solAmount = isBuy ? amount : (amount * limitPrice) / PRICE_BASE;
    const tokenAmount = isBuy ? (amount * PRICE_BASE) / limitPrice : amount;
    this.limitOrders.push({
      orderId: uuid(),
      mint,
      isBuy,
      solAmount,
      tokenAmount,
      keypair,
    });
  }

  isOrderMatched(
    limitOrder: LimitOrder,
    mint: PublicKey,
    price: bigint,
  ): boolean {
    const priceMatched = limitOrder.isBuy
      ? limitOrder.solAmount >= (limitOrder.tokenAmount * price) / PRICE_BASE
      : limitOrder.solAmount < (limitOrder.tokenAmount * price) / PRICE_BASE;
    return limitOrder.mint.equals(mint) && priceMatched;
  }

  async processTradeEvent(tradeEvent: TradeEvent) {
    const { solAmount, tokenAmount, mint } = tradeEvent;
    // both of them use the same decimal
    const price =
      tokenAmount == BigInt(0)
        ? BigInt(0)
        : (solAmount * PRICE_BASE) / tokenAmount;

    const triggeredOrder = this.limitOrders.filter((order) =>
      this.isOrderMatched(order, mint, price),
    );
    // skip when no any matched orders
    if (triggeredOrder.length == 0) {
      return;
    }

    await this.executeOrders(triggeredOrder);

    // remove fulfilled orders from orderbook
    const fulfilledOrderIds = new Set();
    triggeredOrder.forEach((order) => fulfilledOrderIds.add(order.orderId));
    this.limitOrders = this.limitOrders.filter(
      (order) => !fulfilledOrderIds.has(order.orderId),
    );
  }

  isTriggeredForCreateEvent(filter: Filter, event: CreateEvent): boolean {
    return filter.ticker == undefined ? true : filter.ticker === event.symbol;
  }

  createSniperTask(buyAmountSol: bigint, keypair: Keypair, ticker?: string) {
    this.sniperTasks.push({
      taskId: uuid(),
      filter: { ticker },
      keypair,
      buyAmountSol,
    });
  }

  async processCreateEvent(event: CreateEvent) {
    // filter tasks
    const triggeredTasks = this.sniperTasks.filter((task) =>
      this.isTriggeredForCreateEvent(task.filter, event),
    );

    // skip when no any triggered tasks
    if (triggeredTasks.length == 0) {
      return;
    }

    for (const task of triggeredTasks) {
      let buyResults = await this.sdk.buy(
        task.keypair,
        event.mint,
        task.buyAmountSol,
        SLIPPAGE_BASIS_POINTS,
        defaultOptions.priorityFee,
      );

      if (buyResults.success) {
        console.log("Buy success");
      } else {
        console.log("Buy failed");
      }
    }
  }

  async start() {
    let createEvent = this.sdk.addEventListener(
      "createEvent",
      async (event, slot, signature) => {
        console.log("createEvent", event);
        await this.processCreateEvent(event);
      },
    );
    console.log("createEvent", createEvent);

    // let tradeEvent = this.sdk.addEventListener(
    // "tradeEvent",
    // async (event: TradeEvent) => {
    // console.log("tradeEvent", event);
    // await this.processTradeEvent(event);
    // },
    // );
    // console.log("tradeEvent", tradeEvent);
  }
}
