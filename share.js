import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import crypto from "crypto";
import chalk from "chalk";
import AutoQueue from "./auto-queue.js";

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
    this.hyperStoreTopic = null;
    this.realmTopic = null;
    this.writers = writers;
    this.indexes = indexes;
    this.peers = new Set();
    this.peersData = new WeakMap();
    this.debug = debug;
    this.cancellationByLicence = new Map();
    this.ready = false;
    this.updateQueue = new AutoQueue();
  }

  ///////////////////CONSOLE OUTPUTS////////////////
  async debugInfo() {
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

  async info() {
    let count = 0;
    for await (const data of this.allUsage()) {
      console.log();
      console.log(chalk.green("USED BY:", data.user, data.licenceId));
      count++;
    }
    if (count === 0) {
      console.log(chalk.green("FREE"));
    }
  }

  ///////////////////SHARE SYNC////////////////
  async start() {
    const writer = this.store.get({ name: "writer" });
    const viewOutput = this.store.get({ name: "view" });
    await writer.ready();
    this.realm = this.realm || writer.key.slice(0, 8).toString("hex");

    this.autobase = new Autobase({
      inputs: [writer],
      outputs: [viewOutput],
      localInput: writer,
      localOutput: viewOutput,
    });

    this.autobase.start({
      unwrap: true,
      apply: this.apply.bind(this),
    });

    await this.autobase.ready();

    this.bee = new Hyperbee(this.autobase.view, {
      extension: false,
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });

    this.hyperStoreTopic = Buffer.from(sha256(`hyper://licence-store`), "hex");
    this.realmTopic = Buffer.from(sha256(`hyper://licence-realm`), "hex");
    console.log("realm-topic:", this.realmTopic.toString("hex"));
    this.swarm = new Hyperswarm();
    this.realmSwarm = new Hyperswarm({
      dht: this.swarm.dht,
    });
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
            await this.autobase.ready();
            await this.autobase.addInput(
              this.store.get(Buffer.from(writer, "hex"))
            );
            await this.autobase.addOutput(
              this.store.get(Buffer.from(index, "hex"))
            );
            this.updateQueue.enqueue(this.update(true));
            break;
          }
          case "rebase": {
            this.updateQueue.enqueue(this.update(true));
            break;
          }
        }
      });

      socket.on("error", async () => {
        socket.end();
      });

      socket.on("close", async () => {
        await this.removePeer(socket);
      });
    });

    this.swarm.on("connection", (socket) => {
      this.store.replicate(socket);
    });

    this.realmSwarm.join(this.realmTopic);
    this.swarm.join(this.hyperStoreTopic);
    await this.flushSwarms();
    process.once("SIGINT", async () => {
      this.stop();
    });

    await this.updateQueue.enqueue(this.update());
    this.ready = true;
  }

  async flushSwarms() {
    await this.swarm.flush();
    await this.realmSwarm.flush();
  }

  async apply(batch, clocks, change) {
    const b = this.bee.batch({ update: false });

    for (const { value } of batch) {
      const op = JSON.parse(value);
      if (this.debug) {
        console.log("OP:", op);
      }
      if (op.type === "register") {
        const id = `licence@${op.id}`;
        await this.insert(b, id, { id, data: op.data });
      }

      if (op.type === "use") {
        const id = `usage@${op.licenceId}`;
        await this.upsert(b, id, {
          id,
          user: op.user,
          licenceId: op.licenceId,
        });
      }

      if (op.type === "release") {
        const id = `usage@${op.licenceId}`;
        await this.remove(b, id);
      }
    }

    await b.flush();
  }

  async upsert(b, id, value) {
    await b.put(id, value);
  }

  async insert(b, id, value) {
    const existing = await b.get(id, { update: false });
    if (!existing) {
      await b.put(id, value);
    }
  }

  async remove(b, id) {
    const existing = await b.get(id, { update: false });
    if (existing) {
      await b.del(id);
    }
  }

  update(remote) {
    return () =>
      new Promise(async (r) => {
        if (remote && !this.ready) {
          r();
          return;
        }
        console.log("in queue:", this.updateQueue.size);
        console.log("updating...");
        await this.flushSwarms();
        await this.autobase.ready();
        await this.autobase.view.update();
        console.log("updating...[DONE]");
        if (remote) {
          //register auto release of remote usage
          for await (const data of this.allUsage()) {
            this.addAutoRelease(data.licenceId);
          }
        }

        if (this.debug) {
          await this.debugInfo();
        } else {
          await this.info();
        }
        if (!remote) {
          this.notify();
        }
        r();
      });
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

  ///////////////////AUTO-RELEASE////////////////
  cancelAutoRelease(licenceId) {
    const cancel = this.cancellationByLicence.get(licenceId);
    if (cancel) {
      clearTimeout(cancel);
      this.cancellationByLicence.delete(licenceId);
      console.log("auto-release cancelled for:", licenceId);
    }
  }

  addAutoRelease(licenceId) {
    this.cancelAutoRelease(licenceId);
    console.log(chalk.green("auto-release in 20s for:", licenceId));
    this.cancellationByLicence.set(
      licenceId,
      setTimeout(async () => {
        console.log(chalk.red("auto-releasing:", licenceId));
        await this.autobase.append(
          JSON.stringify({
            type: "release",
            licenceId,
          })
        );
        console.log(chalk.green("released", licenceId));
        await this.updateQueue.enqueue(this.update());
      }, 20000)
    );
  }

  ///////////////////SHARE API////////////////
  async register(id, data) {
    const hash = sha256(data);
    await this.autobase.append(
      JSON.stringify({
        type: "register",
        id,
        data: data,
      })
    );
    await this.updateQueue.enqueue(this.update());
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
        await this.updateQueue.enqueue(this.update());
        console.log(chalk.green("new usage:", licenceId, user));
        usable = true;
      } else {
        const currentUser = existingUsage.value.user;
        if (user === currentUser) {
          console.log(chalk.green("renew usage:", licenceId, user));
          this.cancelAutoRelease(licenceId);
          await this.autobase.append(
            JSON.stringify({
              type: "use",
              licenceId,
              user,
            })
          );
          usable = true;
        } else {
          console.log(chalk.red("used by:"), existingUsage.value.user);
        }
      }
    } else {
      console.log("licence not found!");
    }
    return usable;
  }

  async release(licenceId) {
    console.log(chalk.green("try releasing:", licenceId));
    const existingLicence = await this.bee.get(licenceId);
    if (existingLicence) {
      const useId = `usage@${licenceId}`;
      const existingUsage = await this.bee.get(useId);
      if (existingUsage) {
        console.log(chalk.green("releasing:", licenceId));
        await this.autobase.append(
          JSON.stringify({
            type: "release",
            licenceId,
          })
        );
        console.log(chalk.green("released", licenceId));
        await this.updateQueue.enqueue(this.update());
      } else {
        console.log("not used");
      }
    } else {
      console.log("licence not found!");
    }
  }

  ///////////////////QUERIES////////////////
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

  ///////////////////DISPOSER////////////////
  async removePeer(socket) {
    console.log("Removing peer!");
    const { writer, index } = this.peersData.get(socket);
    await this.autobase.removeInput(this.store.get(Buffer.from(writer, "hex")));
    await this.autobase.removeOutput(this.store.get(Buffer.from(index, "hex")));
    this.peers.delete(socket);
    await this.updateQueue.enqueue(this.update(true));
  }

  async stop() {
    console.log("stopping...");
    await this.realmSwarm.leave(this.realmTopic);
    await this.swarm.leave(this.hyperStoreTopic);

    this.swarm.destroy();
    this.realmSwarm.destroy();
    process.exit();
  }
}

export default Share;
