import "dotenv/config";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { PumpFunSDK, TaskManager, PRICE_BASE } from "../../src";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { getOrCreateKeypair, printSPLBalance } from "../util";

const KEYS_FOLDER = __dirname + "/../basic/.keys";

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
  let taskManager = new TaskManager(sdk);
  const testAccount = getOrCreateKeypair(KEYS_FOLDER, "test-account");
  const mint = getOrCreateKeypair(KEYS_FOLDER, "mint");

  const ticker = "Helix";
  const buyAmountSol = BigInt(0.001 * LAMPORTS_PER_SOL); // sol
  taskManager.createSniperTask(buyAmountSol, testAccount, ticker);

  const amount = BigInt(0.001 * LAMPORTS_PER_SOL); // sol or token
  const limitPrice = BigInt(0.0001 * Number(PRICE_BASE));
  taskManager.createLimitOrder(
    mint.publicKey,
    amount,
    true,
    limitPrice,
    testAccount,
  );

  await taskManager.start();

  let completeEvent = sdk.addEventListener("completeEvent", (event) => {
    console.log("completeEvent", event);
  });
  console.log("completeEvent", completeEvent);
};

main();
