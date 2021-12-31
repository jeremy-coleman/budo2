const path = require("path")
const budo = require("./tools/budo")

process.env.NODE_PATH = path.resolve(__dirname, "src")

function start() {
  return budo("./src/examples/regl/regl.js", {
      live: false,
      stream: process.stdout,
      browserify: {
        transform: [
          //'babelify',
          "glslify",
          //shaderReloadTransform
        ]
      }
    })
}

start()
