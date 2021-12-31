import { Readable, Transform } from "stream";
import { minify } from "terser";
import { duplexify } from "../streams/duplexify";
var terser_good = {
    ecma: 2020,
    sourceMap: false,
    mangle: true,
    compress: false
};
var terser_good1 = {
    ecma: 2020,
    sourceMap: false,
    format: {
        ascii_only: true,
        wrap_iife: true,
        wrap_func_args: true
    },
    keep_classnames: false,
    keep_fnames: false,
    mangle: {
        safari10: true
    },
    compress: {
        negate_iife: false,
        hoist_funs: true,
        hoist_vars: true
        //passes: 5
    }
};
class StringTransform extends Transform {
    transformFn;
    string;
    constructor(fn, opts) {
        super(opts);
        opts = opts || {};
        this.transformFn = fn;
        this.string = "";
    }
    _transform(chunk, encoding, cb) {
        this.string += chunk.toString();
        cb();
    }
    _flush(cb) {
        try {
            var transformed = this.transformFn(this.string);
            this.push(transformed);
            cb();
        }
        catch (err) {
            cb(err);
        }
    }
}
export function terserStream(opts) {
    var rs = new Readable({ objectMode: true });
    var stream = duplexify();
    stream.setWritable(new StringTransform((source) => {
        minify(source, {
            sourceMap: false,
            ...opts
        })
            .then((minified) => {
            rs.push(minified.code);
            rs.push(null);
            //delay piping because terser minify is async, such a pain in the ass
            stream.setReadable(rs);
        })
            .catch((e) => stream.emit("error", e));
    }));
    return stream;
}
export function tinyify(b, opts) {
    if (typeof b !== "object") {
        throw new Error("tinyify: must be used as a plugin, not a transform");
    }
    b.pipeline.get("pack").push(terserStream(terser_good));
}
