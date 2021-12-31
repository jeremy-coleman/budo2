var http = require("http")
var https = require("https")
var fs = require("fs")
var path = require("path")
var { EventEmitter } = require("events")
var urlLib = require("url")
var { spawn } = require("child_process")

var xtend = require("./#deps/xtend")
var once = require("lodash/once")
var debounce = require("lodash/debounce")
var isMatch = require("micromatch")
var Chokidar = require("chokidar")

var browserify = require("./browserify")
var createWatchify = require("./watchify")
var insertGlobals = require("./insert-module-globals")

var concat = require("./streams/concat-stream")
var duplexer = require("./streams/duplexer2")
var defaultIndex = require("./streams/simple-html-index")

var openUrl = require("./#deps/open")
var stacked = require("./#deps/stacked")
var serveStatic = require("./#deps/serve-static")
var pushState = require("./#deps/connect-pushstate")
var liveReload = require("./#deps/inject-lr-script")
var urlTrim = require("./#deps/url-trim")
var escapeHtml = require("./#deps/escape-html")
var bole = require("./#deps/bole")
var garnish = require("./#deps/garnish")
var onResHeaders = require("./#deps/on-headers")
var onResFinished = require("./#deps/on-finished")
var parseShell = require("./#deps/shell-quote").parse

var WebSocketServer = require("ws").Server
var isAbsolute = path.isAbsolute
var color = require("./#deps/kolorist")


var subarg = require("subarg")
var glob = require("glob")
var { Readable } = require("stream")

var liveReloadClientFile = require.resolve("./budo.lr-client.js")
const { attachShaderReload } = require("./transforms/shader-reload.budo-attach")

//default transoforms
const shaderReloadTransform = require("./transforms/shader-reload.transform")

serveStatic.mime.types["wasm"] = "application/wasm"

//todo
//default transforms are on line 995, hoist those up here

var log = bole("budo")

var defaults = {
  title: "budo",
  port: 9966,
  debug: true,
  stream: true,
  errorHandler: true,
  portfind: true
}

