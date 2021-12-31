import { Stream } from "stream";
class CustomStream extends Stream {
    ended;
    destroyed;
    buffer;
    _ended;
    readable;
    writable;
    paused;
    write;
    push;
    queue;
    end;
    pause;
    resume;
    destroy;
    constructor(write, end) {
        write =
            write ||
                function (data) {
                    this.push(data);
                };
        end =
            end ||
                function () {
                    this.push(null);
                };
        super({ autoDestroy: true });
        this.ended = false;
        this.destroyed = false;
        this.buffer = [];
        this._ended = false;
        this.readable = true;
        this.writable = true;
        this.paused = false;
        this.write = function (data) {
            write.call(this, data);
            return !this.paused;
        };
        var drain = () => {
            while (this.buffer.length && !this.paused) {
                var data = this.buffer.shift();
                if (null === data)
                    return this.emit("end");
                else
                    this.emit("data", data);
            }
        };
        this.push = (data) => {
            //    console.error(ended)
            if (this._ended) {
                return this;
            }
            if (data === null) {
                this._ended = true;
            }
            this.buffer.push(data);
            drain();
            return this;
        };
        this.queue = this.push;
        this.end = (data) => {
            if (this.ended)
                return;
            this.ended = true;
            if (arguments.length) {
                this.write(data);
            }
            this.writable = false;
            end.call(this);
            if (!this.readable) {
                this.destroy();
            }
            //_end() // will emit or push
            return this;
        };
        this.destroy = () => {
            if (this.destroyed)
                return;
            this.destroyed = true;
            this.ended = true;
            this.buffer.length = 0;
            this.writable = this.readable = false;
            this.emit("close");
            return this;
        };
        this.pause = () => {
            if (this.paused)
                return;
            this.paused = true;
            return this;
        };
        this.resume = () => {
            if (this.paused) {
                this.paused = false;
                this.emit("resume");
            }
            drain();
            //may have become paused again,
            //as drain emits 'data'.
            if (!this.paused)
                this.emit("drain");
            return this;
        };
    }
}
// through v1
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)
export function through(write, end) {
    return new CustomStream(write, end);
}
