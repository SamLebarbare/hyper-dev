import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import crypto from "crypto";

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
class Share {
  constructor({
    realm = null,
    mandate = "share-0",
    writers = [],
    indexes = [],
  }) {
    this.store = new Corestore(mandate);
    this.swarm = null;
    this.autobase = null;
    this.bee = null;
    this.realm = realm;
    this.writers = writers;
    this.indexes = indexes;
  }

  debugInfo() {
    console.log("Share info:");
    console.log();
    console.log("realm:", this.realm);
    console.log(
      "writers:",
      this.autobase.inputs.map((i) => i.key.toString("hex")).join(" ")
    );
    console.log(
      "indexes:",
      this.autobase.defaultOutputs.map((i) => i.key.toString("hex")).join(" ")
    );
  }

  async start() {
    const writer = this.store.get({ name: "writer" });
    const viewOutput = this.store.get({ name: "view" });
    await writer.ready();
    this.realm = this.realm || writer.key.slice(0, 8).toString("hex");
    this.autobase = new Autobase([writer], { outputs: viewOutput });

    //add remote writers
    for (const w of this.writers) {
      await this.autobase.addInput(this.store.get(Buffer.from(w, "hex")));
    }

    //Default outputs are mainly useful during "remote linearizing",
    //when readers of an Autobase can use them as the "trunk" during linearization,
    //and thus can minimize the amount of local re-processing they need to do during updates.
    for (const i of this.indexes) {
      await this.autobase.addDefaultOutput(
        this.store.get(Buffer.from(i, "hex"))
      );
    }

    await this.autobase.ready();

    const topic = Buffer.from(sha256(`hyper://${this.realm}-share`), "hex");
    this.swarm = Hyperswarm();
    this.swarm.on("connection", (socket) => this.store.replicate(socket));
    this.swarm.join(topic);
    await this.flushSwarm();
    process.once("SIGINT", async () => {
      this.swarm.destroy();
    });

    this.debugInfo();

    const self = this;
    const view = this.autobase.linearize({
      unwrap: true,
      async apply(batch) {
        const b = self.bee.batch({ update: false });

        for (const { value } of batch) {
          const op = JSON.parse(value);

          if (op.type === "register") {
            const id = `licence@${op.hash}`;
            await b.put(id, { id, data: op.data });
          }

          if (op.type === "use") {
            const id = `usage@${op.licenceId}`;
            await b.put(id, { id, user: op.user });
          }

          if (op.type === "release") {
            const id = `usage@${op.licenceId}`;
            await b.del(id);
          }
        }

        await b.flush();
      },
    });

    this.bee = new Hyperbee(view, {
      extension: false,
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });
  }

  flushSwarm() {
    return new Promise((r) => this.swarm.flush(r));
  }

  stop() {
    return new Promise((r) => this.swarm.destroy(r));
  }

  async register(data) {
    const hash = sha256(data);
    await this.autobase.append(
      JSON.stringify({
        type: "register",
        hash,
        data: data,
      })
    );
  }

  async use(licenceId, user) {
    console.log("checking usable:", licenceId);
    const existingLicence = await this.bee.get(licenceId);
    if (existingLicence) {
      const useId = `usage@${licenceId}`;
      const existingUsage = await this.bee.get(useId);
      if (!existingUsage) {
        await this.autobase.append(
          JSON.stringify({
            type: "use",
            licenceId,
            user,
          })
        );
        console.log("used");
      } else {
        console.log("used by:", existingUsage.value.user);
      }
    } else {
      console.log("licence not found!");
    }
  }

  async release(licenceId) {
    console.log("checking usable:", licenceId);
    const existingLicence = await this.bee.get(licenceId);
    if (existingLicence) {
      const useId = `usage@${licenceId}`;
      const existingUsage = await this.bee.get(useId);
      if (existingUsage) {
        await this.autobase.append(
          JSON.stringify({
            type: "release",
            licenceId,
          })
        );
        console.log("released");
      } else {
        console.log("not used");
      }
    } else {
      console.log("licence not found!");
    }
  }

  async *allRegistered() {
    for await (const data of this.bee.createReadStream({
      gt: "licence@",
      lt: "licence@~",
    })) {
      yield data.value;
    }
  }

  async *allUsage() {
    for await (const data of this.bee.createReadStream({
      gt: "usage@",
      lt: "usage@~",
    })) {
      yield data.value;
    }
  }
}

export default Share;
