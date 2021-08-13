
AFRAME.registerComponent('np-replicate', {
    schema: {
        'room-hash': {type: Boolean},
    },
    init: function () {
        this.peer: Peer = new Peer();
        this.peer.on("error", (err) => console.error(err));

        this.peer!.on("open", (id) => {
            // Try to parse the room from the hash. If we find one,
            // we are a client.
            const parsedHash = query.parse(window.location.hash);
            const isClient = !!parsedHash.room;
      
            if (isClient) {

            }
        });
    },

    //Use your own  
    update: function () {},
    tick: function () {},
    remove: function () {},
    pause: function () {},
    play: function () {}
});