//https://github.com/rollup/awesome

var path = require("path")
var tsc = require("./tools/rollup-plugin-typescript")
var globalize = require("rollup-plugin-external-globals")
var jetpack = require("fs-jetpack")

var fs = require("fs")
var EXTERNALS = fs.readdirSync("node_modules")


const globals = (id) => {
  if (id.includes("@babylonjs/core")) {
    return "BABYLON";
  }
  else if (id.includes("@babylonjs/gui")) {
    return "BABYLON.GUI";
  }
}

module.exports = {
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false
  },
  //inlineDynamicImports: true,
  //input: "build/jsm/react-babylonjs.js",
  input: "src/react-babylonjs.ts",
  output: [
    {
      //dir: "build",
      file: "build/engineonly/react-babylonjs.js",
      format: "esm",
      //globals: globals,
      globals: {
        "react": "React",
        "react-dom": "ReactDOM"
      }
    }

    //uncomment for .cjs output. Node will load .cjs as commonjs even if closest package.json is type:"module"
    // {
    //   file: path.join(__dirname, ...basePath.split('\\').concat('lib', 'index.cjs')),
    //   format: 'cjs',
    //   interop: false,
    //   globals: globals,
    // },
  ],
  preserveModules: false,
  external: EXTERNALS,
  plugins: [
    tsc(),
    //globalize(globals),
    // globalze({
    //   "jquery": "$",
    //   "@babylon/core": "BABYLON",
    //   "@babylon/gui": "BABYLON.GUI",
    //   "react": "React",
    //   "react-dom": "ReactDOM"
    // })
  ],

  onwarn: function (message) {
    if (/external dependency/.test(message)) {
      return
    }
    if (message.code === "CIRCULAR_DEPENDENCY") {
      return
    } else console.error(message)
  }
}

// const tsFiles = jetpack.find(
//   'packages', { matching: [
//     "**/*.js",
//     "**/*.ts",
//     "**/*.tsx",
//     "**/*.jsx"
// ], files: true, directories: false });
