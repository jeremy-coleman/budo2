var tsc = require("./tools/rollup-plugin-typescript")
var glslify = require("rollup-plugin-glslify")
var resolve = require("@rollup/plugin-node-resolve").default

let closure = require("@ampproject/rollup-plugin-closure-compiler");
let { terser } = require("rollup-plugin-terser");

module.exports = {
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false
  },
  //inlineDynamicImports: true,
  //input: "build/jsm/react-babylonjs.js",
  input: "build/all.js",
  //input: "temp/wgpu/index.js",
  output: [
    {
      //dir: "build",
      file: "build/minified.js",
      format: "esm",
      //globals: globals,
      globals: {
        "react": "React",
        "react-dom": "ReactDOM"
      }
    }
  ],
  preserveModules: false,
  //external: fs.readDirSync("node_modules"),
  plugins: [
    tsc(),
    resolve({
      customResolveOptions: {},
      dedupe: [],
      extensions: [".mjs", ".js", ".json", ".node", ".fx"],
      resolveOnly: []
    }),
    glslify({
      include: ["**/*.vs", "**/*.fs", "**/*.vert", "**/*.frag", "**/*.glsl", "**/*.fx"],
      // Undefined by default
      exclude: "node_modules/**",
      compress: true
    }),
    terser({
      mangle: false
    }),
    //377.34kb vs 385.58kb with only terser. have to set mangle to false on terser to make it work. hmmm advanced is 99kb. does it run?lol
    closure({
      compilation_level: "ADVANCED",
    })
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
