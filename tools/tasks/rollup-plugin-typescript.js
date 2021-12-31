//"@rollup/plugin-typescript@2.0.1",

var fs = require("fs")
var ts = require("typescript")
var pluginutils = require("@rollup/pluginutils")
var resolveId = require("resolve")
var path = require("path")

function endsWith(str, tail) {
  return !tail.length || str.slice(-tail.length) === tail
}

function getDefaultOptions() {
  return {
    noEmitHelpers: true,
    module: "ESNext",
    isolatedModules: true,
    sourceMap: true,
    importHelpers: true
  }
}

// Gratefully lifted from 'look-up', due to problems using it directly:
//   https://github.com/jonschlinkert/look-up/blob/master/index.js
//   MIT Licenced
function findFile(cwd, filename) {
  var fp = cwd ? cwd + "/" + filename : filename

  if (fs.existsSync(fp)) {
    return fp
  }

  var segs = cwd.split(path.sep)

  for (var len = segs.length; len >= 0; len--) {
    var workingDir = segs.slice(0, len).join("/")
    fp = workingDir + "/" + filename
    if (fs.existsSync(fp)) {
      return fp
    }
  }

  return null
}

function readTsConfig(typescript, tsconfigPath) {
  if (tsconfigPath && !fs.existsSync(tsconfigPath)) {
    throw new Error("Could not find specified tsconfig.json at " + tsconfigPath)
  }
  var existingTsConfig = tsconfigPath || findFile(process.cwd(), "tsconfig.json")
  if (!existingTsConfig) {
    return {}
  }
  var tsconfig = typescript.readConfigFile(existingTsConfig, function (path) {
    return fs.readFileSync(path, "utf8")
  })

  if (!tsconfig.config || !tsconfig.config.compilerOptions) {
    return { compilerOptions: {} }
  }
  return tsconfig.config
}

function adjustCompilerOptions(typescript, options) {
  var opts = Object.assign({}, options)
  // Set `sourceMap` to `inlineSourceMap` if it's a boolean
  // under the assumption that both are never specified simultaneously.
  if (typeof opts.inlineSourceMap === "boolean") {
    opts.sourceMap = opts.inlineSourceMap
    delete opts.inlineSourceMap
  }

  // Delete some options to prevent compilation error.
  // See: https://github.com/rollup/rollup-plugin-typescript/issues/45
  // See: https://github.com/rollup/rollup-plugin-typescript/issues/142
  delete opts.declaration
  // Delete the `declarationMap` option, as it will cause an error, because we have
  // deleted the `declaration` option.
  delete opts.declarationMap
  delete opts.incremental
  delete opts.tsBuildInfoFile
  return opts
}

var resolveHost = {
  directoryExists: function directoryExists(dirPath) {
    try {
      return fs.statSync(dirPath).isDirectory()
    } catch (err) {
      return false
    }
  },
  fileExists: function fileExists(filePath) {
    try {
      return fs.statSync(filePath).isFile()
    } catch (err) {
      return false
    }
  }
}

var TSLIB_ID = "\0tslib"

