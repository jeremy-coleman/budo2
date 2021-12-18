//var reloadCSS = require('./reload-css')
//var errorPopup = require('./error-popup')

module.exports = connect()


var popupContainer
var popupText

function reloadCSS(url, opt) {
  // by default, only reloads local style sheets
  var localOnly = true
  if (opt && opt.local === false) {
    localOnly = false
  }

  // Find all <link> and <style> tags
  var nodes = ["link", "style"]
    .map(elements)
    .reduce(function (a, b) {
      return a.concat(b)
    }, [])
    .filter((el) => {
      if (isPrintMedia(el)) return false
      if (el.tagName === "LINK") {
        if (!el.getAttribute("href")) return false
        if (localOnly && !isLocalStylesheet(el)) return false
      }
      return true
    })
    .map((el) => {
      return { element: el }
    })

  var imports = []

  var keyToMatch = null
  var matchImports = imports
  if (keyToMatch) {
    // only match target imports
    matchImports = matchImports.filter(function (imported) {
      return imported.key === keyToMatch
    })
  }

  // Now find any URLs referenced by a <link> tag
  var matchLinks = nodes.filter(function (node) {
    // no keyToMatch just means bust all link tags
    var isMatch = keyToMatch ? node.key === keyToMatch : true
    return node.element.tagName === "LINK" && isMatch
  })

  // And re-attach each link tag
  matchLinks.forEach((node) => {
    node.element = reattachLink(node.element)
  })
}

function reattachLink(link, cb) {
  var href = link.getAttribute("href")
  var cloned = link.cloneNode(false)
  cloned.href = href + `?${String(Date.now())}` //getCacheBustUrl(href);

  var parent = link.parentNode
  if (parent.lastChild === link) {
    parent.appendChild(cloned)
  } else {
    parent.insertBefore(cloned, link.nextSibling)
  }
  cloned.onload = function () {
    if (link.parentNode) link.parentNode.removeChild(link)
    if (cb) cb()
  }
  return cloned
}

function isLocalStylesheet(link) {
  var href = link.getAttribute("href")
  if (!href || link.getAttribute("rel") !== "stylesheet") return false
  if (href.includes("http")) return false
  return true
}

function isPrintMedia(link) {
  return link.getAttribute("media") === "print"
}

function elements(tag) {
  return Array.prototype.slice.call(document.getElementsByTagName(tag))
}

function hide () {
  if (popupContainer && popupContainer.parentNode) {
    popupContainer.parentNode.removeChild(popupContainer)
  }
  if (popupText && popupText.parentNode) {
    popupText.parentNode.removeChild(popupText)
  }
  popupContainer = null
  popupText = null

  // In case multiple bundles are running in page... a very edge case!
  var previous = document.querySelector('.budo-error-handler-popup-element')
  if (previous && previous.parentElement) {
    previous.parentElement.removeChild(previous)
  }


}

function show (message) {
  hide()
  var element = document.createElement('div')
  element.className = 'budo-error-handler-popup-element'
  var child = document.createElement('pre')
  child.textContent = message

  css(element, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    zIndex: '100000000',
    padding: '0',
    margin: '0',
    'box-sizing': 'border-box',
    background: 'transparent',
    display: 'block',
    overflow: 'initial'
  })
  css(child, {
    padding: '20px',
    overflow: 'initial',
    zIndex: '100000000',
    'box-sizing': 'border-box',
    background: '#fff',
    display: 'block',
    'font-size': '12px',
    'font-weight': 'normal',
    'font-family': 'monospace',
    'word-wrap': 'break-word',
    'white-space': 'pre-wrap',
    color: '#ff0000',
    margin: '10px',
    border: '1px dashed hsla(0, 0%, 50%, 0.25)',
    borderRadius: '5px',
    boxShadow: '0px 10px 20px rgba(0, 0, 0, 0.2)'
  })
  element.appendChild(child)
  document.body.appendChild(element)
  popupText = child
  popupContainer = element
}

