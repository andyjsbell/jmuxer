const debug = require('./util/debug');
const NALU = require('./util/nalu.js')
const H264Parser = require('./parsers/h264.js');
const AACParser = require('./parsers/aac.js');
const Event = require('./util/event.js');
const RemuxController = require('./controller/remux.js');
const fs = require('fs');

module.exports = class Client extends Event {

    constructor(options) {
        super('client');
        
        let defaults = {
            node: '',
            mode: 'both', // both, audio, video
            flushingTime: 1500,
            clearBuffer: true,
            onReady: null, // function called when MSE is ready to accept frames
            fps: 30,
            debug: false,
            file: null,
        };
        this.options = Object.assign({}, defaults, options);

        if (this.options.debug) {
            // debug.setLogger();
        }

        if (!this.options.fps) {
            this.options.fps = 30;
        }
        this.frameDuration = (1000 / this.options.fps) | 0;

        this.remuxController = new RemuxController(this.options.clearBuffer); 
        this.remuxController.addTrack(this.options.mode);
        
        this.lastCleaningTime = Date.now();
        this.keyframeCache = [];
        this.frameCounter  = 0;

        /* events callback */
        this.remuxController.on('buffer', this.onBuffer.bind(this));
        this.startInterval();
    }

    feed(data) {
        let remux = false,
            nalus,
            aacFrames,
            duration,
            chunks = {
                video: [],
                audio: []
            };

        if (!data || !this.remuxController) return;
        duration = data.duration ? parseInt(data.duration) : 0;
        if (data.video) {  
            nalus = H264Parser.extractNALu(data.video);
            if (nalus.length > 0) {
                chunks.video = this.getVideoFrames(nalus, duration);
                remux = true;
            }
        }
        if (data.audio) {
            aacFrames = AACParser.extractAAC(data.audio);
            if (aacFrames.length > 0) {
                chunks.audio = this.getAudioFrames(aacFrames, duration);
                remux = true;
            }
        }
        if (!remux) {
            console.error('Input object must have video and/or audio property. Make sure it is not empty and valid typed array');
            return;
        }
        this.remuxController.remux(chunks);
    }

    getVideoFrames(nalus, duration) {
        let nalu,
            units = [],
            samples = [],
            naluObj,
            sampleDuration,
            adjustDuration = 0,
            numberOfFrames = [];

        for (nalu of nalus) {
            naluObj = new NALU(nalu);
            units.push(naluObj);
            if (naluObj.type() === NALU.IDR || naluObj.type() === NALU.NDR) {
                samples.push({units});
                units = [];
                if (this.options.clearBuffer) {
                    if (naluObj.type() === NALU.IDR) {
                        numberOfFrames.push(this.frameCounter);
                    }
                    this.frameCounter++;
                }
            }
        }
        
        if (duration) {
            sampleDuration = duration / samples.length | 0;
            adjustDuration = (duration - (sampleDuration * samples.length));
        } else {
            sampleDuration = this.frameDuration;
        }
        samples.map((sample) => {
            sample.duration = adjustDuration > 0 ? (sampleDuration + 1) : sampleDuration;
            if (adjustDuration !== 0) {
                adjustDuration--;
            }
        });

        /* cache keyframe times if clearBuffer set true */
        if (this.options.clearBuffer) {
            numberOfFrames = numberOfFrames.map((total) => {
                return (total * sampleDuration) / 1000;
            });
            this.keyframeCache = this.keyframeCache.concat(numberOfFrames);
        }
        return samples;
    }

    getAudioFrames(aacFrames, duration) {
        let samples = [],
            units,
            sampleDuration,
            adjustDuration = 0;

        for (units of aacFrames) {
            samples.push({units});
        }

        if (duration) {
            sampleDuration = duration / samples.length | 0;
            adjustDuration = (duration - (sampleDuration * samples.length));
        } else {
            sampleDuration = this.frameDuration;
        }
        samples.map((sample) => {
            sample.duration = adjustDuration > 0 ? (sampleDuration + 1) : sampleDuration;
            if (adjustDuration !== 0) {
                adjustDuration--;
            }
        });
        return samples;
    }

    destroy() {
        this.stopInterval();
        
        if (this.remuxController) {
            this.remuxController.destroy();
            this.remuxController = null;
        }

        if (this.bufferControllers) {
            for (let type in this.bufferControllers) {
                this.bufferControllers[type].destroy();
            }
            this.bufferControllers = null;
        }
        this.node = false;
        this.videoStarted = false;
    }

    startInterval() {

        this.interval = setInterval(()=>{
            if (this.bufferControllers) {
                this.releaseBuffer();
                this.clearBuffer();
            }
        }, this.options.flushingTime);
    }

    stopInterval() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    releaseBuffer() {
        for (let type in this.bufferControllers) {
            this.bufferControllers[type].doAppend();
        }
    }

    getSafeBufferClearLimit(offset) {
        let maxLimit = (this.options.mode === 'audio' && offset) || 0,
            adjacentOffset;

        for (let i = 0; i < this.keyframeCache.length; i++) {
            if (this.keyframeCache[i] >= offset) {
                break;
            }
            adjacentOffset = this.keyframeCache[i];
        }

        if (adjacentOffset) {
            this.keyframeCache = this.keyframeCache.filter( keyframePoint => {
                if (keyframePoint < adjacentOffset) {
                    maxLimit = keyframePoint;
                }
                return keyframePoint >= adjacentOffset;
            });
        }
        
        return maxLimit;
    }

    clearBuffer() {
        if (this.options.clearBuffer && (Date.now() - this.lastCleaningTime) > 10000) {
            for (let type in this.bufferControllers) {
                let cleanMaxLimit = this.getSafeBufferClearLimit(this.node.currentTime);
                this.bufferControllers[type].initCleanup(cleanMaxLimit);
            }
            this.lastCleaningTime = Date.now();
        }
    }

    onBuffer(data) {
        if (this.options.file) {
            console.log("length: ", data.payload.length);
            fs.writeSync(this.options.file, data.payload, 0, data.payload.length);
        }
    }
}