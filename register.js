#!/usr/bin/env node
import minimist from "minimist";
import readline from "readline";
import Share from "./share.js";
const args = minimist(process.argv, {
  alias: {
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
//await share.register("s1", "token:salaire");
//await share.register("f1", "token:facturation");

console.log("server running, ctrl+c for stopping");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const close = () => new Promise((r) => rl.once("close", r));
await close();
await share.stop();
