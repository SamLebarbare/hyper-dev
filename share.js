import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import crypto from "crypto";
import chalk from "chalk";

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
class Share {
  constructor({
    realm = null,
    mandate = "share-0",
    writers = [],
    indexes = [],
    debug = true,
  }) {
    this.store = new Corestore(mandate);
    this.swarm = null;
    this.realmSwarm = null;
    this.autobase = null;
    this.bee = null;
    this.realm = realm;
    this.writers = writers;
    this.indexes = indexes;
    this.peers = new Set();
    this.peersData = new WeakMap();
    this.debug = debug;
  }

  async debugInfo() {
    if (!this.debug) {
      return;
    }
    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤ SHARE INFO ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
    console.log();
    console.log("realm:", this.realm);
    console.log("peers:", this.peers.size);
    console.log(
      "writers:",
      this.autobase.inputs.map((i) => i.key.toString("hex")).join(" ")
    );
    console.log(
      "indexes:",
      this.autobase.outputs.map((i) => i.key.toString("hex")).join(" ")
    );
    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤ LICENCES ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
    for await (const data of this.allRegistered()) {
      console.log(data);
    }
    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤ IN-USE ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
    for await (const data of this.allUsage()) {
      console.log(data);
    }
    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
  }

  async start() {
    const writer = this.store.get({ name: "writer" });
    const viewOutput = this.store.get({ name: "view" });
    await writer.ready();
    this.realm = this.realm || writer.key.slice(0, 8).toString("hex");

    this.autobase = new Autobase({
      localInput: writer,
      localOutput: viewOutput,
    });

    this.autobase.start({
      unwrap: true,
      apply: this.apply.bind(this),
    });

    await this.autobase.ready();
    await this.autobase.view.update();

    const hyperStoreTopic = Buffer.from(sha256(`hyper://licence-store`), "hex");
    const realmTopic = Buffer.from(sha256(`hyper://licence-realm`), "hex");
    this.swarm = new Hyperswarm();
    this.realmSwarm = new Hyperswarm();
    this.realmSwarm.on("connection", async (socket) => {
      this.peers.add(socket);
      console.log("realm received connection!");
      socket.write(
        JSON.stringify({
          type: "join",
          writer: writer.key.toString("hex"),
          index: viewOutput.key.toString("hex"),
        })
      );

      socket.on("data", async (data) => {
        const payload = JSON.parse(data.toString());
        switch (payload.type) {
          case "join": {
            const { writer, index } = payload;
            this.peersData.set(socket, { writer, index });
            await this.autobase.addInput(
              this.store.get(Buffer.from(writer, "hex"))
            );
            await this.autobase.addOutput(
              this.store.get(Buffer.from(index, "hex"))
            );
            this.update(true);
            break;
          }
          case "rebase": {
            this.update(true);
            break;
          }
        }
      });

      socket.on("error", (err) => {
        console.log("realm peer errored:", err);
      });
      socket.on("close", async () => {
        console.log("realm peer fully left");
        const { writer, index } = this.peersData.get(socket);
        await this.autobase.removeInput(
          this.store.get(Buffer.from(writer, "hex"))
        );
        await this.autobase.removeOutput(
          this.store.get(Buffer.from(index, "hex"))
        );
        this.peers.delete(socket);
      });
    });

    this.swarm.on("connection", (socket) => {
      this.store.replicate(socket);
    });

    this.realmSwarm.join(realmTopic);
    this.swarm.join(hyperStoreTopic);
    await this.swarm.flush();
    await this.realmSwarm.flush();
    process.once("SIGINT", async () => {
      this.swarm.destroy();
      this.realmSwarm.destroy();
    });

    await this.update();
  }

  async apply(batch, clocks, change) {
    const b = this.bee.batch({ update: false });

    for (const { value } of batch) {
      const op = JSON.parse(value);

      if (op.type === "register") {
        const id = `licence@${op.id}`;
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
  }

  async update(remote) {
    if (!this.autobase.view) {
      return;
    }
    await this.autobase.view.update();
    this.bee = new Hyperbee(this.autobase.view, {
      extension: false,
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });

    await this.debugInfo();

    if (!remote) {
      this.notify();
    }
  }

  notify() {
    for (const peer of this.peers) {
      peer.write(
        JSON.stringify({
          type: "rebase",
        })
      );
    }
  }

  stop() {
    console.log("stopping...");
    process.exit();
  }

  async register(id, data) {
    const hash = sha256(data);
    await this.autobase.append(
      JSON.stringify({
        type: "register",
        id,
        data: data,
      })
    );
    await this.update();
  }

  async use(licenceId, user) {
    let usable = false;
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
        await this.update();
        console.log(chalk.green("used by:", user));
        usable = true;
      } else {
        console.log(chalk.red("used by:"), existingUsage.value.user);
      }
    } else {
      console.log("licence not found!");
    }
    return usable;
  }

  async release(licenceId) {
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
        await this.update();
        console.log(chalk.green("released", licenceId));
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
