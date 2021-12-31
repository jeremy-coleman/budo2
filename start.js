var esbuild = require("esbuild")
var fs = require("fs")
var path = require("path")
var budo = require("./tools/budo")
var sucrasify = require("./tools/transforms/sucrasify")

process.env.NODE_PATH = path.resolve(__dirname, "src")



esbuild.build({
      define: {
        "process.env.NODE_ENV": '"production"'
      },
      bundle: true,
      minify: true,
      loader: {
        ".svg": "file",
        '.wgsl': 'text',
      },
      format: "iife",
      //plugins: [lessLoader()],
      //outdir: "public",
      outfile: "./src/platformer/app.prebuild.js",
      entryPoints: ["src/platformer/app.tsx"],
      platform: "browser",
      watch: true
})
.then(() => {
  start()
})
.catch(e => {
  console.error(e)
  process.exit(0)
})




function start() {
  budo("./src/platformer/app.prebuild.js", {
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
      transform: [
        //[sucrasify, { global: true }]
      ]
    }
  })
}

//start()

function startRegl() {
  return budo("./src/examples/regl/regl.js", {
    live: false,
    stream: process.stdout,
    browserify: {
      transform: [
        //'babelify',
        "glslify"
        //shaderReloadTransform
      ]
    }
  })
}