function fromArgs(args, opts) {
  var argv = subarg(args, {
    boolean: [
      "deps",
      "pack",
      "ig",
      "dg",
      "im",
      "d",
      "list",
      "builtins",
      "commondir",
      "bare",
      "full-paths",
      "bundle-external",
      "bf",
      "node",
      "preserve-symlinks"
    ],
    string: ["s", "r", "u", "x", "t", "i", "o", "e", "c", "it"],
    alias: {
      "ig": ["insert-globals", "fast"],
      "dg": ["detect-globals", "detectGlobals", "dg"],
      "bf": ["browser-field", "browserField"],
      "im": "ignore-missing",
      "it": "ignore-transform",
      "igv": "insert-global-vars",
      "d": "debug",
      "s": "standalone",
      "noParse": ["noparse"],
      "full-paths": ["fullpaths", "fullPaths"],
      "r": "require",
      "u": "exclude",
      "x": "external",
      "t": "transform",
      "i": "ignore",
      "o": "outfile",
      "e": "entry",
      "c": "command",
      "bare": "bear"
    },
    default: {
      "ig": false,
      "im": false,
      "dg": true,
      "d": false,
      "builtins": true,
      "commondir": true,
      "bundle-external": true,
      "bf": true,
      "dedupe": true,
      "node": false
    }
  })

  var entries = argv._.concat(argv.entry)
    .filter(Boolean)
    .map(function (entry) {
      if (entry === "-") {
        var s = process.stdin
        if (typeof s.read === "function") return s
        // only needed for 0.8, remove at some point later:
        var rs = Readable().wrap(s)
        s.resume()
        return rs
      }
      return entry
    })

  if (argv.igv) {
    var insertGlobalVars = {}
    var wantedGlobalVars = argv.igv.split(",")
    Object.keys(insertGlobals.vars).forEach(function (x) {
      if (wantedGlobalVars.indexOf(x) === -1) {
        insertGlobalVars[x] = undefined
      }
    })
  }

  var ignoreTransform = argv["ignore-transform"] || argv.it
  var b = browserify(
    xtend(
      {
        node: argv.node,
        bare: argv.bare,
        noParse: Array.isArray(argv.noParse) ? argv.noParse : [argv.noParse],
        extensions: []
          .concat(argv.extension)
          .filter(Boolean)
          .map(function (extension) {
            if (extension.charAt(0) != ".") {
              return "." + extension
            } else {
              return extension
            }
          }),
        ignoreTransform: [].concat(ignoreTransform).filter(Boolean),
        entries: entries,
        fullPaths: argv["full-paths"],
        builtins: argv.builtins === false ? false : undefined,
        commondir: argv.commondir === false ? false : undefined,
        bundleExternal: argv["bundle-external"],
        basedir: argv.basedir,
        browserField: argv.browserField,
        transformKey: argv["transform-key"] ? ["browserify", argv["transform-key"]] : undefined,
        dedupe: argv["dedupe"],
        preserveSymlinks: argv["preserve-symlinks"],

        detectGlobals: argv.detectGlobals,
        insertGlobals: argv["insert-globals"] || argv.ig,
        insertGlobalVars: insertGlobalVars,
        ignoreMissing: argv["ignore-missing"] || argv.im,
        debug: argv["debug"] || argv.d,
        standalone: argv["standalone"] || argv.s
      },
      opts
    )
  )
  function error(msg) {
    var e = new Error(msg)
    process.nextTick(function () {
      b.emit("error", e)
    })
  }
  b.argv = argv
  ;[]
    .concat(argv.p)
    .concat(argv.plugin)
    .filter(Boolean)
    .forEach(function (p) {
      var pf = p,
        pOpts = {}
      if (typeof p === "object") {
        ;(pf = p._.shift()), (pOpts = p)
      }
      b.plugin(pf, pOpts)
    })
  ;[]
    .concat(argv.ignore)
    .filter(Boolean)
    .forEach(function (i) {
      b._pending++
      glob(i, function (err, files) {
        if (err) return b.emit("error", err)
        if (files.length === 0) {
          b.ignore(i)
        } else {
          files.forEach(function (file) {
            b.ignore(file)
          })
        }
        if (--b._pending === 0) b.emit("_ready")
      })
    })
  ;[]
    .concat(argv.exclude)
    .filter(Boolean)
    .forEach(function (u) {
      b.exclude(u)

      b._pending++
      glob(u, function (err, files) {
        if (err) return b.emit("error", err)
        files.forEach(function (file) {
          b.exclude(file)
        })
        if (--b._pending === 0) b.emit("_ready")
      })
    })
  ;[]
    .concat(argv.require)
    .filter(Boolean)
    .forEach(function (r) {
      var xs = splitOnColon(r)
      b.require(xs[0], { expose: xs.length === 1 ? xs[0] : xs[1] })
    })

  // resolve any external files and add them to the bundle as externals
  ;[]
    .concat(argv.external)
    .filter(Boolean)
    .forEach(function (x) {
      var xs = splitOnColon(x)
      if (xs.length === 2) {
        add(xs[0], { expose: xs[1] })
      } else if (/\*/.test(x)) {
        b.external(x)
        glob(x, function (err, files) {
          files.forEach(function (file) {
            add(file, {})
          })
        })
      } else add(x, {})

      function add(x, opts) {
        if (/^[\/.]/.test(x)) b.external(path.resolve(x), opts)
        else b.external(x, opts)
      }
    })
  ;[]
    .concat(argv.transform)
    .filter(Boolean)
    .forEach(function (t) {
      addTransform(t)
    })
  ;[]
    .concat(argv.g)
    .concat(argv["global-transform"])
    .filter(Boolean)
    .forEach(function (t) {
      addTransform(t, { global: true })
    })

  function addTransform(t, opts) {
    if (typeof t === "string" || typeof t === "function") {
      b.transform(opts, t)
    } else if (t && typeof t === "object") {
      if (!t._[0] || typeof t._[0] !== "string") {
        return error("expected first parameter to be a transform string")
      }
      if (opts)
        Object.keys(opts).forEach(function (key) {
          t[key] = opts[key]
        })
      b.transform(t, t._.shift())
    } else error("unexpected transform of type " + typeof t)
  }

  ;[]
    .concat(argv.command)
    .filter(Boolean)
    .forEach(function (c) {
      var cmd = parseShell(c)
      b.transform(function (file) {
        var env = Object.keys(process.env).reduce(function (acc, key) {
          acc[key] = process.env[key]
          return acc
        }, {})
        env.FILENAME = file
        var ps = spawn(cmd[0], cmd.slice(1), { env: env })
        var error = ""
        ps.stderr.on("data", function (buf) {
          error += buf
        })

        ps.on("exit", function (code) {
          if (code === 0) return
          console.error(["error running source transform command: " + c, error.split("\n").join("\n  "), ""].join("\n"))
          process.exit(1)
        })
        return duplexer(ps.stdin, ps.stdout)
      })
    })

  if (argv.standalone === "") {
    error("--standalone requires an export name argument")
    return b
  }

  return b
}

