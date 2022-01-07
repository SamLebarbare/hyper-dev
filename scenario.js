#!/usr/bin/env node
import minimist from "minimist";
import Share from "./share.js";
import readline from "readline";
import os from "os";

const args = minimist(process.argv, {
  alias: {
    licence: "l",
    mandate: "m",
    writers: "w",
    indexes: "i",
    realm: "r",
  },
  default: {
    mandate: "share-0",
  },
});

const share = new Share({
  realm: args.realm,
  mandate: args.mandate,
  writers: args.writers?.split(","),
  indexes: args.indexes?.split(","),
});

await share.start();
await share.register("c1", "token:comptabilité");
const retry = () => {
  const cancel = setInterval(async () => {
    console.log("Try using licence@c1");
    const usable = await share.use("licence@c1", args.mandate);
    if (usable) {
      console.log("Using...");
      setTimeout(async () => {
        await share.release("licence@c1", args.mandate);
        console.log("Using...[DONE]");
      }, 3000);
    } else {
      console.log("Cannot use licence@c1");
      clearInterval(cancel);
      setTimeout(retry, 2000);
    }
  }, 5000);
};

retry();
console.log("server running, ctrl+c for stopping");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const close = () => new Promise((r) => rl.once("close", r));
await close();
await share.release("licence@c1", args.mandate);
await share.stop();
