#!/usr/bin/env node
import minimist from "minimist";
import Share from "./share.js";
import readline from "readline";
import chalk from "chalk";

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
  debug: true,
});

await share.start();
await share.register("c1", "token:comptabilité");
const retry = () => {
  const cancel = setInterval(async () => {
    console.log(chalk.green("Using..."));
    const usable = await share.use("licence@c1", args.mandate);
    if (usable) {
      setTimeout(async () => {
        await share.release("licence@c1", args.mandate);
        console.log(chalk.green("Using...[DONE]"));
      }, 3000);
    } else {
      console.log(chalk.red("Using...[FAILED]"));
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
