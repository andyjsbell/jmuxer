const {debug} = require('../util/debug');
const MP4 = require('../util/mp4-generator.js');
const AACRemuxer = require('../remuxer/aac.js');
const H264Remuxer = require('../remuxer/h264.js');
// const { appendByteArray, secToTime } = require ('../util/utils.js');
const Event = require ('../util/event.js');
function appendByteArray(buffer1, buffer2) {
    let tmp = new Uint8Array((buffer1.byteLength|0) + (buffer2.byteLength|0));
    tmp.set(buffer1, 0);
    tmp.set(buffer2, buffer1.byteLength|0);
    return tmp;
}

function secToTime(sec) {
    let seconds,
        hours,
        minutes,
        result = '';

    seconds = Math.floor(sec);
    hours = parseInt(seconds / 3600, 10) % 24;
    minutes = parseInt(seconds / 60, 10) % 60;
    seconds = (seconds < 0) ? 0 : seconds % 60;

    if (hours > 0) {
        result += (hours < 10 ? '0' + hours : hours) + ':';
    }
    result += (minutes < 10 ? '0' + minutes : minutes) + ':' + (seconds < 10 ? '0' + seconds : seconds);
    return result;
}

module.exports = class RemuxController extends Event {

    constructor(streaming) {
        super('remuxer');
        this.initialized = false;
        this.trackTypes = [];
        this.tracks = {};
        this.mediaDuration = streaming ? Infinity : 1000;
    }

    addTrack(type) {
        if (type === 'video' || type === 'both') {
            this.tracks.video = new H264Remuxer();
            this.trackTypes.push('video');
        }
        if (type === 'audio' || type === 'both') {
            this.tracks.audio = new AACRemuxer();
            this.trackTypes.push('audio');
        }
    }

    reset() {
        for (let type of this.trackTypes) {
            this.tracks[type].resetTrack();
        }
        this.initialized = false;
    }

    destroy() {
        this.tracks = {};
        this.offAll();
    }

    flush() {
        if (!this.initialized) {
            if (this.isReady()) {
                this.dispatch('ready');
                for (let type of this.trackTypes) { 
                    let track = this.tracks[type];
                    let data = {
                        type: type,
                        payload: MP4.initSegment([track.mp4track], this.mediaDuration, track.mp4track.timescale),
                    };
                    this.dispatch('buffer', data);
                }
                console.log('Initial segment generated.');
                this.initialized = true;
            }
        } else {
            for (let type of this.trackTypes) {
                let track = this.tracks[type];
                let pay = track.getPayload();
                if (pay && pay.byteLength) {
                    const moof = MP4.moof(track.seq, track.dts, track.mp4track);
                    const mdat = MP4.mdat(pay);
                    let payload = appendByteArray(moof, mdat);
                    let data = {
                        type: type,
                        payload: payload,
                        dts: track.dts
                    };
                    this.dispatch('buffer', data);
                    let duration = secToTime(track.dts / 1000);
                    console.log(`put segment (${type}): ${track.seq} dts: ${track.dts} samples: ${track.mp4track.samples.length} second: ${duration}`);
                    track.flush();
                }
            }
        }
    }

    isReady() {
        for (let type of this.trackTypes) {
            if (!this.tracks[type].readyToDecode || !this.tracks[type].samples.length) return false;
        }
        return true;
    }

    remux(data) {
        for (let type of this.trackTypes) {
            let samples = data[type];
            if (type === 'audio' && this.tracks.video && !this.tracks.video.readyToDecode) continue; /* if video is present, don't add audio until video get ready */
            if (samples.length > 0) {
                this.tracks[type].remux(samples);
            }
        }
        this.flush();
    }
}