function splitOnColon(f) {
  var pos = f.lastIndexOf(":")
  if (pos == -1) {
    return [f] // No colon
  } else {
    if (/[a-zA-Z]:[\\/]/.test(f) && pos == 1) {
      return [f] // Windows path and colon is part of drive name
    } else {
      return [f.substr(0, pos), f.substr(pos + 1)]
    }
  }
}

function noop() {}

function ansiRegex({ onlyFirst = false } = {}) {
  const pattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))"
  ].join("|")

  return new RegExp(pattern, onlyFirst ? undefined : "g")
}

function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``)
  }

  return string.replace(ansiRegex(), "")
}



function createReloadServer(server, opts) {
  opts = opts || {}
  log.info({ message: "LiveReload running" })

  // get a list of static folders to use as base dirs
  var cwd = path.resolve(opts.cwd || process.cwd())
  var staticDirs = Array.isArray(opts.dir) ? opts.dir : [opts.dir]
  staticDirs = staticDirs.map(function (dir) {
    return path.resolve(dir)
  })
  if (staticDirs.indexOf(cwd) === -1) staticDirs.push(cwd)

  var closed = false
  var wss = new WebSocketServer({
    server: server,
    perMessageDeflate: false
  })

  return {
    webSocketServer: wss,
    reload: reload,
    errorPopup: errorPopup,
    close: function () {
      if (closed) return
      wss.close()
      closed = true
    }
  }

  function errorPopup(message) {
    message = message || ""
    broadcast({ event: "error-popup", message: message })
  }

  function reload(file) {
    if (closed) return
    var url, ext

    if (file && typeof file === "string") {
      // absolute file path
      file = isAbsolute(file) ? path.normalize(file) : path.resolve(cwd, file)

      // make it relative, removing the static folder parts
      for (var i = 0; i < staticDirs.length; i++) {
        var dir = staticDirs[i]
        url = path.relative(dir, file)
        // if the path doesn't starts with "../", then
        // it should be relative to this folder
        if (!/^(\.\.[/\\]|[/\\])/.test(url)) break
      }

      // turn it into a URL
      url = url.replace(/\\/g, "/")

      // ensure it starts at root of app
      if (url.charAt(0) !== "/") url = "/" + url

      ext = path.extname(file)
    }

    broadcast({ event: "reload", ext: ext, url: url })
  }

  function broadcast(data) {
    if (closed) return
    data = JSON.stringify(data)
    try {
      wss.clients.forEach(function (client) {
        if (client.readyState === client.OPEN) {
          client.send(data, {
            binary: false
          })
        }
      })
    } catch (err) {
      console.error(color.red("ERROR"), "Error sending LiveReload event to client:")
      console.error(err)
    }
  }
}

function createHttpLogger(opts) {
  opts = opts || {}

  var httpLogger = function simpleHttpLogger(req, res, next) {
    if (httpLogger.ignores.indexOf(req.url) >= 0) return next()
    if (!req.url) return next()

    // request data
    req._startAt = undefined

    // response data
    res._startAt = undefined

    // record request start
    recordStartTime.call(req)

    var byteLength = 0
    var logRequest = function () {
      if (!req._startAt || !res._startAt) {
        // missing request and/or response start time
        return
      }

      // calculate diff
      var ms = (res._startAt[0] - req._startAt[0]) * 1000 + (res._startAt[1] - req._startAt[1]) * 1e-6

      log.info({
        elapsed: ms,
        contentLength: byteLength,
        method: (req.method || "GET").toUpperCase(),
        url: req.url,
        statusCode: res.statusCode,
        type: httpLogger.type === "static" ? undefined : httpLogger.type,
        colors: {
          elapsed: ms > 1000 ? "yellow" : "dim"
        }
      })
    }

    var isAlreadyLogging = res._simpleHttpLogger
    res._simpleHttpLogger = true

    if (!isAlreadyLogging) {
      // record response start
      onResHeaders(res, recordStartTime)

      // log when response finished
      onResFinished(res, logRequest)

      var writeFn = res.write

      // catch content-length of payload
      res.write = function (payload) {
        if (payload) byteLength += payload.length
        return writeFn.apply(res, arguments)
      }
    }

    next()
  }

  httpLogger.ignores = [].concat(opts.ignores).filter(Boolean)
  httpLogger.type = "static"
  return httpLogger
}

function recordStartTime() {
  this._startAt = process.hrtime()
}

