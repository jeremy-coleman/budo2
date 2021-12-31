var path = require("path")
var budo = require("./tools/budo")
var sucrasify = require("./tools/transforms/sucrasify")

process.env.NODE_PATH = path.resolve(__dirname, "src")

function start() {
  budo("./src/platformer/app.tsx", {
    //live: '**/*.{html,css}',
    live: true,
    port: 3000,
    host: "localhost",
    serve: "app.js",
    dir: "./src/platformer",
    debug: true,
    stream: process.stdout,
    browserify: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      cache: {},
      packageCache: {},
      transform: [[sucrasify, { global: true }]]
    }
  })
}

start()
