import Peer from "peerjs";
import { DefaultInput, DefaultInputReader } from "./defaultinput";
import EWMASD from "./ewmasd";
import { LockstepNetcode } from "./netcode/lockstep";
import { NetplayPlayer, NetplayState } from "./types";

import * as log from "loglevel";
import { GameWrapper } from "./gamewrapper";
import { Game, GameClass } from "./game";

const PING_INTERVAL = 100;

export class LockstepWrapper extends GameWrapper {
  pingMeasure: EWMASD = new EWMASD(0.2);
  game?: Game;
  lockstepNetcode?: LockstepNetcode<Game, DefaultInput>;

  constructor(gameClass: GameClass) {
    super(gameClass);
  }

  startHost(players: Array<NetplayPlayer>, conn: Peer.DataConnection) {
    log.info("Starting a lcokstep host.");

    this.game = new this.gameClass(this.canvas, players);

    this.lockstepNetcode = new LockstepNetcode(
      true,
      this.game!,
      players,
      (frame, input) => {
        conn.send({ type: "input", frame: frame, input: input.serialize() });
      }
    );

    conn.on("data", (data) => {
      if (data.type === "input") {
        let input = new DefaultInput();
        input.deserialize(data.input);

        this.lockstepNetcode!.onRemoteInput(data.frame, players![1], input);
      } else if (data.type == "ping-req") {
        conn.send({ type: "ping-resp", sent_time: data.sent_time });
      } else if (data.type == "ping-resp") {
        this.pingMeasure.update(Date.now() - data.sent_time);
      }
    });

    conn.on("open", () => {
      console.log("Client has connected... Starting game...");

      setInterval(() => {
        conn.send({ type: "ping-req", sent_time: Date.now() });
      }, PING_INTERVAL);

      this.startGameLoop();
    });
  }

  startClient(players: Array<NetplayPlayer>, conn: Peer.DataConnection) {
    log.info("Starting a lockstep client.");

    this.game = new this.gameClass(this.canvas, players);
    this.lockstepNetcode = new LockstepNetcode(
      false,
      this.game!,
      players,
      (frame, input) => {
        conn.send({ type: "input", frame: frame, input: input.serialize() });
      }
    );

    conn.on("data", (data) => {
      if (data.type === "input") {
        let input = new DefaultInput();
        input.deserialize(data.input);

        this.lockstepNetcode!.onRemoteInput(data.frame, players![0], input);
      } else if (data.type === "state") {
        //   netplayManager!.onStateSync(data.frame, data.state);
      } else if (data.type == "ping-req") {
        conn.send({ type: "ping-resp", sent_time: data.sent_time });
      } else if (data.type == "ping-resp") {
        this.pingMeasure.update(Date.now() - data.sent_time);
      }
    });
    conn.on("open", () => {
      console.log("Successfully connected to server... Starting game...");

      setInterval(() => {
        conn.send({ type: "ping-req", sent_time: Date.now() });
      }, PING_INTERVAL);

      this.startGameLoop();
    });
  }

  startGameLoop() {
    this.stats.style.display = "inherit";

    const timestep = this.gameClass.timestep;
    let lastFrameTime = null;

    let animate = (timestamp) => {
      if (!lastFrameTime) lastFrameTime = timestamp;

      if (timestamp - lastFrameTime! >= Math.floor(timestep)) {
        // Tick state forward.
        let input = this.inputReader.getInput();
        this.lockstepNetcode!.tick(input);

        // Draw state to canvas.
        this.game!.draw(this.canvas);

        // Update stats
        this.stats.innerHTML = `
        <div>Netcode Algorithm: Lockstep</div>
        <div>Timestep: ${timestamp - lastFrameTime!}</div>
        <div>Ping: ${this.pingMeasure
          .average()
          .toFixed(2)} ms +/- ${this.pingMeasure.stddev().toFixed(2)} ms</div>
        <div>Frame Number: ${this.lockstepNetcode!.frame}</div>
        `;

        lastFrameTime = timestamp;
      }

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}