function createBudoMiddleware(entryMiddleware, opts) {
  opts = opts || {}
  var staticPaths = [].concat(opts.dir).filter(Boolean)
  if (staticPaths.length === 0) {
    staticPaths = [process.cwd()]
  }

  var entrySrc = opts.serve
  var live = opts.live
  var cors = opts.cors
  var handler = stacked()
  var middlewares = [].concat(opts.middleware).filter(Boolean)

  // Everything is logged except favicon.ico
  var ignoreLog = [].concat(opts.ignoreLog).filter(Boolean)

  var logHandler = createHttpLogger({
    ignores: ["/favicon.ico"].concat(ignoreLog)
  })

  handler.use(function (req, res, next) {
    if (cors) {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With"
      )
      res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST")
      res.setHeader("Access-Control-Allow-Origin", "*")
    }
    logHandler(req, res, next)
  })

  // User middleware(s) can override others
  middlewares.forEach(function (middleware) {
    if (typeof middleware !== "function") {
      throw new Error("middleware options must be functions")
    }
    handler.use(function (req, res, next) {
      logHandler.type = "middleware"
      middleware(req, res, next)
    })
  })

  // Entry (watchify) middleware
  if (entryMiddleware) {
    var entryRoute = urlLib.parse(entrySrc).pathname
    if (!/^\//.test(entryRoute)) entryRoute = "/" + entryRoute
    handler.use(function (req, res, next) {
      if (urlTrim(req.url) === urlTrim(entryRoute)) {
        entryMiddleware(req, res, next)
      } else {
        next()
      }
    })
  }

  // Re-route for pushState support
  if (opts.pushstate) {
    if (typeof opts.pushstate === "string") {
      throw new Error("--pushstate is a string, you shouold use subarg options instead")
    }
    var pushStateOpts = xtend(typeof opts.pushstate === "boolean" ? {} : opts.pushstate)
    delete pushStateOpts._ // added by subarg
    handler.use(pushState(pushStateOpts))
  }

  // Inject liveReload snippet on response
  var liveInjector = liveReload({
    local: true
  })
  // this is lazily set and cannot be changed dynamically
  var liveScriptUrl
  // By default, attempt to optimize the response
  var shouldUseBundledLiveReload = false //true
  // Cache the client by default to optimize the response
  var liveReloadClient
  handler.use(liveReloadHandler)

  // If the user wishes to *always* serve
  // a generated index instead of a static one.
  if (opts.forceDefaultIndex) {
    handler.use(indexHandler)
  }

  // Static assets (html/images/etc)
  staticPaths.forEach(function (rootFile) {
    var staticOpts = xtend(
      {
        cacheControl: false
      },
      opts.staticOptions
    )
    delete staticOpts._ // from subarg

    var staticHandler = serveStatic(rootFile, staticOpts)
    handler.use(function (req, res, next) {
      logHandler.type = "static"
      staticHandler(req, res, next)
    })
  })

  // Generates a default index.html
  // when none is found locally.
  handler.use(indexHandler)

  // Ignore favicon clutter
  handler.mount("/favicon.ico", favicon)

  // Handle errors
  handler.use(function (req, res) {
    res.statusCode = 404
    res.end("404 not found: " + escapeHtml(req.url))
  })

  // Allow live options to be changed at runtime
  handler.setLiveOptions = setLiveOptions
  return handler

  function setLiveOptions(opts) {
    live = opts
  }

  function favicon(req, res) {
    var maxAge = 345600 // 4 days
    res.setHeader("Cache-Control", "public, max-age=" + Math.floor(maxAge / 1000))
    res.setHeader("Content-Type", "image/x-icon")
    res.statusCode = 200
    res.end()
  }

  function indexHandler(req, res, next) {
    if (urlLib.parse(req.url).pathname === "/" || /\/index.html?/i.test(req.url)) {
      // If we reach this, our response will be generated
      // (not static from local file system)
      logHandler.type = "generated"
      res.setHeader("content-type", "text/html")

      var stream = opts.defaultIndex || defaultIndex
      stream(
        {
          entry: entrySrc,
          title: opts.title,
          css: opts.css,
          base: opts.base === true ? "/" : opts.base || null
        },
        req
      ).pipe(res)
    } else {
      next()
    }
  }

  function serveBundledLiveReload(res, successCallback) {
    if (liveReloadClient) {
      res.end(liveReloadClient)
      successCallback(true)
    } else {
      liveReloadClient = src
      res.end(src)
      successCallback(true)
    }
  }

  function serveBrowserifyLiveReload(cache, debug, liveScripts, res) {
    // Browserify the client file, e.g. if user has a script to include
    if (cache && liveReloadClient) {
      res.end(liveReloadClient)
    } else {
      var b = browserify({ debug: debug })
      b.add(liveReloadClientFile)
      if (live.expose) {
        b.require(liveReloadClientFile, { expose: "budo-livereload" })
      }

      liveScripts.forEach(function (file) {
        b.add(path.resolve(file))
      })
      b.bundle(function (err, src) {
        if (err) {
          console.error("Error bundling LiveReload client:\n" + err.message)
          res.statusCode = 500
          res.end("Error bundling LiveReload client: " + err)
        } else {
          liveReloadClient = src
          res.end(src)
        }
      })
    }
  }

  function liveReloadHandler(req, res, next) {
    if (!live || live.plugin) return next()
    if (!liveScriptUrl) {
      liveScriptUrl = live.path || "/budo/livereload.js"
      logHandler.ignores.push(liveScriptUrl)
    } else if (liveScriptUrl && live.path && liveScriptUrl !== live.path) {
      var errMessage =
        "Error: The LiveReload path field cannot be changed dynamically.\n" +
        "Please open an issue in budo if you have a specific use case for this."
      console.error(errMessage)
      res.statusCode = 500
      res.end(errMessage)
      return
    }

    if (req.url === liveScriptUrl) {
      res.statusCode = 200
      res.setHeader("Content-Type", "application/javascript")
      var liveScripts = (Array.isArray(live.include) ? live.include : [live.include]).filter(Boolean)
      var cache = live.cache !== false
      var debug = live.debug

      // Default setup - use a bundled JS file for LiveReload client
      if (shouldUseBundledLiveReload && cache && !debug && liveScripts.length === 0) {
        serveBundledLiveReload(res, function (success) {
          // fall back to browserify on the fly
          if (!success) serveBrowserifyLiveReload(cache, debug, liveScripts, res)
        })
      } else {
        serveBrowserifyLiveReload(cache, debug, liveScripts, res)
      }
    } else {
      liveInjector.path = liveScriptUrl
      liveInjector(req, res, next)
    }
  }
}

