import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import bresolve from "resolve";
import { PassThrough, Transform } from "stream";
import { bpack } from "./bpack-flat";
//var detective = require("detective-wasm");
var detective = require("./detective");

import { duplexify } from "./Duplexify";
import { combine, ConcatStream, defined, DepSortStream, isArray, ReadOnlyStream, wrapTransform, _cat } from "./helpers";
import { Labeled } from "./LabeledSplicer";

class ModuleDepsStream extends Transform {
    constructor(opts) {
        super({ objectMode: true });
        if (!opts)
            opts = {};
        this._extensions = [".js", ".json", ".jsx", ".ts", ".tsx", ".wasm", ".coffee"].concat(opts.extensions || []);
        this.basedir = opts.basedir || process.cwd();
        this.visited = {};
        this.walking = {};
        this.entries = [];
        this._input = [];
        this.transforms = _cat(opts.transform);
        this.globalTransforms = _cat(opts.globalTransform);
        this.options = Object.assign({}, opts);
        this.pending = 0;
        this.inputPending = 0;
        var topfile = path.join(this.basedir, "__fake.js");
        this.top = {
            id: topfile,
            filename: topfile,
            basedir: this.basedir
        };
    }
    _isTopLevel(file) {
        return this.entries.some((main) => {
            return (path.posix
                .relative(path.dirname(main), file)
                .split(/[\\\/]/)
                .indexOf("node_modules") < 0 ||
                path.posix
                    .relative(this.basedir, file)
                    .split(/[\\\/]/)
                    .indexOf("node_modules") < 0);
        });
    }
    _transform(row, enc, next) {
        if (row.transform && row.global) {
            this.globalTransforms.push([row.transform, row.options]);
            return next();
        }
        else if (row.transform) {
            this.transforms.push([row.transform, row.options]);
            return next();
        }
        this.pending++;
        var basedir = defined(row.basedir, this.basedir);
        if (row.entry !== false) {
            this.entries.push(path.resolve(basedir, row.file || row.id));
        }
        this.pending--;
        this._input.push({ row: row });
        next();
    }
    _flush() {
        var files = {};
        this._input.forEach((r) => {
            var w = r.row;
            var f = files[w.file || w.id];
            if (f) {
                f.row.entry = f.row.entry || w.entry;
            }
            else
                files[w.file || w.id] = r;
        });
        Object.keys(files).forEach((key) => {
            var r = files[key];
            var pkg = r.pkg || {};
            var dir = r.row.file ? path.dirname(r.row.file) : this.basedir;
            if (!pkg.__dirname) {
                pkg.__dirname = dir;
            }
            const _fake = Object.assign({}, this.top, { filename: path.join(dir, "_fake.js") });
            this.walk(r.row, _fake);
        });
        if (this.pending === 0)
            this.push(null);
        this._ended = true;
    }
    createTransforms(file) {
        var transforms = (this._isTopLevel(file) ? this.transforms : []).concat(this.globalTransforms);
        if (transforms.length === 0) {
            return new PassThrough();
        }
        var pending = transforms.length;
        var streams = [];
        var input = new PassThrough();
        var output = new PassThrough();
        var _duplex = duplexify(input, output);
        var runTransform = (i) => {
            var trOpts = {};
            var tr = transforms[i];
            if (Array.isArray(tr)) {
                trOpts = tr[1] || {};
                tr = tr[0];
            }
            var t = tr(file, trOpts);
            this.emit("transform", t, file);
            process.nextTick(() => {
                streams[i] = wrapTransform(t);
                if (--pending === 0) {
                    var middle = combine.apply(null, streams);
                    input.pipe(middle).pipe(output);
                }
            });
        };
        for (var i = 0; i < transforms.length; i++) {
            runTransform(i);
        }
        return _duplex;
    }
    walk(id, parent, cb) {
        var self = this;
        this.pending++;
        var rec = {};
        var input;
        if (typeof id === "object") {
            rec = Object.assign({}, id);
            if (rec.entry === false)
                delete rec.entry;
            id = rec.file || rec.id;
            input = true;
            this.inputPending++;
        }
        parent.extensions = this._extensions;
        bresolve(id, parent, (err, file) => {
            if (err) {
                return this.emit("error", err);
            }
            if (this.visited[file]) {
                if (--this.pending === 0) {
                    this.push(null);
                }
                if (input) {
                    --this.inputPending;
                }
                return cb && cb(null, file);
            }
            this.visited[file] = true;
            process.nextTick(() => {
                fs.createReadStream(file)
                    .pipe(this.createTransforms(file))
                    .pipe(new ConcatStream((body) => {
                    var src = body.toString("utf8");
                    var deps = detective(src);
                    console.log(deps);
                    if (deps) {
                        this.emit("file", file, id);
                        if (err) {
                            this.emit("error", err);
                            return;
                        }
                        var resolved = {};
                        if (input) {
                            --this.inputPending;
                        }
                        if (deps.length === 0) {
                            done();
                        }
                        deps.forEach((id) => {
                            var current = {
                                id: file,
                                filename: file,
                                basedir: path.dirname(file),
                                inNodeModules: parent.inNodeModules || !this._isTopLevel(file)
                            };
                            this.walk(id, current, (err, r) => {
                                resolved[id] = r;
                                if (--deps.length === 0) {
                                    done();
                                }
                            });
                        });
                        function done() {
                            if (!rec.id)
                                rec.id = file;
                            if (!rec.source)
                                rec.source = src;
                            if (!rec.deps)
                                rec.deps = resolved;
                            if (!rec.file)
                                rec.file = file;
                            if (self.entries.indexOf(file) >= 0) {
                                rec.entry = true;
                            }
                            self.push(rec);
                            if (cb)
                                cb(null, file);
                            if (--self.pending === 0)
                                self.push(null);
                        }
                    }
                }));
            });
        });
    }
}
class Browserify extends EventEmitter {
    constructor(opts) {
        super();
        opts = Object.assign({}, opts);
        this._options = opts;
        this.basedir = opts.basedir || process.cwd();
        this._extensions = [".js", ".json", ".jsx", ".ts", ".tsx", ".wasm"].concat(opts.extensions || []);
        this._pending = 0;
        this._transformOrder = 0;
        this._transformPending = 0;
        this._transforms = [];
        this._entryOrder = 0;
        this._ticked = false;
        this._bresolve = bresolve;
        this.pipeline = this._createPipeline(opts);
        this.cache = {};
        _cat(opts.transform).forEach((tr) => {
            this.transform(tr);
        });
        _cat(opts.entries).forEach((file) => {
            this.require(file);
        });
        _cat(opts.plugin).forEach((p) => {
            this.plugin(p, { basedir: opts.basedir });
        });
    }
    require(file) {
        if (isArray(file)) {
            file.forEach((x) => {
                if (typeof x === "object") {
                    this.require(x.file);
                }
                else
                    this.require(x);
            });
            return this;
        }
        this.pipeline.write({ file: path.resolve(this.basedir, file) });
        return this;
    }
    add(file) {
        var self = this;
        if (isArray(file)) {
            file.forEach((x) => {
                self.add(x);
            });
            return this;
        }
        return this.require(file);
    }
    transform(tr, opts) {
        if (typeof opts === "function" || typeof opts === "string") {
            tr = [opts, tr];
        }
        if (isArray(tr)) {
            opts = tr[1];
            tr = tr[0];
        }
        if (!opts)
            opts = {};
        var order = this._transformOrder++;
        this._pending++;
        this._transformPending++;
        process.nextTick(() => {
            this._transforms[order] = {
                transform: tr,
                options: opts,
                global: opts.global
            };
            --this._pending;
            if (--this._transformPending === 0) {
                this._transforms.forEach((tx) => {
                    this.pipeline.write(tx);
                });
                if (this._pending === 0) {
                    this.emit("_ready");
                }
            }
        });
        return this;
    }
    plugin(p, opts = {}) {
        if (isArray(p)) {
            opts = p[1];
            p = p[0];
        }
        p(this, opts);
        return this;
    }
    _createPipeline(opts) {
        if (!opts)
            opts = {};
        if (!this._bundled) {
            this.once("bundle", () => {
                this.pipeline.write({
                    transform: () => new PassThrough(),
                    global: true,
                    options: {}
                });
            });
        }
        this._mdeps = new ModuleDepsStream();
        this._mdeps.on("file", (file, id) => {
            this.pipeline.emit("file", file, id);
            this.emit("file", file, id);
        });
        this._mdeps.on("package", (pkg) => {
            this.pipeline.emit("package", pkg);
            this.emit("package", pkg);
        });
        this._mdeps.on("transform", (tr, file) => {
            this.pipeline.emit("transform", tr, file);
            this.emit("transform", tr, file);
        });
        this._bpack = bpack();
        var pipeline = Labeled.obj([
            "record",
            [this._recorder()],
            "deps",
            [this._mdeps],
            "sort",
            [new DepSortStream()],
            "dedupe",
            [this._dedupe()],
            "label",
            [this._label()],
            "emit-deps",
            [this._emitDeps()],
            "pack",
            [this._bpack],
            "wrap",
            []
        ]);
        return pipeline;
    }
    _recorder() {
        var ended = false;
        this._recorded = [];
        if (!this._ticked) {
            process.nextTick(() => {
                this._ticked = true;
                this._recorded.forEach((row) => {
                    s.push(row);
                });
                if (ended)
                    s.push(null);
            });
        }
        var s = new Transform({ objectMode: true });
        s._transform = (row, enc, next) => {
            this._recorded.push(row);
            if (this._ticked)
                s.push(row);
            next();
        };
        s._flush = () => {
            ended = true;
            if (this._ticked)
                s.push(null);
        };
        return s;
    }
    _dedupe() {
        var s = new Transform({ objectMode: true });
        s._transform = (row, enc, next) => {
            s.push(row);
            next();
        };
        return s;
    }
    _label() {
        var s = new Transform({ objectMode: true });
        s._transform = (row, enc, next) => {
            var prev = row.id;
            if (row.index)
                row.id = row.index;
            this.emit("label", prev, row.id);
            if (row.indexDeps)
                row.deps = row.indexDeps || {};
            s.push(row);
            next();
        };
        return s;
    }
    _emitDeps() {
        var s = new Transform({ objectMode: true });
        s._transform = (row, enc, next) => {
            this.emit("dep", row);
            s.push(row);
            next();
        };
        return s;
    }
    reset() {
        this.pipeline = this._createPipeline(this._options);
        this._entryOrder = 0;
        this._bundled = false;
        this.emit("reset");
    }
    bundle() {
        if (this._bundled) {
            var recorded = this._recorded;
            this.reset();
            recorded.forEach((x) => {
                this.pipeline.write(x);
            });
        }
        var output = new ReadOnlyStream(this.pipeline);
        const ready = () => {
            this.emit("bundle", output);
            this.pipeline.end();
        };
        this._pending === 0 ? ready() : this.once("_ready", ready);
        this._bundled = true;
        return output;
    }
}
const browserify = (opts) => new Browserify(opts);
export { ModuleDepsStream };
export { browserify };
export default browserify;