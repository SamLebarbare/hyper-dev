#!/usr/bin/env node
import minimist from "minimist";
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
  writers: args.writers,
  indexes: args.indexes,
});

await share.start();
await share.register("token:comptabilité");
await share.register("token:salaire");
await share.register("token:facturation");
for await (const data of share.allRegistered()) {
  console.log(data);
}
await share.stop();