function createBudoServer(entryMiddleware, opts, cb) {
  var handler = createBudoMiddleware(entryMiddleware, opts)
  var ssl = opts.ssl

  if ((ssl && !opts.cert && opts.key) || (!opts.key && opts.cert)) {
    throw new TypeError(
      "If you specify a cert, you must specify a key and vice versa.\n" +
        'Or, you can omit the "cert" and "key" options to generate a new self-signed certificate.'
    )
  }

  if (opts.ssl) {
    if (opts.cert && opts.key) {
      // user specified their own cert/key pair
      create({
        cert: fs.readFileSync(opts.cert),
        key: fs.readFileSync(opts.key)
      })
    } else {
      console.error("please provide ssl cert to opts.cert and opts.key")
      throw new Error("no ssl certificate provided")
    }
  } else {
    create()
  }

  function create(httpsOpts) {
    var server = ssl ? https.createServer(httpsOpts, handler) : http.createServer(handler)
    server.setLiveOptions = handler.setLiveOptions
    // TODO: Perhaps --ssl should support some sort of HTTP -> HTTPS redirect
    process.nextTick(function () {
      cb(null, server)
    })
  }
}

function parseError(err) {
  if (err.codeFrame) {
    // babelify@6.x
    return [err.message, err.codeFrame].join("\n\n")
  } else {
    // babelify@5.x and browserify
    return err.annotated || err.message
  }
}

