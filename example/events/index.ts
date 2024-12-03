import dotenv from "dotenv";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PumpFunSDK } from "../../src";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";
import { getOrCreateKeypair, printSPLBalance } from '../util'
import { CreateEvent } from '../../src/types'

const KEYS_FOLDER = __dirname + "/.keys";
const SLIPPAGE_BASIS_POINTS = 100n;
const main = async () => {
  dotenv.config();

  if (!process.env.HELIUS_RPC_URL) {
    console.error("Please set HELIUS_RPC_URL in .env file");
    console.error(
      "Example: HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your api key>"
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

  let createEvent = sdk.addEventListener("createEvent", async (event: CreateEvent) => {
      if(event.symbol=="kylia" || event.symbol=="zanoza") {
      console.log(event)
    let buyResults = await sdk.buy(
      testAccount,
      event.mint,
      BigInt(0.0001 * LAMPORTS_PER_SOL),
      SLIPPAGE_BASIS_POINTS,
      {
        unitLimit: 250000,
        unitPrice: 250000,
      },
    );

    if (buyResults.success) {
      printSPLBalance(connection, event.mint, testAccount.publicKey);
      console.log("Bonding curve after buy", await sdk.getBondingCurveAccount(event.mint));
    } else {
      console.log("Buy failed");
    }
      }
  });
  // console.log("createEvent", createEvent);

  // let tradeEvent = sdk.addEventListener("tradeEvent", (event) => {
    // console.log("tradeEvent", event);
  // });
  // console.log("tradeEvent", tradeEvent);

  // let completeEvent = sdk.addEventListener("completeEvent", (event) => {
    // console.log("completeEvent", event);
  // });
  // console.log("completeEvent", completeEvent);
};

main();
