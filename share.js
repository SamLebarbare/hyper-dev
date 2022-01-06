import minimist from "minimist";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Autobase from "autobase";

const args = minimist(process.argv, {
  alias: {
    inventory: "i",
    name: "n",
  },
  default: {
    inventory: "share-0",
  },
});

class Share {
  constructor() {
    this.store = new Corestore(args.inventory);
    this.swarm = null;
    this.autobase = null;
    this.name = null;
  }

  async start() {
    const writer = this.store.get({ name: "writer" });
    const viewOutput = this.store.get({ name: "view" });
    await writer.ready();
    this.name = args.name || writer.key.slice(0, 8).toString("hex");
    this.autobase = new Autobase([writer], { outputs: viewOutput });
  }
}
