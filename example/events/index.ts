import "dotenv/config";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { PumpFunSDK } from "../../src";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { getOrCreateKeypair, printSPLBalance } from "../util";
import { CreateEvent, TradeEvent } from "../../src/types";
import { v4 as uuid } from "uuid";

const KEYS_FOLDER = __dirname + "/../basic/.keys";
const SLIPPAGE_BASIS_POINTS = BigInt(500);
const PRICE_BASE = BigInt(1e9);
const defaultOptions = {
  priorityFee: {
    unitLimit: 1000,
    unitPrice: 1000_000,
  },
  commitment: "finalized",
};

interface Filter {
  ticker: string;
  caseSensetive?: boolean;
  mint?: PublicKey;
}

interface SniperTask {
  taskId: string;
  filter: Filter;
  keypair: Keypair;
  buyAmountSol: bigint;
}

let sniperTasks: SniperTask[] = [];

function isTriggeredForCreateEvent(
  filter: Filter,
  event: CreateEvent,
): boolean {
  return filter.ticker === event.symbol;
}

function createSniperTask(
  ticker: string,
  buyAmountSol: bigint,
  keypair: Keypair,
) {
  sniperTasks.push({
    taskId: uuid(),
    filter: { ticker },
    keypair,
    buyAmountSol,
  });
}

async function processCreateEvent(sdk: PumpFunSDK, event: CreateEvent) {
  // filter tasks
  const triggeredTasks = sniperTasks.filter((task) =>
    isTriggeredForCreateEvent(task.filter, event),
  );

  // skip when no any triggered tasks
  if(triggeredTasks.length==0) {
      return;
  }

  for (const task of triggeredTasks) {
    let buyResults = await sdk.buy(
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

interface LimitOrder {
  orderId: string;
  isBuy: boolean;
  mint: PublicKey;
  solAmount: bigint;
  tokenAmount: bigint;
  keypair: Keypair;
}
let limitOrders: LimitOrder[] = [];

function createLimitOrder(
  mint: PublicKey,
  amount: bigint,
  isBuy: boolean,
  limitPrice: bigint,
  keypair: Keypair,
) {
  const solAmount = isBuy ? amount : amount * limitPrice/PRICE_BASE;
  const tokenAmount = isBuy ? amount * PRICE_BASE/ limitPrice : amount;
  limitOrders.push({
    orderId: uuid(),
    mint,
    isBuy,
    solAmount,
    tokenAmount,
    keypair,
  });
}

function isTriggered(limitOrder: LimitOrder, price: bigint): boolean {
  return limitOrder.isBuy
    ? limitOrder.solAmount >= limitOrder.tokenAmount * price / PRICE_BASE
    : limitOrder.solAmount < limitOrder.tokenAmount * price / PRICE_BASE;
}

async function processTradeEvent(sdk: PumpFunSDK, tradeEvent: TradeEvent) {
  const { solAmount, tokenAmount, mint } = tradeEvent;
  // both of them use the same decimal
  const price = tokenAmount? BigInt(0): solAmount * PRICE_BASE / tokenAmount;

  const triggeredOrder = limitOrders.filter(
    (order) => order.mint.equals(mint) && isTriggered(order, price),
  );
  // skip when no any matched orders
  if(triggeredOrder.length==0){
      return;
  }

  await executeOrders(sdk, triggeredOrder);

  // remove fulfilled orders from orderbook
  const fulfilledOrderIds = new Set();
  triggeredOrder.forEach(order=>fulfilledOrderIds.add(order.orderId));
  limitOrders = limitOrders.filter(
    (order) => !fulfilledOrderIds.has(order.orderId),
  );
}

async function executeOrders(sdk: PumpFunSDK, orders: LimitOrder[]) {
  let executedResults;
  for (const order of orders) {
    if (order.isBuy) {
      executedResults = await sdk.buy(
        order.keypair,
        order.mint,
        order.solAmount,
        SLIPPAGE_BASIS_POINTS,
        defaultOptions.priorityFee,
      );
    } else {
      executedResults = await sdk.sell(
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

const main = async () => {
  if (!process.env.HELIUS_RPC_URL) {
    console.error("Please set HELIUS_RPC_URL in .env file");
    console.error(
      "Example: HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your api key>",
    );
    console.error("Get one at: https://www.helius.dev");
    return;
  }

  let connection = new Connection(process.env.HELIUS_RPC_URL || "");

  let wallet = new NodeWallet(new Keypair()); //note this is not used
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "finalized",
  });

  let sdk = new PumpFunSDK(provider);
  const testAccount = getOrCreateKeypair(KEYS_FOLDER, "test-account");
  const mint = getOrCreateKeypair(KEYS_FOLDER, "mint");

  const ticker = "GREENZ";
  const buyAmountSol = BigInt(0.001 * LAMPORTS_PER_SOL); // sol
  createSniperTask(ticker, buyAmountSol, testAccount);

  const amount = BigInt(0.001 * LAMPORTS_PER_SOL); // sol or token
  const limitPrice = BigInt(0.0001 * Number(PRICE_BASE));
  createLimitOrder(mint.publicKey, amount, true, limitPrice, testAccount);

  let createEvent = sdk.addEventListener(
    "createEvent",
    async (event, slot, signature) => {
      console.log("createEvent", event);
      await processCreateEvent(sdk, event);
    },
  );
  console.log("createEvent", createEvent);

  let tradeEvent = sdk.addEventListener(
    "tradeEvent",
    async (event: TradeEvent) => {
      // console.log("tradeEvent", event);
      await processTradeEvent(sdk, event);
    },
  );
  console.log("tradeEvent", tradeEvent);

  // let completeEvent = sdk.addEventListener("completeEvent", (event) => {
  // console.log("completeEvent", event);
  // });
  // console.log("completeEvent", completeEvent);
};

main();
