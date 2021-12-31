var URL = require("url")
var path = require("path")

//const { extname } = require("path")

//first = ee-first
//pushState = connect-pushstate
//on-finished = onFinished (default), isFinished
//on-header = onHeaders
//stacked = stacked

var onResHeaders = onHeaders
var onResFinished = onFinished
var isResFinished = isFinished

module.exports = {
  pushState,
  first,
  onFinished,
  isFinished,
  onHeaders,
  stacked,

  onResHeaders,
  onResFinished,
  isResFinished
}

function pushState(options) {
  options = options || {}
  var root = options.root || "/"
  var allow = options && (options.allow = new RegExp(options.allow))
  var disallow = options && (options.disallow = new RegExp(options.disallow))
  return function pushState(req, res, next) {
    var pathname = URL.parse(req.url).pathname
    var allowed = allow && allow.test(pathname)
    var disallowed = disallow && disallow.test(pathname)
    var hasFileExtension = !!path.extname(pathname)
    if (allowed || (!disallowed && hasFileExtension)) {
      next()
    } else {
      req.url = root
      next()
    }
  }
}

function first(stuff, done) {
  if (!Array.isArray(stuff)) {
    throw new TypeError("arg must be an array of [ee, events...] arrays")
  }
  var cleanups = []
  for (var i = 0; i < stuff.length; i++) {
    var arr = stuff[i]
    if (!Array.isArray(arr) || arr.length < 2) {
      throw new TypeError("each array member must be [ee, events...]")
    }
    var ee = arr[0]
    for (var j = 1; j < arr.length; j++) {
      var event = arr[j]
      var fn = listener(event, callback)
      ee.on(event, fn)
      cleanups.push({
        ee: ee,
        event: event,
        fn: fn
      })
    }
  }
  function callback() {
    cleanup()
    done.apply(null, arguments)
  }
  function cleanup() {
    var x
    for (var i = 0; i < cleanups.length; i++) {
      x = cleanups[i]
      x.ee.removeListener(x.event, x.fn)
    }
  }
  function thunk(fn) {
    done = fn
  }
  thunk.cancel = cleanup
  return thunk
}
function listener(event, done) {
  return function onevent(arg1) {
    var args = new Array(arguments.length)
    var ee = this
    var err = event === "error" ? arg1 : null
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    done(err, ee, event, args)
  }
}

function onFinished(msg, listener) {
  if (isFinished(msg) !== false) {
    setImmediate(listener, null, msg)
    return msg
  }
  attachListener(msg, listener)
  return msg
}
function isFinished(msg) {
  var socket = msg.socket
  if (typeof msg.finished === "boolean") {
    return Boolean(msg.finished || (socket && !socket.writable))
  }
  if (typeof msg.complete === "boolean") {
    return Boolean(msg.upgrade || !socket || !socket.readable || (msg.complete && !msg.readable))
  }
  return undefined
}
function attachFinishedListener(msg, callback) {
  var eeMsg
  var eeSocket
  var finished = false
  function onFinish(error) {
    eeMsg.cancel()
    eeSocket.cancel()
    finished = true
    callback(error)
  }
  eeMsg = eeSocket = first([[msg, "end", "finish"]], onFinish)
  function onSocket(socket) {
    msg.removeListener("socket", onSocket)
    if (finished) return
    if (eeMsg !== eeSocket) return
    eeSocket = first([[socket, "error", "close"]], onFinish)
  }
  if (msg.socket) {
    onSocket(msg.socket)
    return
  }
  msg.on("socket", onSocket)
  if (msg.socket === undefined) {
    patchAssignSocket(msg, onSocket)
  }
}
function attachListener(msg, listener) {
  var attached = msg.__onFinished
  if (!attached || !attached.queue) {
    attached = msg.__onFinished = createListener(msg)
    attachFinishedListener(msg, attached)
  }
  attached.queue.push(listener)
}
function createListener(msg) {
  function listener(err) {
    if (msg.__onFinished === listener) msg.__onFinished = null
    if (!listener.queue) return
    var queue = listener.queue
    listener.queue = null
    for (var i = 0; i < queue.length; i++) {
      queue[i](err, msg)
    }
  }
  listener.queue = []
  return listener
}
function patchAssignSocket(res, callback) {
  var assignSocket = res.assignSocket
  if (typeof assignSocket !== "function") return
  res.assignSocket = function _assignSocket(socket) {
    assignSocket.call(this, socket)
    callback(socket)
  }
}

function createWriteHead(prevWriteHead, listener) {
  var fired = false
  return function writeHead(statusCode) {
    var args = setWriteHeadHeaders.apply(this, arguments)
    if (!fired) {
      fired = true
      listener.call(this)
      if (typeof args[0] === "number" && this.statusCode !== args[0]) {
        args[0] = this.statusCode
        args.length = 1
      }
    }
    return prevWriteHead.apply(this, args)
  }
}
function onHeaders(res, listener) {
  if (!res) {
    throw new TypeError("argument res is required")
  }
  if (typeof listener !== "function") {
    throw new TypeError("argument listener must be a function")
  }
  res.writeHead = createWriteHead(res.writeHead, listener)
}
function setHeadersFromArray(res, headers) {
  for (var i = 0; i < headers.length; i++) {
    res.setHeader(headers[i][0], headers[i][1])
  }
}
function setHeadersFromObject(res, headers) {
  var keys = Object.keys(headers)
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (k) res.setHeader(k, headers[k])
  }
}
function setWriteHeadHeaders(statusCode) {
  var length = arguments.length
  var headerIndex = length > 1 && typeof arguments[1] === "string" ? 2 : 1
  var headers = length >= headerIndex + 1 ? arguments[headerIndex] : undefined
  this.statusCode = statusCode
  if (Array.isArray(headers)) {
    setHeadersFromArray(this, headers)
  } else if (headers) {
    setHeadersFromObject(this, headers)
  }
  var args = new Array(Math.min(length, headerIndex))
  for (var i = 0; i < args.length; i++) {
    args[i] = arguments[i]
  }
  return args
}

function stacked(/* fn1, fn2, ... */) {
  var handle = function (req, res, out) {
    var i = 0
    function next(err) {
      var layer = handle.layers[i++]

      if (!layer || res.headersSent) {
        // all done
        if (out) return out(err) // delegate to parent

        if (err && res.statusCode < 400) res.statusCode = err.status || 500
        else res.statusCode = 404

        return res.end()
      }

      try {
        layer(req, res, next)
      } catch (e) {
        next(e)
      }
    }
    next()
  }

  handle.layers = Array.prototype.slice.call(arguments)

  handle.use = function (fn) {
    if (typeof fn == "object" && fn.handle) fn = fn.handle.bind(fn)
    handle.layers.push(fn)
    return this
  }

  handle.mount = function (path, fn) {
    return this.use(sub(path, fn))
  }

  return handle
}

function sub(mount, fn) {
  if (mount.substr(-1) != "/") mount += "/"
  if (typeof fn == "object" && fn.handle) fn = fn.handle.bind(fn)

  return function (req, res, next) {
    var url = req.url,
      uri = req.uri

    if (url.substr(0, mount.length) !== mount && url.substr(0, mount.length) + "/" !== mount) return next()

    // modify the URL
    if (!req.realUrl) req.realUrl = url

    req.url = url.substr(mount.length - 1)
    if (req.uri) req.uri = URL.parse(req.url)

    fn(req, res, function (err) {
      // reset the URL
      req.url = url
      req.uri = uri
      next(err)
    })
  }
}
