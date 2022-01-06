#!/usr/bin/env node
import minimist from "minimist";
import Share from "./share.js";
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
for await (const data of share.allRegistered()) {
  console.log(data);
}
for await (const data of share.allUsage()) {
  console.log(data);
}
await share.use(args.licence, require("os").hostname());
await share.stop();
