var { EventEmitter } = require("events")

var popupContainer, popupText

function clearPopup() {
  if (popupContainer && popupContainer.parentNode) {
    popupContainer.parentNode.removeChild(popupContainer)
  }
  if (popupText && popupText.parentNode) {
    popupText.parentNode.removeChild(popupText)
  }
  popupContainer = null
  popupText = null
}

function show(message) {
  if (popupText) {
    popupText.textContent = message
    return
  }

  var element = document.createElement("div")
  var child = document.createElement("pre")
  child.textContent = message

  css(element, {
    "position": "fixed",
    "top": "0",
    "left": "0",
    "width": "100%",
    "zIndex": "100000000",
    "padding": "0",
    "margin": "0",
    "box-sizing": "border-box",
    "background": "transparent",
    "display": "block",
    "overflow": "initial"
  })
  css(child, {
    "padding": "20px",
    "overflow": "initial",
    "zIndex": "100000000",
    "box-sizing": "border-box",
    "background": "#fff",
    "display": "block",
    "font-size": "12px",
    "font-weight": "normal",
    "font-family": "monospace",
    "word-wrap": "break-word",
    "white-space": "pre-wrap",
    "color": "#ff0000",
    "margin": "10px",
    "border": "1px dashed hsla(0, 0%, 50%, 0.25)",
    "borderRadius": "5px",
    "boxShadow": "0px 10px 20px rgba(0, 0, 0, 0.2)"
  })
  element.appendChild(child)
  document.body.appendChild(element)
  popupText = child
  popupContainer = element
}

function css(element, obj) {
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) element.style[k] = obj[k]
  }
  return obj
}

class Shader extends EventEmitter {
  constructor(opt) {
    super()
    opt = opt || {}
    this.vertex = opt.vertex || ""
    this.fragment = opt.fragment || ""
    this.version = 0
    this.setMaxListeners(10000)
  }
}

function createWebsocketConnectionListener(opt, cb) {
  opt = opt || {}

  // If budo is running, we will try to hook into that since it
  // will produce less spam in console on reconnect errors.
  const devClient = window["budo-livereload"]
  if (devClient && typeof devClient.listen === "function") {
    return devClient.listen(cb)
  }

  // Otherwise we will just create our own socket interface
  var route = typeof opt.route === "undefined" ? "/" : opt.route

  var reconnectPoll = 1000
  var maxRetries = 50
  var retries = 0
  var reconnectInterval
  var isReconnecting = false
  var protocol = document.location.protocol
  var hostname = document.location.hostname
  var port = document.location.port
  var host = hostname + ":" + port

  var isIOS = /(iOS|iPhone|iPad|iPod)/i.test(navigator.userAgent)
  var isSSL = /^https:/i.test(protocol)
  var socket = createWebSocket()

  function scheduleReconnect() {
    if (isIOS && isSSL) {
      // Special case for iOS with a self-signed certificate.
      return
    }
    if (isSSL) {
      // Don't attempt to re-connect in SSL since it will likely be insecure
      return
    }
    if (retries >= maxRetries) {
      return
    }
    if (!isReconnecting) {
      isReconnecting = true
    }
    retries++
    clearTimeout(reconnectInterval)
    reconnectInterval = setTimeout(reconnect, reconnectPoll)
  }

  function reconnect() {
    if (socket) {
      // force close the existing socket
      socket.onclose = function () {}
      socket.close()
    }
    socket = createWebSocket()
  }

  function createWebSocket() {
    var wsProtocol = isSSL ? "wss://" : "ws://"
    var wsUrl = wsProtocol + host + route
    var ws = new window.WebSocket(wsUrl)
    ws.onmessage = function (event) {
      var data
      try {
        data = JSON.parse(event.data)
      } catch (err) {
        console.warn("Error parsing WebSocket Server data: " + event.data)
        return
      }

      cb(data)
    }
    ws.onclose = function (ev) {
      if (ev.code === 1000 || ev.code === 1001) {
        // Browser is navigating away.
        return
      }
      scheduleReconnect()
    }
    ws.onopen = function () {
      if (isReconnecting) {
        isReconnecting = false
        retries = 0
      }
    }
    ws.onerror = function () {
      return false
    }
    return ws
  }
}

function createShaderWrapper(opt) {
  opt = opt || {}
  return new Shader(opt)
}

var ErrorPopup = {
  hide: clearPopup,
  show: show
}



var shaderMap = {}
var receiver = new EventEmitter()
receiver.setMaxListeners(10000)

function createShader(opt, filename) {
  opt = opt || {}
  var shader = new Shader(opt)
  if (shaderMap && typeof filename === "string") {
    if (filename in shaderMap) {
      // File already exists in cache, we could warn the user...?
    }
    shaderMap[filename] = shader
  }
  return shader
}

function reloadShaders(updates) {
  if (!shaderMap) return
  updates = (Array.isArray(updates) ? updates : [updates]).filter(Boolean)
  if (updates.length === 0) return

  var hasTouched = false
  var hasChanged = false
  updates.forEach(function (update) {
    var file = update.file
    if (!file) {
      // No file field, just skip this...
      return
    }
    if (file in shaderMap) {
      var shader = shaderMap[file]
      var oldVertex = shader.vertex
      var oldFragment = shader.fragment
      shader.vertex = update.vertex || ""
      shader.fragment = update.fragment || ""
      shader.emit("touch")
      hasTouched = true
      if (oldVertex !== shader.vertex || oldFragment !== shader.fragment) {
        shader.emit("change")
        shader.version++
        hasChanged = true
      }
    } else {
      // We have a file field but somehow it didn't end up in our shader map...
      // Maybe user isn't using the reload-shader function?
    }
  })

  // broadcast change events
  if (hasTouched) receiver.emit("touch")
  if (hasChanged) receiver.emit("change")
}

// Listen for LiveReload connections during development
createWebsocketConnectionListener(
  {
    route: "/shader-reload"
  },
  function (data) {
    if (data.event === "shader-reload" || data.event === "reload") {
      ErrorPopup.hide()
    }
    if (data.event === "shader-reload" && data.updates && data.updates.length > 0) {
      reloadShaders(data.updates)
    } else if (data.event === "shader-error" && data.error) {
      ErrorPopup.show(data.error)
    }
  }
)


// module.exports = {
//   createWebsocketConnectionListener,
//   hide: clearPopup,
//   show,
//   Shader,
//   createShaderWrapper,
//   ErrorPopup
// }


module.exports = createShader
