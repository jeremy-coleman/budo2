const path = require("path")

const {
  updateShaderSource,
  isShaderReload,
  isShaderError,
  getErrorEvent,
  getEvent
} = require("./shader-reload.server.js")

function attachShaderReload(budoApp) {
  let wss
  return budoApp
    .live()
    .watch()
    .on("connect", (ev) => {
      wss = ev.webSocketServer
    })
    .on("watch", (e, file) => {
      // Regular CSS/HTML reload for budo
      const ext = path.extname(file)
      if (ext && /\.(css|html?)$/i.test(ext)) {
        budoApp.reload(file)
      }
    })
    .on("bundle-error", (err) => {
      // Check if there was an error in .shader.js
      // If so, report it in the client so the user sees
      // it without having to check their terminal window.
      if (wss && isShaderError(err)) {
        const event = JSON.stringify(getErrorEvent(err))
        wss.clients.forEach((client) => {
          client.send(event)
        })
      }
    })
    .on("update", function (src, deps) {
      if (wss && isShaderReload(deps)) {
        // Shader reload event, send the message data
        const event = JSON.stringify(getEvent(deps))
        wss.clients.forEach((client) => {
          client.send(event)
        })
      } else {
        // Regular JS file reload
        budoApp.reload()
      }
    })
}

module.exports = {
  attachShaderReload
}
