var { createHash } = require("crypto")
var { Transform } = require("stream")
var pathPlatform = require('path');

//https://github.com/bevry/sortobject
/**
 * Returns a copy of the passed array, with all nested objects within it sorted deeply by their keys, without mangling any nested arrays.
 * @param subject The unsorted array.
 * @param comparator An optional comparator for sorting keys of objects.
 * @returns The new sorted array.
 */
function sortArray(subject, comparator) {
  const result = []
  for (let value of subject) {
    // Recurse if object or array
    if (value != null) {
      if (Array.isArray(value)) {
        value = sortArray(value, comparator)
      } else if (typeof value === "object") {
        /* eslint no-use-before-define:0 */
        value = sortObject(value, comparator)
      }
    }
    // Push
    result.push(value)
  }
  return result
}
/**
 * Returns a copy of the passed object, with all nested objects within it sorted deeply by their keys,
 * without mangling any nested arrays inside of it.
 * @param subject The unsorted object.
 * @param comparator An optional comparator for sorting keys of objects.
 * @returns The new sorted object.
 */
function sortObject(subject, comparator) {
  const result = {}
  const sortedKeys = Object.keys(subject).sort(comparator)
  for (let i = 0; i < sortedKeys.length; ++i) {
    // Fetch
    const key = sortedKeys[i]
    let value = subject[key]
    // Recurse if object or array
    if (value != null) {
      if (Array.isArray(value)) {
        value = sortArray(value, comparator)
      } else if (typeof value === "object") {
        value = sortObject(value, comparator)
      }
    }
    // Push
    result[key] = value
  }
  return result
}
/** @example
 var equal = require('assert').strictEqual
equal(hash([1,{ a: 1, b: 2, c: 3 }, 2, 3]), hash([3, 2, 1, { c: 3, b: 2, a: 1 }]))
equal(hash([1, 2, 3]), hash([3, 2, 1]))
equal(hash({a:1,b:2,c:3}), hash({c:3,b:2,a:1}))
equal(hash({a:1,b:2,c:3}), hash({c:3,b:2,a:1}))
equal(hash({a:1,b:[2,3],c:4}), hash({c:4,b:[2,3],a:1}))
equal(hash({a:1,b:[2,{c:3,d:4}],e:5}), hash({e:5,b:[2,{d:4,c:3}],a:1}))
*/
function shasum(str) {
  str =
    "string" === typeof str
      ? str
      : Buffer.isBuffer(str)
      ? str
      : JSON.stringify(sortObject(Array.isArray(str) ? str.sort() : str))
  return createHash("sha1")
    .update(str, Buffer.isBuffer(str) ? null : "utf8")
    .digest("hex")
}

