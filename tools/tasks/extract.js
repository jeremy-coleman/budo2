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
  input: "src/index.ts",
  //input: "temp/wgpu/index.js",
  output: [
    {
      //dir: "build",
      file: "build/wgpu/index.js",
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
