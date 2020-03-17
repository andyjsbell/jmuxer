let track_id = 1;
module.exports = class BaseRemuxer {

    static getTrackID() {
        return track_id++;
    }
    
    constructor() {
        this.seq = 1;
    }

    flush() {
        this.seq++;
        this.mp4track.len = 0;
        this.mp4track.samples = [];
    }

    isReady() {
        if (!this.readyToDecode || !this.samples.length) return null;
        return true;
    }
}