function depsSort(opts) {
  if (!opts) opts = {}
  var rows = []
  return new Transform({
    objectMode: true,
    write: function write(row, enc, next) {
      rows.push(row)
      next()
    },
    flush: function flush() {
      rows.sort((a, b) => {
        return a.id + a.hash < b.id + b.hash ? -1 : 1
      })
      var expose = opts.expose || {}
      if (Array.isArray(expose)) {
        expose = expose.reduce(function (acc, key) {
          acc[key] = true
          return acc
        }, {})
      }
      var hashes = {}
      var deduped = {}
      var _depsMap = new Map() //{}
      var _hashesMap = new Map() //{}
      function sameDepsAdd(row, hash) {
        _depsMap.set(row.id, row.deps)
        _hashesMap.set(row.id, hash)
      }
      function sameDepsCmp(a, b, limit = undefined) {
        if (!a && !b) return true
        if (!a || !b) return false
        var keys = Object.keys(a)
        if (keys.length !== Object.keys(b).length) return false
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i]
          var ka = a[k]
          var kb = b[k]
          var ha = _hashesMap.get(ka)
          var hb = _hashesMap.get(kb)
          var da = _depsMap.get(ka)
          var db = _depsMap.get(kb)
          if (ka === kb) continue
          if (ha !== hb || (!limit && !sameDepsCmp(da, db, 1))) {
            return false
          }
        }
        return true
      }
      if (opts.dedupe) {
        rows.forEach((row) => {
          var h = shasum(row.source)
          sameDepsAdd(row, h)
          if (hashes[h]) {
            hashes[h].push(row)
          } else {
            hashes[h] = [row]
          }
        })
        Object.keys(hashes).forEach((h) => {
          var rows = hashes[h]
          while (rows.length > 1) {
            var row = rows.pop()
            row.dedupe = rows[0].id
            row.sameDeps = sameDepsCmp(rows[0].deps, row.deps)
            deduped[row.id] = rows[0].id
          }
        })
      }
      if (opts.index) {
        var index = {}
        var offset = 0
        rows.forEach(function (row, ix) {
          if (row.id in expose) {
            //if (has(expose, row.id)) {
            row.index = row.id
            offset++
            if (expose[row.id] !== true) {
              index[expose[row.id]] = row.index
            }
          } else {
            row.index = ix + 1 - offset
          }
          index[row.id] = row.index
        })
        rows.forEach((row) => {
          row.indexDeps = {}
          Object.keys(row.deps).forEach((key) => {
            var id = row.deps[key]
            row.indexDeps[key] = index[id]
          })
          if (row.dedupe) {
            row.dedupeIndex = index[row.dedupe]
          }
          this.push(row)
        })
      } else {
        rows.forEach((row) => {
          this.push(row)
        })
      }
      this.push(null)
    }
  })
}


var has = Function.prototype.bind.call(Function.call, Object.prototype.hasOwnProperty);

var isArray = Array.isArray;

function defined(...args) {
    for (var i = 0; i < args.length; i++) {
        if (args[i] !== undefined)
            return args[i];
    }
}

var hasOwnProperty = Object.prototype.hasOwnProperty;

function xtend(...args) {
    var target = {};
    for (var i = 0; i < args.length; i++) {
        var source = args[i];
        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key];
            }
        }
    }
    return target;
}

const TERMINATORS_LOOKUP = {
    "\u2028": "\\u2028",
    "\u2029": "\\u2029"
};

const sanitizeHTML = (str) => str.replace(/[\u2028\u2029]/g, (v) => TERMINATORS_LOOKUP[v]);





function parents(cwd, opts) {
    if (cwd === undefined) cwd = process.cwd();
    if (!opts) opts = {};
    var platform = opts.platform || process.platform;
    
    var isWindows = /^win/.test(platform);
    var path = isWindows ? pathPlatform.win32 : pathPlatform;

    var normalize = !isWindows ? path.normalize :
        path.normalize('c:') === 'c:.' ? fixNormalize(path.normalize) :
        path.normalize;
    var sep = isWindows ? /[\\\/]/ : '/';
    var init = isWindows ? '' : '/';
    
    var join = function (x, y) {
        var ps = [ x, y ].filter(function (p) {
            return p && typeof p === 'string'
        });

        return normalize(ps.join(isWindows ? '\\' : '/'));
    };
    
    var res = normalize(cwd)
        .split(sep)
        .reduce(function (acc,dir,ix) {
            return acc.concat(join(acc[ix], dir))
        }, [init])
        .slice(1)
        .reverse()
    ;
    if (res[0] === res[1]) return [ res[0] ];
    if (isWindows && /^\\/.test(cwd)) {
        return res.slice(0,-1).map(function (d) {
            var ch = d.charAt(0)
            return ch === '\\' ? d :
              ch === '.' ? '\\' + d.slice(1) :
              '\\' + d
        });
    }
    return res;

    function fixNormalize(fn) {
      return function(p) {
        return fn(p).replace(/:\.$/, ':')
      }
    }
}


module.exports = {
  depsSort,
  shasum,
  has,
  isArray,
  defined,
  xtend,
  sanitizeHTML,
  parents
}
