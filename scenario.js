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
    debug: "d",
  },
  default: {
    mandate: "share-0",
    debug: false,
  },
});

const share = new Share({
  realm: args.realm,
  mandate: args.mandate,
  writers: args.writers?.split(","),
  indexes: args.indexes?.split(","),
  debug: args.debug,
});

await share.start();
await share.register("c1", "token:comptabilité");
const retry = async () => {
  console.log(chalk.green("Try using..."));
  const usable = await share.use("licence@c1", args.mandate);
  console.log(chalk.green("usable:", usable));
  if (usable) {
    console.log(chalk.green("start using for 10sec"));
    setTimeout(async () => {
      await share.release("licence@c1", args.mandate);
      console.log(chalk.green("Using...[DONE]"));
      setTimeout(retry, 5000);
    }, 10000);
  } else {
    console.log(chalk.red("Using...[FAILED]"));
    setTimeout(retry, 2000);
  }
};

retry();
console.log("server running, press [enter] to leave");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const close = () => new Promise((r) => rl.once("close", r));
await close();
await share.stop();
