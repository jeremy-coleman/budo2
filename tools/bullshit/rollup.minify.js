let closure = require("@ampproject/rollup-plugin-closure-compiler")

module.exports = {
  input: "./public/app.js",
  output: {
    format: "esm",
    file:"./public/app.min.js"
  },
  //external: Object.keys(require("./package.json").dependencies),
  treeshake: {
    moduleSideEffects: false
  },
  inlineDynamicImports: true,
  plugins: [
    //terser(),
    closure()
  ],
  onwarn: function (message) {
    if (/external dependency/.test(message)) {
      return
    }
    if (message.code === "CIRCULAR_DEPENDENCY") {
      return
    }
    if (message.code === "INPUT_HOOK_IN_OUTPUT_PLUGIN") {
      return
    } else console.error(message)
  }
}
