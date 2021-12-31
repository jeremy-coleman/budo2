//https://github.com/rollup/awesome

var fs = require('fs')
var path = require('path')
var tsc = require('./tools/rollup-plugin-typescript')
var resolve = require("@rollup/plugin-node-resolve").default
var externalGlobals = require("rollup-plugin-external-globals")
var glslify = require("rollup-plugin-glslify")

//let closure = require("@ampproject/rollup-plugin-closure-compiler");
//let { terser } = require("rollup-plugin-terser");

/**
 * options
 * 
 * bundle
 * includeDeps
 * createOptimalFoundation
 * 
 */

var unbundledOptions = {
  inlineDynamicImports: false,
  preserveModules: true,
  output: [
    {
      dir: "build",
      format: 'esm',
      globals: {
        'react': 'React',
        'react-dom': 'ReactDOM',
      },
    }
  ],
}

var glslifyOptions = {
    // Default
    include: [
        '**/*.vs',
        '**/*.fs',
        '**/*.vert',
        '**/*.frag',
        '**/*.glsl',
        '**/*.fx'
    ],

    // Undefined by default
    exclude: 'node_modules/**',

    // Compress shader by default using logic from rollup-plugin-glsl
    compress: true

}

var resolveOptions = {
    customResolveOptions: {},
    dedupe: [],
    extensions: ['.mjs', '.js', '.json', '.node', ".fx"],
    resolveOnly: []
}

module.exports = {
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
      },
      //inlineDynamicImports: true,
      input: "./src/extract.js",
      output: [
        {
          file: "build/extracted.js",
          format: 'esm',
          globals: {
            'react': 'React',
            'react-dom': 'ReactDOM',
          },
        }
      ],
      preserveModules: false,
      
      //external: EXTERNALS,
      //external: (p) => (p && String(p).includes("node_modules")),
      //external: (p) => (p && String(p).includes("babylon")),
      
      plugins: [
        tsc(),
        resolve(resolveOptions),
        glslify(glslifyOptions),
        externalGlobals({
          "jquery": "$"
        })

      ],
      onwarn: function(message) {
        if (/external dependency/.test(message)) {
          return
        }
        if (message.code === 'CIRCULAR_DEPENDENCY') {
          return
        }
        else console.error(message)
      },
      //...unbundledOptions
}


