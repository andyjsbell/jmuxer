const Client = require('./client.js');
const WebSocket = require('ws');
const fs = require('fs');

let path = 'video.mp4';

fs.open(path, 'w', function(err, fd) {
    if (err) {
        throw 'could not open file: ' + err;
    }

    let client = new Client({
        node: 'player',
        mode: 'video',
        flushingTime: 1000,
        fps: 30,
        debug: true,
        file: fd,
    });

    let socketURL = 'ws://localhost:9001/socket';
    // let socketURL = 'ws://localhost:8080';
    const ws = new WebSocket(socketURL);
    ws.binaryType = 'arraybuffer';

    function requestFrame(ws) {
        const array = new Int8Array(1);
        array[0] = 102;
        ws.send(array);
    }

    ws.on('open', function open() {
        console.log('Opened socket');
        requestFrame(ws);
    });
    
    ws.on('message', function incoming(data) {
        console.log('message arrived');
        client.feed({
            video: new Uint8Array(data)
        });

        requestFrame(ws);
    });

    ws.on('error', function error(err) {
        console.error(err);
    });
});