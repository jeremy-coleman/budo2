var { PassThrough, Transform } = require("stream")

var commentRx =
  /^\s*\/(?:\/|\*)[@#]\s+sourceMappingURL=data:(?:application|text)\/json;(?:charset[:=]\S+;)?base64,(.*)$/gm

var mapFileCommentRx =
  /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^\*]+?)[ \t]*(?:\*\/){1}[ \t]*$)/gm

let _prelude = `
// modules are defined as an array
// [ module function, map of requireuires ]
//
// map of requireuires is short require name -> numeric require
//
// anything defined in a previous bundle is accessed via the
// orig method which is the requireuire for previous bundles

(function() {

function outer(modules, cache, entry) {
    // Save the require from previous bundle to this closure if any
    var previousRequire = typeof require == "function" && require;

    function newRequire(name, jumped){
        if(!cache[name]) {
            if(!modules[name]) {
                // if we cannot find the module within our internal map or
                // cache jump to the current global require ie. the last bundle
                // that was added to the page.
                var currentRequire = typeof require == "function" && require;
                if (!jumped && currentRequire) return currentRequire(name, true);

                // If there are other bundles on this page the require from the
                // previous one is saved to 'previousRequire'. Repeat this as
                // many times as there are bundles until the module is found or
                // we exhaust the require chain.
                if (previousRequire) return previousRequire(name, true);
                
                var err = new Error("Cannot find module" + String(name) );
                err.code = 'MODULE_NOT_FOUND';
                throw err;
            }
            var m = cache[name] = {exports:{}};
            modules[name][0].call(m.exports, function(x){
                var id = modules[name][1][x];
                return newRequire(id ? id : x);
            },m,m.exports,outer,modules,cache,entry);
        }
        return cache[name].exports;
    }
    for(var i=0;i<entry.length;i++) newRequire(entry[i]);

    // Override the current require with this new one
    return newRequire;
}

return outer;

})()`

function removeSourcemapComments(src) {
  if (!src.replace) {
    return src
  }
  return src.replaceAll(commentRx, "").replaceAll(mapFileCommentRx, "")
}

function browserPack(opts) {
  if (!opts) opts = {}
  var parser = opts.raw ? new PassThrough({ objectMode: true }) : require("jsonstream").parse([true])
  //var parser = opts.raw ? through.obj() : JSONStream.parse([ true ]);
  var stream = new Transform({
    objectMode: true,
    transform: function (buf, enc, next) {
      parser.write(buf)
      next()
    },
    flush: function () {
      parser.end()
    }
  })
  parser.pipe(new Transform({ objectMode: true, transform: write, flush: end }))
  //@ts-ignore
  stream.standaloneModule = opts.standaloneModule
  //@ts-ignore
  stream.hasExports = opts.hasExports
  var first = true
  var entries = []
  var prelude = opts.prelude || JSON.parse(JSON.stringify(_prelude)) //fs.readFileSync(path.join(__dirname, "_prelude.js"), "utf8")
  return stream

  function write(row, enc, next) {
    //@ts-ignore
    if (first && stream.hasExports) {
      var pre = opts.externalRequireName || "require"
      stream.push(Buffer.from(pre + "=", "utf8"))
    }
    if (first) stream.push(Buffer.from(prelude + "({", "utf8"))
    var wrappedSource = [
      first ? "" : ",",
      JSON.stringify(row.id),
      ":[",
      "function(require,module,exports){\n",
      removeSourcemapComments(row.source),
      "\n},",
      "{" +
        Object.keys(row.deps || {})
          .sort()
          .map(function (key) {
            return JSON.stringify(key) + ":" + JSON.stringify(row.deps[key])
          })
          .join(",") +
        "}",
      "]"
    ].join("")
    stream.push(Buffer.from(wrappedSource, "utf8"))
    first = false
    if (row.entry && row.order !== undefined) {
      entries[row.order] = row.id
    } else if (row.entry) entries.push(row.id)
    next()
  }

  function end() {
    if (first) stream.push(Buffer.from(prelude + "({", "utf8"))
    entries = entries.filter(function (x) {
      return x !== undefined
    })
    stream.push(Buffer.from("},{}," + JSON.stringify(entries) + ")", "utf8"))
    stream.push(Buffer.from(";\n", "utf8"))
    stream.push(null)
  }
}

module.exports = browserPack
