import Peer from "peerjs";
import * as query from "query-string";
import * as QRCode from "qrcode";

import { NetplayPlayer, NetplayState } from "./types";
import { LockstepNetcode } from "./netcode/lockstep";
import { RollbackNetcode } from "./netcode/rollback";


AFRAME.registerComponent('netplay-scene', {
    schema: {
        // Should this component use the room hash window location functionality
        roomHash: {type: Boolean, default: false},
        peerOpen: {type: Boolean, default: false},
        peerId: {type: Boolean, default: ''},
        rollback: {type: String, default: true}
    },
    init: function () {

        let el = this.el;
        let data = this.data;

        this.peer: Peer = new Peer();
        this.peer.on("error", (err) => console.error(err));

        this.peer!.on("open", (id) => {
            
            data.peerId = id;
            data.peerOpen = true;
            el.emit('peerOpen', {}, false);
            // document.querySelector("a-scene").getAttribute("netplay-scene").peerOpen

            if(data.roomHash){
                // Try to parse the room from the hash. If we find one,
                // we are a client.
                const parsedHash = query.parse(window.location.hash);
                const isClient = !!parsedHash.room;
          
                if (isClient) {
                    this.ClientJoin(parsedHash.room)
                }else{
                    this.Host();
                }
            }
        });
    },

    //Use your own  logic to start connections
    Host: function(){
        // We are not ready to start hosting
        if(!this.data.peerOpen){
            return;
        }

        let joinURL = `${window.location.href}#room=${id}`;
        console.log("join url", joinURL);

        const players: Array<NetplayPlayer> = [
            new NetplayPlayer(0, true, true), // Player 0 is us, acting as a host.
            new NetplayPlayer(1, false, false), // Player 1 is our peer, acting as a client.
        ];
  
          // Wait for a connection from a client.
        this.peer!.on("connection", (conn) => {
            // Make the menu disappear.
            conn.on("error", (err) => console.error(err));
            if(this.data.rollback){
                this.rollbackStartHost(players, conn);
            }else{
                this.lockstepStartHost(players, conn);
            }
        });
    },

    JoinQRCode: function(canvas: HTMLCanvasElement){
        if(!this.data.peerOpen){
            return;
        }
        // TODO: Check if we are host also
        let joinURL = `${window.location.href}#room=${this.data.peerId}`;
        QRCode.toCanvas(qrCanvas, joinURL);
    },

    ClientJoin: function(hostId){

        if(!this.data.peerOpen){
            return;
        }

        console.info(`Connecting to room ${hostId}.`);

        const conn = this.peer!.connect(hostId as string, {
          serialization: "json",
          reliable: true,
          // @ts-ignore
          _payload: {
            // This is a hack to get around a bug in PeerJS
            originator: true,
            reliable: true,
          },
        });

        conn.on("error", (err) => console.error(err));

        // Construct the players array.
        const players = [
          new NetplayPlayer(0, false, true), // Player 0 is our peer, the host.
          new NetplayPlayer(1, true, false), // Player 1 is us, a client
        ];

        if(this.data.rollback){
            this.rollbackStartClient(players, conn);
        }else{
            this.lockstepStartClient(players, conn);
        }
    },

    rollbackStartHost: function(players: Array<NetplayPlayer>, conn: Peer.DataConnection){
        this.rollbackNetcode = new RollbackNetcode(
            true,
            this.game!,
            players,
            this.getInitialInputs(players),
            10,
            this.pingMeasure,
            this.gameClass.timestep,
            () => this.inputReader.getInput(),
            (frame, input) => {
              conn.send({ type: "input", frame: frame, input: input.serialize() });
            },
            (frame, state) => {
              conn.send({ type: "state", frame: frame, state: state });
            }
        );
      
        conn.on("data", (data) => {
            if (data.type === "input") {
              let input = new DefaultInput();
              input.deserialize(data.input);
              this.rollbackNetcode!.onRemoteInput(data.frame, players![1], input);
            } else if (data.type == "ping-req") {
              conn.send({ type: "ping-resp", sent_time: data.sent_time });
            } else if (data.type == "ping-resp") {
              this.pingMeasure.update(Date.now() - data.sent_time);
            }
        });
      
        conn.on("open", () => {
            console.log("Client has connected... Starting game...");
            this.checkChannel(conn.dataChannel);
      
            setInterval(() => {
              conn.send({ type: "ping-req", sent_time: Date.now() });
            }, PING_INTERVAL);
      
            this.startGameLoop();
          });
    },

    rollbackStartClient: function(players: Array<NetplayPlayer>, conn: Peer.DataConnection){
        this.rollbackNetcode = new RollbackNetcode(
            false,
            this.game!,
            players,
            this.getInitialInputs(players),
            10,
            this.pingMeasure,
            this.gameClass.timestep,
            () => this.inputReader.getInput(),
            (frame, input) => {
              conn.send({ type: "input", frame: frame, input: input.serialize() });
            }
        );
      
        conn.on("data", (data) => {
            if (data.type === "input") {
              let input = new DefaultInput();
              input.deserialize(data.input);
              this.rollbackNetcode!.onRemoteInput(data.frame, players![0], input);
            } else if (data.type === "state") {
              this.rollbackNetcode!.onStateSync(data.frame, data.state);
            } else if (data.type == "ping-req") {
              conn.send({ type: "ping-resp", sent_time: data.sent_time });
            } else if (data.type == "ping-resp") {
              this.pingMeasure.update(Date.now() - data.sent_time);
            }
        });

        conn.on("open", () => {
            console.log("Successfully connected to server... Starting game...");
            this.checkChannel(conn.dataChannel);
      
            setInterval(() => {
              conn.send({ type: "ping-req", sent_time: Date.now() });
            }, PING_INTERVAL);
      
            this.startGameLoop();
        });
    },

    lockstepStartClient: function(players: Array<NetplayPlayer>, conn: Peer.DataConnection){
        this.lockstepNetcode = new LockstepNetcode(
            false,
            this.game!,
            players,
            this.gameClass.timestep,
            this.getStateSyncPeriod(),
            () => this.inputReader.getInput(),
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
              this.lockstepNetcode!.onStateSync(data.frame, data.state);
            } else if (data.type == "ping-req") {
              conn.send({ type: "ping-resp", sent_time: data.sent_time });
            } else if (data.type == "ping-resp") {
              this.pingMeasure.update(Date.now() - data.sent_time);
            }
        });

        conn.on("open", () => {
            console.log("Successfully connected to server... Starting game...");
            this.checkChannel(conn.dataChannel);
      
            setInterval(() => {
              conn.send({ type: "ping-req", sent_time: Date.now() });
            }, PING_INTERVAL);
      
            this.startGameLoop();
        });
    },
    lockstepStartHost: function(players: Array<NetplayPlayer>, conn: Peer.DataConnection){
        this.lockstepNetcode = new LockstepNetcode(
            true,
            this.game!,
            players,
            this.gameClass.timestep,
            this.getStateSyncPeriod(),
            () => this.inputReader.getInput(),
            (frame, input) => {
              conn.send({ type: "input", frame: frame, input: input.serialize() });
            },
            (frame, state) => {
              conn.send({ type: "state", frame: frame, state: state });
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
            this.checkChannel(conn.dataChannel);
      
            setInterval(() => {
              conn.send({ type: "ping-req", sent_time: Date.now() });
            }, PING_INTERVAL);
      
            this.startGameLoop();
        });
    },

    update: function () {},
    tick: function () {},
    remove: function () {},
    pause: function () {},
    play: function () {}
});