function css (element, obj) {
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) element.style[k] = obj[k]
  }
  return obj
}

// EXPERIMENTAL: This feature may not last, use carefully.
// Attaches the API to 'budo-livereload' so you don't need to
// expose and require() it.
window['budo-livereload'] = module.exports

function connect () {
  var reconnectPoll = 1000
  var maxRetries = 50
  var retries = 0
  var reconnectInterval
  var isReconnecting = false
  var protocol = document.location.protocol
  var hostname = document.location.hostname
  var port = document.location.port
  var host = hostname + ':' + port

  var isIOS = /(iOS|iPhone|iPad|iPod)/i.test(navigator.userAgent)
  var isSSL = /^https:/i.test(protocol)
  var queued = []
  var socket = createWebSocket()
  var listeners = []

  var api = {
    send: function (message) {
      message = JSON.stringify(message)
      if (socket && socket.readyState === 1) {
        socket.send(message)
      } else {
        queued.push(message)
      }
    },
    listen: function (cb) {
      if (typeof cb !== 'function') {
        throw new TypeError('cb must be a function!')
      }
      listeners.push(cb)
    },
    removeListener: function (cb) {
      var idx = listeners.indexOf(cb)
      if (idx !== -1) {
        listeners.splice(idx, 1)
      }
    },
    showError: function (message) {
      errorPopup.show(message)
    },
    clearError: function () {
      errorPopup.hide()
    },
    reloadPage: reloadPage,
    reloadCSS: reloadCSS
  }

  return api

  function scheduleReconnect () {
    if (isIOS && isSSL) {
      // Special case for iOS with a self-signed certificate.
      console.warn('[budo] LiveReload disconnected. You may need to generate and ' +
        'trust a self-signed certificate, see here:\n' +
        'https://github.com/mattdesl/budo/blob/master/docs/' +
        'command-line-usage.md#ssl-on-ios')
      return
    }
    if (isSSL) {
      // Don't attempt to re-connect in SSL since it will likely be insecure
      console.warn('[budo] LiveReload disconnected. Please reload the page to retry.')
      return
    }
    if (retries >= maxRetries) {
      console.warn('[budo] LiveReload disconnected, exceeded retry count. Please reload the page to retry.')
      return
    }
    if (!isReconnecting) {
      isReconnecting = true
      console.warn('[budo] LiveReload disconnected, retrying...')
    }
    retries++
    clearTimeout(reconnectInterval)
    reconnectInterval = setTimeout(reconnect, reconnectPoll)
  }

  function reconnect () {
    if (socket) {
      // force close the existing socket
      socket.onclose = function () {}
      socket.close()
    }
    socket = createWebSocket()
  }

  function createWebSocket () {
    var wsProtocol = isSSL ? 'wss://' : 'ws://'
    var wsUrl = wsProtocol + host + '/livereload'
    var ws = new window.WebSocket(wsUrl)
    ws.onmessage = function (event) {
      var data
      try {
        data = JSON.parse(event.data)
      } catch (err) {
        console.warn('Error parsing LiveReload server data: ' + event.data)
        return
      }

      if (data.event === 'reload') {
        if (/^\.?css$/i.test(data.ext)) {
          reloadCSS(data.url)
        } else {
          reloadPage()
        }
      } else if (data.event === 'error-popup') {
        if (data.message) errorPopup.show(data.message)
        else errorPopup.hide()
      }

      // let listeners receive data
      listeners.forEach(function (listener) {
        listener(data)
      })
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
        console.warn('[budo] LiveReload reconnected.')
      }
      if (queued.length && ws.readyState === 1) {
        queued.forEach(function (message) {
          ws.send(message)
        })
        queued.length = 0
      }
    }
    ws.onerror = function () {
      return false
    }
    return ws
  }
}

function reloadPage () {
  window.location.reload(true)
}
