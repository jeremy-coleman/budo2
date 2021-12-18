var path = require("path")
var budo = require("./src/budolite/budo")

//var withShaderReload = require("./src/shader-reload/budo-attach")
const sucrasify = require("./tools/transforms/sucrasify")

process.env.NODE_PATH = path.resolve(__dirname, "src")

//todo: tfilter globalTransforms and remove transforms

budo("./src/example-web/app.js", {
  live: "**/*.{html,css,js}",
  //live: true,
  port: 3002,
  host: "localhost",
  serve: "bundle.js",
  dir: "./src/example-web",
  stream: process.stdout,
  debug: true,
  browserify: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    cache: {},
    packageCache: {},
    debug: false,
    sourceMaps: false,
    fullPaths: false,
    transform: [
      //tsify
      sucrasify
      //[sucrasify, { global: true }]
    ]
  }
})
// .on('connect', (ev) => {
//   console.log('Server running on %s', ev.uri)
// })
// .on('update', (buffer) => {
//   console.log('bundle - %d bytes', buffer.length)
// })

//var babelify = require("babelify")
//var browserify = require("browserify")
//b.transform([babelify.configure(BABEL_CONFIG), {global: true}])

// const BABEL_CONFIG = {
//   extensions: [".js", ".jsx", ".tsx", ".ts", ".mjs", ".json"],
//   plugins: [
//     ["babel-plugin-macros"],
//     [
//       "@babel/plugin-transform-typescript",
//       { isTSX: true, allExtensions: true, allowNamespaces: true },
//     ],
//     [require.resolve("./tools/babel-plugins/import-to-promise")],
//     ["@babel/plugin-proposal-decorators", { legacy: true }],
//     "@babel/plugin-syntax-class-properties",
//     ["@babel/plugin-syntax-object-rest-spread"],
//     //["babel-plugin-transform-react-pug"],
//     ["@babel/plugin-transform-react-jsx", { useBuiltIns: true }],
//     ["@babel/plugin-transform-modules-commonjs"],
//     ["babel-plugin-glslify"],
//     [
//       "babel-plugin-module-resolver",
//       {
//         root: ["src"],
//         extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
//         // alias: {
//         //   "coglite": "./src/coglite",
//         //   "@uifabric":"./src/@uifabric",
//         // }
//       },
//     ],
//     //"react-hot-loader/babel",
//   ],
//   sourceMaps: false,
// }

// "devDependencies": {
//   "terser": "5.7.0",
//   "acorn-node": "2.0.1",
//   "alamode": "3.7.1",
//   "glslify": "7.1.1",
//   "babel-plugin-glslify": "2.0.0",
//   "@babel/register": "7.14.5",
//   "@babel/core": "7.14.3",
//   "@babel/plugin-proposal-class-properties": "7.13.0",
//   "@babel/plugin-proposal-decorators": "7.14.2",
//   "@babel/plugin-proposal-dynamic-import": "^7.14.2",
//   "@babel/plugin-proposal-object-rest-spread": "^7.14.2",
//   "@babel/plugin-syntax-class-properties": "7.12.13",
//   "@babel/plugin-transform-modules-commonjs": "7.14.0",
//   "@babel/plugin-transform-react-jsx": "7.14.3",
//   "@babel/plugin-transform-typescript": "7.14.3",
//   "@babel/preset-typescript": "7.13.0",
//   "@babel/template": "^7.12.13",
//   "babel-plugin-macros": "^3.1.0",
//   "babel-plugin-module-resolver": "4.1.0",
//   "babelify": "10.0.0",
//   "fs-jetpack": "4.1.0",
//   "servor": "4.0.2",
//   "@types/node": "15.12.2",
//   "sucrase": "3.18.2",
//   "typescript": "4.3.2"
// }
