/* -------------------------------------------------------------------------- */
/*                            LabeledStreamSplicer                            */
import { Duplex, PassThrough, Readable } from "stream";
class Splicer extends Duplex {
    _streams;
    length;
    constructor(streams) {
        super({ objectMode: true });
        if (!streams)
            streams = [];
        this._streams = [];
        this.splice.apply(this, [0, 0].concat(streams));
        this.once("finish", () => {
            this._notEmpty();
            this._streams[0].end();
        });
    }
    _read() {
        var self = this;
        this._notEmpty();
        var r = this._streams[this._streams.length - 1];
        var buf;
        var reads = 0;
        while ((buf = r.read()) !== null) {
            Duplex.prototype.push.call(this, buf);
            reads++;
        }
        if (reads === 0) {
            var onreadable = function () {
                r.removeListener("readable", onreadable);
                self.removeListener("_mutate", onreadable);
                self._read();
            };
            r.once("readable", onreadable);
            self.once("_mutate", onreadable);
        }
    }
    _write(buf, enc, next) {
        this._notEmpty();
        this._streams[0]._write(buf, enc, next);
    }
    _notEmpty() {
        var self = this;
        if (this._streams.length > 0)
            return;
        var stream = new PassThrough({ objectMode: true });
        stream.once("end", function () {
            var ix = self._streams.indexOf(stream);
            if (ix >= 0 && ix === self._streams.length - 1) {
                Duplex.prototype.push.call(self, null);
            }
        });
        this._streams.push(stream);
        this.length = this._streams.length;
    }
    pop() {
        return this.splice(this._streams.length - 1, 1)[0];
    }
    shift() {
        return this.splice(0, 1)[0];
    }
    unshift(...args) {
        this.splice.apply(this, [0, 0].concat(args));
        return this._streams.length;
    }
    splice(...orginalArgs) {
        var key = orginalArgs[0];
        var ix;
        if (typeof key === "string") {
            ix = this.indexOf(key);
        }
        else
            ix = key;
        var args = [ix].concat([].slice.call(orginalArgs, 1));
        var start = args[0];
        var removeLen = args[1];
        var self = this;
        var len = this._streams.length;
        start = start < 0 ? len - start : start;
        if (removeLen === undefined)
            removeLen = len - start;
        removeLen = Math.max(0, Math.min(len - start, removeLen));
        for (var i = start; i < start + removeLen; i++) {
            if (self._streams[i - 1]) {
                self._streams[i - 1].unpipe(self._streams[i]);
            }
        }
        if (self._streams[i - 1] && self._streams[i]) {
            self._streams[i - 1].unpipe(self._streams[i]);
        }
        var end = i;
        var reps = [];
        for (var j = 2; j < args.length; j++) {
            ;
            (function (stream) {
                if (Array.isArray(stream)) {
                    //@ts-ignore
                    stream = new Splicer(stream, self._options);
                }
                stream.on("error", function (err) {
                    err.stream = this;
                    self.emit("error", err);
                });
                stream = self._wrapStream(stream);
                stream.once("end", function () {
                    var ix = self._streams.indexOf(stream);
                    if (ix >= 0 && ix === self._streams.length - 1) {
                        Duplex.prototype.push.call(self, null);
                    }
                });
                reps.push(stream);
            })(orginalArgs[j]);
        }
        //@ts-ignore
        for (var i = 0; i < reps.length - 1; i++) {
            reps[i].pipe(reps[i + 1]);
        }
        if (reps.length && self._streams[end]) {
            reps[reps.length - 1].pipe(self._streams[end]);
        }
        if (reps[0] && self._streams[start - 1]) {
            self._streams[start - 1].pipe(reps[0]);
        }
        var sargs = [start, removeLen].concat(reps);
        var removed = self._streams.splice.apply(self._streams, sargs);
        //@ts-ignore
        for (var i = 0; i < reps.length; i++) {
            reps[i].read(0);
        }
        this.emit("_mutate");
        this.length = this._streams.length;
        return removed;
    }
    get(...args) {
        let key = args[0];
        if (typeof key === "string") {
            var ix = this.indexOf(key);
            if (ix < 0)
                return undefined;
            return this._streams[ix];
        }
        if (args.length === 0)
            return undefined;
        var base = this;
        for (var i = 0; i < args.length; i++) {
            var index = args[i];
            if (index < 0) {
                base = base._streams[base._streams.length + index];
            }
            else {
                base = base._streams[index];
            }
            if (!base)
                return undefined;
        }
        return base;
    }
    indexOf(stream) {
        if (typeof stream === "string") {
            for (var i = 0; i < this._streams.length; i++) {
                if (this._streams[i].label === stream)
                    return i;
            }
            return -1;
        }
        else
            return this._streams.indexOf(stream);
    }
    _wrapStream(stream) {
        if (typeof stream.read === "function") {
            return stream;
        }
        var w = new Readable({ objectMode: true }).wrap(stream);
        //@ts-ignore
        w._write = function (buf, enc, next) {
            if (stream.write(buf) === false) {
                stream.once("drain", next);
            }
            else
                setImmediate(next);
        };
        return w;
    }
    // @ts-ignore
    push(...streams) {
        this.splice.apply(this, [this._streams.length, 0].concat(streams));
        return this._streams.length;
    }
}
class LabeledStreamSplicer extends Splicer {
    constructor(streams) {
        super([]);
        var reps = [];
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (typeof s === "string")
                continue;
            if (Array.isArray(s)) {
                s = new LabeledStreamSplicer(s);
            }
            if (i >= 0 && typeof streams[i - 1] === "string") {
                s.label = streams[i - 1];
            }
            reps.push(s);
        }
        if (typeof streams[i - 1] === "string") {
            reps.push(new LabeledStreamSplicer([]));
        }
        this.splice.apply(this, [0, 0].concat(reps));
    }
}
export { LabeledStreamSplicer };
