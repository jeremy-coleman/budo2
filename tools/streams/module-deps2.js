//@ts-check
var fs = require("fs")
var path = require("path")
var through = require("./through2")
var combine = require("./stream-combiner2")
var duplexer = require("./duplexer2")
var { duplexer3 } = require("./streams/duplexer3")
var defined = require("./defined")
var { Transform, PassThrough, Writable } = require("stream")

var bresolve = require("./browser-resolve")
var detective = require("./detective")
//var ConcatStream = require('./concat-stream');

class ConcatStream extends Writable {
  constructor(cb) {
    super({ objectMode: true })
    this._write = (chunk, enc, next) => {
      this.body.push(chunk)
      next()
    }
    this.on("finish", function () {
      cb(Buffer.concat(this.body))
    })
    this.body = []
  }
}

class ModuleDepsStream extends Transform {
  constructor(opts) {
    super({ objectMode: true })
    if (!opts) opts = {}
    this._extensions = [".js", ".json", ".jsx", ".ts", ".tsx", ".wasm", ".coffee"].concat(opts.extensions || [])
    this.basedir = opts.basedir || process.cwd()
    this.visited = {}
    this.walking = {}
    this.entries = []
    this._input = []
    this.transforms = _cat(opts.transform)
    this.globalTransforms = _cat(opts.globalTransform)
    this.options = Object.assign({}, opts)
    this.pending = 0
    this.inputPending = 0
    var topfile = path.join(this.basedir, "__fake.js")
    this.top = {
      id: topfile,
      filename: topfile,
      basedir: this.basedir
    }
  }
  _isTopLevel(file) {
    return this.entries.some((main) => {
      return (
        path.posix
          .relative(path.dirname(main), file)
          .split(/[\\\/]/)
          .indexOf("node_modules") < 0 ||
        path.posix
          .relative(this.basedir, file)
          .split(/[\\\/]/)
          .indexOf("node_modules") < 0
      )
    })
  }
  _transform(row, enc, next) {
    if (row.transform && row.global) {
      this.globalTransforms.push([row.transform, row.options])
      return next()
    } else if (row.transform) {
      this.transforms.push([row.transform, row.options])
      return next()
    }
    this.pending++
    var basedir = defined(row.basedir, this.basedir)
    if (row.entry !== false) {
      this.entries.push(path.resolve(basedir, row.file || row.id))
    }
    this.pending--
    this._input.push({ row: row })
    next()
  }
  _flush() {
    var files = {}
    this._input.forEach((r) => {
      var w = r.row
      var f = files[w.file || w.id]
      if (f) {
        f.row.entry = f.row.entry || w.entry
      } else files[w.file || w.id] = r
    })
    Object.keys(files).forEach((key) => {
      var r = files[key]
      var pkg = r.pkg || {}
      var dir = r.row.file ? path.dirname(r.row.file) : this.basedir
      if (!pkg.__dirname) {
        pkg.__dirname = dir
      }
      const _fake = Object.assign({}, this.top, { filename: path.join(dir, "_fake.js") })
      this.walk(r.row, _fake)
    })
    if (this.pending === 0) this.push(null)
    this._ended = true
  }
  createTransforms(file) {
    var transforms = (this._isTopLevel(file) ? this.transforms : []).concat(this.globalTransforms)
    if (transforms.length === 0) {
      return new PassThrough()
    }
    var pending = transforms.length
    var streams = []
    var input = new PassThrough()
    var output = new PassThrough()
    var _duplex = duplexer3(input, output)
    var runTransform = (i) => {
      var trOpts = {}
      var tr = transforms[i]
      if (Array.isArray(tr)) {
        trOpts = tr[1] || {}
        tr = tr[0]
      }
      var t = tr(file, trOpts)
      this.emit("transform", t, file)
      process.nextTick(() => {
        streams[i] = wrapTransform(t)
        if (--pending === 0) {
          var middle = combine.apply(null, streams)
          input.pipe(middle).pipe(output)
        }
      })
    }
    for (var i = 0; i < transforms.length; i++) {
      runTransform(i)
    }
    return _duplex
  }
  walk(id, parent, cb) {
    var self = this
    this.pending++
    var rec = {}
    var input
    if (typeof id === "object") {
      rec = Object.assign({}, id)
      if (rec.entry === false) delete rec.entry
      id = rec.file || rec.id
      input = true
      this.inputPending++
    }
    parent.extensions = this._extensions
    bresolve(id, parent, (err, file) => {
      if (err) {
        return this.emit("error", err)
      }
      if (this.visited[file]) {
        if (--this.pending === 0) {
          this.push(null)
        }
        if (input) {
          --this.inputPending
        }
        return cb && cb(null, file)
      }
      this.visited[file] = true
      process.nextTick(() => {
        fs.createReadStream(file)
          .pipe(this.createTransforms(file))
          .pipe(
            new ConcatStream((body) => {
              var src = body.toString("utf8")
              var deps = detective(src)
              //console.log(deps);
              if (deps) {
                this.emit("file", file, id)
                if (err) {
                  this.emit("error", err)
                  return
                }
                var resolved = {}
                if (input) {
                  --this.inputPending
                }
                if (deps.length === 0) {
                  done()
                }
                deps.forEach((id) => {
                  var current = {
                    id: file,
                    filename: file,
                    basedir: path.dirname(file),
                    inNodeModules: parent.inNodeModules || !this._isTopLevel(file)
                  }
                  this.walk(id, current, (err, r) => {
                    resolved[id] = r
                    if (--deps.length === 0) {
                      done()
                    }
                  })
                })
                function done() {
                  if (!rec.id) rec.id = file
                  if (!rec.source) rec.source = src
                  if (!rec.deps) rec.deps = resolved
                  if (!rec.file) rec.file = file
                  if (self.entries.indexOf(file) >= 0) {
                    rec.entry = true
                  }
                  self.push(rec)
                  if (cb) cb(null, file)
                  if (--self.pending === 0) self.push(null)
                }
              }
            })
          )
      })
    })
  }
}

function _cat(v) {
  return [].concat(v).filter(Boolean)
}

function wrapTransform(tr) {
  if (typeof tr.read === "function") return tr
  var input = through(),
    output = through()
  input.pipe(tr).pipe(output)
  var wrapper = duplexer(input, output)
  //@ts-ignore
  tr.on("error", function (err) {
    //@ts-ignore
    wrapper.emit("error", err)
  })
  return wrapper
}

function createDependencyStream(opts) {
  return new ModuleDepsStream(opts)
}

module.exports = createDependencyStream