function typescript(options) {
  if (options === void 0) options = {}

  var opts = Object.assign({}, options)

  var filter = pluginutils.createFilter(
    opts.include || ["*.ts+(|x)", "**/*.ts+(|x)"],
    opts.exclude || ["*.d.ts", "**/*.d.ts"]
  )

  delete opts.include
  delete opts.exclude

  // Allow users to override the TypeScript version used for transpilation and tslib version used for helpers.
  var tsRuntime = opts.typescript || ts
  var tslib = opts.tslib || fs.readFileSync(resolveId.sync("tslib/tslib.es6.js", { basedir: __dirname }), "utf-8")

  delete opts.typescript
  delete opts.tslib

  // Load options from `tsconfig.json` unless explicitly asked not to.
  var tsConfig = opts.tsconfig === false ? { compilerOptions: {} } : readTsConfig(tsRuntime, opts.tsconfig)

  delete opts.tsconfig

  // Since the CompilerOptions aren't designed for the Rollup
  // use case, we'll adjust them for use with Rollup.
  tsConfig.compilerOptions = adjustCompilerOptions(tsRuntime, tsConfig.compilerOptions)
  opts = adjustCompilerOptions(tsRuntime, opts)

  opts = Object.assign(tsConfig.compilerOptions, getDefaultOptions(), opts)

  // Verify that we're targeting ES2015 modules.
  var moduleType = opts.module.toUpperCase()
  if (moduleType !== "ES2015" && moduleType !== "ES6" && moduleType !== "ESNEXT" && moduleType !== "COMMONJS") {
    throw new Error(
      "@rollup/plugin-typescript: The module kind should be 'ES2015' or 'ESNext, found: '" + opts.module + "'"
    )
  }

  var parsed = tsRuntime.convertCompilerOptionsFromJson(opts, process.cwd())

  if (parsed.errors.length) {
    parsed.errors.forEach(function (error) {
      return console.error("@rollup/plugin-typescript: " + error.messageText)
    })

    throw new Error("@rollup/plugin-typescript: Couldn't process compiler options")
  }

  // let typescript load inheritance chain if there are base configs
  var extendedConfig = tsConfig.extends
    ? tsRuntime.parseJsonConfigFileContent(tsConfig, tsRuntime.sys, process.cwd(), parsed.options)
    : null

  if (extendedConfig && extendedConfig.errors.length) {
    extendedConfig.errors.forEach(function (error) {
      return console.error("@rollup/plugin-typescript: " + error.messageText)
    })

    throw new Error("@rollup/plugin-typescript: Couldn't process compiler options")
  }

  var compilerOptions = extendedConfig ? extendedConfig.options : parsed.options

  return {
    name: "typescript",

    resolveId: function resolveId(importee, importer) {
      if (importee === "tslib") {
        return TSLIB_ID
      }

      if (!importer) {
        return null
      }
      var containingFile = importer.split("\\").join("/")

      var result = tsRuntime.nodeModuleNameResolver(importee, containingFile, compilerOptions, resolveHost)

      if (result.resolvedModule && result.resolvedModule.resolvedFileName) {
        if (endsWith(result.resolvedModule.resolvedFileName, ".d.ts")) {
          return null
        }

        return result.resolvedModule.resolvedFileName
      }

      return null
    },

    load: function load(id) {
      if (id === TSLIB_ID) {
        return tslib
      }
      return null
    },

    transform: function transform(code, id) {
      var this$1 = this

      if (!filter(id)) {
        return null
      }

      var transformed = tsRuntime.transpileModule(code, {
        fileName: id,
        reportDiagnostics: true,
        compilerOptions: compilerOptions
      })

      // All errors except `Cannot compile modules into 'es6' when targeting 'ES5' or lower.`
      var diagnostics = transformed.diagnostics
        ? transformed.diagnostics.filter(function (diagnostic) {
            return diagnostic.code !== 1204
          })
        : []

      var fatalError = false

      diagnostics.forEach(function (diagnostic) {
        var message = tsRuntime.flattenDiagnosticMessageText(diagnostic.messageText, "\n")

        if (diagnostic.file) {
          var ref = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          var line = ref.line
          var character = ref.character

          this$1.warn(
            diagnostic.file.fileName +
              "(" +
              (line + 1) +
              "," +
              (character + 1) +
              "): error TS" +
              diagnostic.code +
              ": " +
              message
          )
        } else {
          this$1.warn("Error: " + message)
        }

        if (diagnostic.category === ts.DiagnosticCategory.Error) {
          fatalError = true
        }
      })

      if (fatalError) {
        throw new Error("There were TypeScript errors transpiling")
      }

      return {
        code: transformed.outputText,

        // Rollup expects `map` to be an object so we must parse the string
        map: transformed.sourceMapText ? JSON.parse(transformed.sourceMapText) : null
      }
    }
  }
}

module.exports = typescript
