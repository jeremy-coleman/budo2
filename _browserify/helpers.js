import { PassThrough, Readable, Transform, Writable } from "stream";
import { duplexify } from "./Duplexify";
var isArray = Array.isArray;
function defined(...args) {
    let i = args.findIndex((v) => v !== undefined);
    return args[i];
}
const _cat = (v) => [].concat(v).filter(Boolean);
class DepSortStream extends Transform {
    constructor() {
        super({ objectMode: true });
        this.rows = [];
    }
    _transform(row, enc, next) {
        this.rows.push(row);
        next();
    }
    _flush() {
        this.rows.sort((a, b) => (a.id + a.hash < b.id + b.hash ? -1 : 1));
        var index = {};
        var offset = 0;
        this.rows.forEach((row, ix) => {
            row.index = ix + 1 - offset;
            index[row.id] = row.index;
        });
        this.rows.forEach((row) => {
            row.indexDeps = {};
            Object.keys(row.deps).forEach((key) => {
                var id = row.deps[key];
                row.indexDeps[key] = index[id];
            });
            this.push(row);
        });
        this.push(null);
    }
}
class ReadOnlyStream extends Readable {
    constructor(stream) {
        super({ objectMode: true });
        this._read = () => {
            var buf;
            var reads = 0;
            while ((buf = this.stream.read()) !== null) {
                this.push(buf);
                reads++;
            }
            if (reads === 0)
                this.waiting = true;
        };
        stream.on("readable", () => {
            if (this.waiting) {
                this.waiting = false;
                this._read();
            }
        });
        stream.once("end", () => {
            this.push(null);
        });
        stream.on("error", (err) => {
            this.emit("error", err);
        });
        this.stream = stream;
        this.waiting = false;
    }
}
class ConcatStream extends Writable {
    constructor(cb) {
        super({ objectMode: true });
        this._write = (chunk, enc, next) => {
            this.body.push(chunk);
            next();
        };
        this.on("finish", function () {
            cb(Buffer.concat(this.body));
        });
        this.body = [];
    }
}
function wrap(tr) {
    if (typeof tr.read === "function")
        return tr;
    return new Readable().wrap(tr);
}
function combine(...streams) {
    for (const stream of streams) {
        wrap(stream);
    }
    if (streams.length == 0)
        return new PassThrough();
    else if (streams.length == 1)
        return streams[0];
    var first = streams[0];
    var last = streams[streams.length - 1];
    var thepipe = duplexify(first, last);
    function recurse(streams) {
        if (streams.length < 2)
            return;
        streams[0].pipe(streams[1]);
        recurse(streams.slice(1));
    }
    recurse(streams);
    return thepipe;
}
function wrapTransform(tr) {
    if (typeof tr.read === "function") {
        return tr;
    }
    var input = new PassThrough();
    var output = new PassThrough();
    input.pipe(tr).pipe(output);
    var wrapper = duplexify(input, output);
    tr.on("error", function (err) {
        wrapper.emit("error", err);
    });
    return wrapper;
}
export { wrapTransform, wrap, _cat, isArray, DepSortStream, ConcatStream, ReadOnlyStream, defined, combine };