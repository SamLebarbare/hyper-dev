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
    this.realmSwarm = null;
    this.autobase = null;
    this.bee = null;
    this.view = null;
    this.realm = realm;
    this.writers = writers;
    this.indexes = indexes;
    this.peers = new Set();
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

    await this.autobase.ready();

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
          case "join":
            const { writer, index } = payload;
            await this.autobase.addInput(
              this.store.get(Buffer.from(writer, "hex"))
            );
            await this.autobase.addDefaultOutput(
              this.store.get(Buffer.from(index, "hex"))
            );
            this.update(true);
          case "rebase":
            this.update(true);
        }
      });

      socket.on("error", (err) => {
        console.log("realm peer errored:", err);
      });
      socket.on("close", () => {
        console.log("realm peer fully left");
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

    this.debugInfo();
    await this.update();
  }

  async update(remote) {
    const self = this;
    this.view = this.autobase.linearize({
      unwrap: true,
      async apply(batch) {
        const b = self.bee.batch({ update: false });

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
      },
    });

    this.bee = new Hyperbee(this.view, {
      extension: false,
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });

    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤ LICENCES ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
    for await (const data of this.allRegistered()) {
      console.log(data);
    }
    console.log("\n◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤ IN-USE ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢\n");
    for await (const data of this.allUsage()) {
      console.log(data);
    }

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
        await this.update();
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
        await this.update();
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
