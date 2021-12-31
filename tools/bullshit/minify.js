var Terser = require("terser")
var fs = require("fs")

var TERSER_CONFIG = {
  compress: {
    passes: 10,
    dead_code: true,
    keep_infinity: true,
    ecma: 9,
    hoist_funs: true,
    reduce_funcs: false, // i think this will cause polymorphic expressions
    unsafe_math: true,
    unsafe_proto: true, //good for perf maybe? but way slow to bundle
    unsafe_undefined: true, // turns undefined into void 0 , should really be called ensure_safe_undefined
    unsafe_regexp: true,
    negate_iife: false,
    unsafe_arrows: true, //arrow fns run faster in v8
    pure_getters: true,
    hoist_vars: true,
    arguments: true,
    unsafe_methods: true

    //keep_fnames: true //idk seems like you should
  },
  // mangle:{
  //   //keep_fnames: true,
  //   module: true,
  //   //regex: /^_MIN_/
  // },

  ecma: 9,
  module: true,
  //nameCache: {},
  toplevel: true,
  output: {
    ecma: 9,
    wrap_iife: true
  }
}

Terser.minify(fs.readFileSync("src/platformer/app.js").toString(), TERSER_CONFIG).then((data) => {
  fs.writeFileSync("./src/platformer/app.min.js", data.code)
})
