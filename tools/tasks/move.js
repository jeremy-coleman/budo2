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
  input: "src/index.ts",
  output: [
    {
      dir: "src/babylon-webgpu",
      format: "esm",
      globals: {
        "react": "React",
        "react-dom": "ReactDOM"
      }
    }
  ],
  preserveModules: true,
  //external: fs.readDirSync("node_modules"),
  plugins: [
    tsc(),
    resolve({
      customResolveOptions: {},
      dedupe: [],
      extensions: [".mjs", ".js", ".json", ".node", ".fx", ".ts"],
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