function createWatchifyBundler(browserify, opt) {
  opt = opt || {}
  var emitter = new EventEmitter()
  var delay = opt.delay || 0
  var closed = false
  var pending = false
  var time = Date.now()
  var updates = []
  var errorHandler = opt.errorHandler
  if (errorHandler === true) {
    errorHandler = defaultErrorHandler
  }

  var watchify = createWatchify(
    browserify,
    Object.assign({}, opt, {
      // we use our own debounce, so make sure watchify
      // ignores theirs
      delay: 0
    })
  )
  var contents = null

  emitter.close = function () {
    if (closed) return
    closed = true
    if (watchify) {
      // needed for watchify@3.0.0
      // this needs to be revisited upstream
      setTimeout(function () {
        watchify.close()
      }, 200)
    }
  }

  var bundleDebounced = debounce(bundle, delay)
  watchify.on("update", function (rows) {
    if (closed) return
    updates = rows
    pending = true
    time = Date.now()
    emitter.emit("pending", updates)
    bundleDebounced()
  })

  emitter.bundle = function () {
    if (closed) return
    time = Date.now()
    if (!pending) {
      pending = true
      process.nextTick(function () {
        emitter.emit("pending", updates)
      })
    }
    bundle()
  }

  // initial bundle
  if (opt.initialBundle !== false) {
    emitter.bundle()
  }

  return emitter

  function bundle() {
    if (closed) {
      update()
      return
    }

    var didError = false
    var outStream = concat(function (body) {
      if (!didError) {
        contents = body

        var delay = Date.now() - time
        emitter.emit("log", {
          contentLength: contents.length,
          elapsed: Math.round(delay),
          level: "info",
          type: "bundle"
        })

        bundleEnd()
      }
    })

    var wb = watchify.bundle()
    // it can be nice to handle errors gracefully
    if (typeof errorHandler === "function") {
      wb.once("error", function (err) {
        err.message = parseError(err)
        contents = errorHandler(err) || ""

        didError = true
        emitter.emit("bundle-error", err)
        bundleEnd()
      })
    } else {
      wb.once("error", function (err) {
        err.message = parseError(err)
        emitter.emit("error", err)
        emitter.emit("bundle-error", err)
      })
    }
    wb.pipe(outStream)

    function bundleEnd() {
      update()
    }
  }

  function update() {
    if (closed) return
    if (pending) {
      pending = false
      emitter.emit("update", contents, updates)
      updates = []
    }
  }
}

function defaultErrorHandler(err) {
  console.error("%s", err)
  var msg = stripAnsi(err.message)
  return ";console.error(" + JSON.stringify(msg) + ");"
}

function watchifyMiddleware(browserify, opt) {
  var emitter = createWatchifyMiddleware(browserify, opt)
  return emitter.middleware
}

function createWatchifyMiddleware(browserify, opt) {
  var b = createWatchifyBundler(browserify, opt)
  var pending = false
  var contents = ""

  b.on("pending", function () {
    pending = true
  })

  b.on("update", function (data) {
    pending = false
    contents = data
  })

  b.middleware = function middleware(req, res) {
    if (pending) {
      b.emit("log", {
        level: "debug",
        type: "request",
        message: "bundle pending"
      })

      b.once("update", function () {
        b.emit("log", {
          level: "debug",
          type: "request",
          message: "bundle ready"
        })
        submit(req, res)
      })
    } else {
      submit(req, res)
    }
  }

  return b

  function submit(req, res) {
    res.setHeader("content-type", "application/javascript; charset=utf-8")
    res.setHeader("content-length", contents.length)
    res.statusCode = req.statusCode || 200
    res.end(contents)
  }
}

function createBundler(files, opts) {
  var bOpts = xtend(
    {
      cache: {},
      packageCache: {},
      debug: opts.debug
    },
    opts.browserify
  )

  var bundler
  var args = opts.browserifyArgs
  if (args && Array.isArray(args)) {
    // CLI args for browserify
    bundler = fromArgs(args, bOpts)
  } else {
    // just assume JS only options
    bundler = browserify(bOpts)
  }

  files.forEach(function (file) {
    bundler.add(path.resolve(file))
  })

  //bundler.transform([sucrasify, {global: true}])
  //bundler.transform("glslify")
  bundler.transform(shaderReloadTransform)
  
  

  var errorHandler = opts.errorHandler

  // if (typeof errorHandler !== "function" && errorHandler !== false) {
  //   console.log("using default error handler!!!!!!!!!!!!!!!!!!")
  //   errorHandler = defaultErrorHandler
  // }

  var cwd = opts.cwd
  var rootDirName

  if (cwd) {
    cwd = path.normalize(cwd)
    rootDirName = path.basename(cwd) + path.sep
  }

  return createWatchifyMiddleware(bundler, {
    delay: opts.delay || 0,
    initialBundle: false,
    errorHandler:
      typeof errorHandler === "function"
        ? function (err) {
            return errorHandler(err, cwd, rootDirName)
          }
        : errorHandler
  })
}

function createFileWatch(glob, watchOpt) {
  watchOpt = xtend(
    {
      usePolling: watchOpt && watchOpt.poll,
      ignored: [
        //"node_modules/**",
        "bower_components/**",
        ".git",
        ".hg",
        ".svn",
        ".DS_Store",
        "*.swp",
        "thumbs.db",
        "desktop.ini"
      ],
      ignoreInitial: true
    },
    watchOpt
  )

  var emitter = new EventEmitter()
  var closed = false

  var watcher = Chokidar.watch(glob, watchOpt)
  watcher.on("add", onWatch.bind(null, "add"))
  watcher.on("add", onWatch.bind(null, "add"))

  watcher.on("change", onWatch.bind(null, "change"))

  //watcher.on("add", (event, path) => emitter.emit("watch", event, path))

  function onWatch(event, path) {
    emitter.emit("watch", event, path)
  }

  emitter.close = function () {
    if (closed) return
    watcher.close()
    closed = true
  }
  return emitter
}

function createBudo(entries, opts) {
  //var log = bole("budo")

  // if no entries are specified, just options
  if (entries && !Array.isArray(entries) && typeof entries === "object") {
    opts = entries
    entries = []
  }

  // do not mutate user options
  opts = xtend({}, defaults, { stream: false }, opts)
  entries = entries || []

  // perhaps later this will be configurable
  opts.cwd = process.cwd()

  // log to output stream
  if (opts.stream) {
    // by default, pretty-print to the stream with info logging
    if (!opts.ndjson) {
      var pretty = garnish({
        level: opts.verbose ? "debug" : "info",
        name: "budo"
      })
      pretty.pipe(opts.stream)
      opts.stream = pretty
    }

    bole.output({
      stream: opts.stream,
      level: "debug"
    })
  }

  // optionally allow as arrays
  entries = [].concat(entries).filter(Boolean)
  var entryFiles = entries

  // var entryObjects = entries.map(mapEntry)
  // var entryFiles = entryObjects.map(function (entry) {
  //   return entry.from
  // })

  if (opts.serve && typeof opts.serve !== "string") {
    throw new TypeError("opts.serve must be a string or undefined")
  } else if (!opts.serve && entries.length > 0) {
    ////entryObjects[0].url (removed deps entry:bundle feature, just be explicit with --serve)
    var serveUrl = path.parse(path.resolve(process.cwd(), entries[0])).base
    //console.log(`Serving the bundle as ${serveUrl}`)
    opts.serve = serveUrl
  }

  // default to cwd
  if (!opts.dir || opts.dir.length === 0) {
    opts.dir = opts.cwd
  }

  var emitter = new EventEmitter()
  var bundler, middleware

  if (entries.length > 0 || (opts.browserify && opts.browserify.entries)) {
    bundler = createBundler(entries, opts)

    middleware = bundler.middleware

    bundler.on("log", function (ev) {
      if (ev.type === "bundle") {
        var time = ev.elapsed
        ev.elapsed = time
        ev.name = "browserify"
        ev.type = undefined
        ev.colors = {
          elapsed: time > 1000 ? "yellow" : "dim",
          message: "dim "
        }
        log.info(ev)
      }
    })

    // uncaught syntax errors should not stop the server
    // this only happens when errorHandler: false
    bundler.on("error", function (err) {
      console.error("Error:", err.message ? err.message : err)
    })
    bundler.on("bundle-error", emitter.emit.bind(emitter, "bundle-error"))
    bundler.on("update", emitter.emit.bind(emitter, "update"))
    bundler.on("pending", emitter.emit.bind(emitter, "pending"))

    emitter.on("update", function (contents, deps) {
      if (deps.length > 1) {
        log.debug({
          name: "browserify",
          message: deps.length + " files changed"
        })
      }
    })
  }

  var defaultInternalIp = "localhost" //internalIp.v4.sync()
  var defaultWatchGlob = opts.watchGlob || "**/*.{html,css}"
  var server = null
  var closed = false
  var started = false
  var fileWatcher = null
  var reloader = null
  var deferredWatch = noop
  var deferredLive = noop

  // public API
  emitter.close = once(close)
  emitter.reload = reload
  emitter.error = errorPopup
  emitter.live = live
  emitter.watch = watch

  // setup defaults for live reload / watchify
  if (opts.live) {
    var initialLiveOpts = typeof opts.live === "object" ? opts.live : undefined
    var initialLiveMatch = typeof opts.live === "string" ? opts.live : undefined
    if (initialLiveMatch) {
      emitter.once("connect", function () {
        log.info({ message: "LiveReload filtering filenames with glob:", url: initialLiveMatch })

        // if (entryObjects.length === 0) {
        //   log.info({
        //     message:
        //       "\nNOTE: It looks like you are using budo without a JavaScript entry.\n" +
        //       '  This is fine, but if you were trying to bundle the "' +
        //       initialLiveMatch +
        //       '" file,\n  you should re-arrange' +
        //       " your arguments like so:\n\n" +
        //       "      budo " +
        //       initialLiveMatch +
        //       " --live"
        //   })
        // }
      })
    }
    emitter
      .watch()
      .live(initialLiveOpts)
      .on("watch", function (ev, file) {
        if (ev !== "change" && ev !== "add") {
          return
        }
        defaultFileEvent(file)
      })
      .on("pending", function () {
        defaultFileEvent(opts.serve)
      })
  }

  // First, setup a server
  createBudoServer(middleware, xtend(opts, { ip: defaultInternalIp }), function (err, serverInstance) {
    if (err) {
      emitter.emit("error", err)
      return
    }

    server = serverInstance

    // start connect
    if (!closed) {
      server.on("error", function (err) {
        if (err.code === "EADDRINUSE") {
          err.message = "port " + opts.port + " is in use"
          emitter.emit("error", err)
        } else {
          emitter.emit("error", err)
        }
      })
      server.listen(opts.port, opts.host || undefined, connect)
    }
  })

  return emitter

  function defaultFileEvent(file) {
    var filename = path.basename(file)
    if ((Array.isArray(opts.live) || typeof opts.live === "string") && isMatch(filename, opts.live).length === 0) {
      return
    }
    emitter.reload(file)
  }

  function reload(file) {
    process.nextTick(emitter.emit.bind(emitter, "reload", file))
    if (reloader) {
      reloader.reload(file)
    }
  }

  function errorPopup(message) {
    if (reloader) {
      reloader.errorPopup(message)
    }
  }

  // enable file watch capabilities
  function watch(glob, watchOpt) {
    if (!started) {
      deferredWatch = emitter.watch.bind(null, glob, watchOpt)
    } else {
      // destroy previous
      if (fileWatcher) fileWatcher.close()
      glob = glob && glob.length > 0 ? glob : defaultWatchGlob
      glob = Array.isArray(glob) ? glob : [glob]
      watchOpt = xtend({ poll: opts.poll }, watchOpt)

      fileWatcher = createFileWatch(glob, watchOpt)
      fileWatcher.on("watch", emitter.emit.bind(emitter, "watch"))
    }
    return emitter
  }

  // enables LiveReload capabilities
  function live(liveOpts) {
    if (!started) {
      deferredLive = emitter.live.bind(null, liveOpts)
    } else {
      // destroy previous
      if (reloader) reloader.close()

      // pass some options for the server middleware
      server.setLiveOptions(xtend(liveOpts))

      // create a web socket server for live reload
      reloader = createReloadServer(server, opts)
    }
    return emitter
  }

  function getHostAddress(host) {
    // user can specify "::" or "0.0.0.0" as host exactly
    // or if undefined, default to internal-ip
    if (!host) {
      host = server.address().address
      if (host === "0.0.0.0") {
        // node 0.10 returns this when no host is specified
        // node 0.12 returns internal-ip
        host = "::"
      }
    }
    if (host === "::") {
      host = defaultInternalIp
    }
    if (!host) {
      host = "127.0.0.1"
    }
    return host
  }

  function handlePorts(err, result) {
    if (closed) return
    if (err) {
      emitter.emit("error", err)
      return
    }

    //opts.port = result.port

    // improve error messaging
    server.on("error", function (err) {
      if (err.code === "EADDRINUSE") {
        err.message = "port " + opts.port + " is in use"
        emitter.emit("error", err)
      } else {
        emitter.emit("error", err)
      }
    })

    // start server
    // no host -> use localhost + internal-ip
    server.listen(opts.port, opts.host || undefined, connect)
  }

  function connect() {
    if (closed) return
    started = true

    // default host is internal IP
    opts.host = getHostAddress(opts.host)

    var port = opts.port
    var protocol = opts.ssl ? "https" : "http"
    var uri = protocol + "://" + opts.host + ":" + port + "/"

    log.info({ message: "Server running at", url: uri, type: "connect" })

    // if live() or watch() was called before connection
    deferredWatch()
    deferredLive()

    // provide info on server connection
    emitter.emit("connect", {
      uri: uri,
      port: port,
      host: opts.host,
      serve: opts.serve,
      entries: entries,
      server: server,
      webSocketServer: reloader ? reloader.webSocketServer : undefined,
      dir: opts.dir
    })

    // initial bundle should come after
    // connect event!
    if (bundler) bundler.bundle()

    // launch browser
    if (opts.open) {
      openUrl(uri)
    }
  }

  function close() {
    var next = emitter.emit.bind(emitter, "exit")
    if (started) {
      server.once("close", next)
    } else {
      process.nextTick(next)
    }

    if (started) bole.reset()
    if (started) server.close()
    if (reloader) reloader.close()
    if (bundler) bundler.close()
    if (fileWatcher) fileWatcher.close()
    closed = true
    started = false
  }
}

module.exports = (...args) => attachShaderReload(createBudo(...args))
