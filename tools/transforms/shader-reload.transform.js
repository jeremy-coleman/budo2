const staticModule = require("static-module")
const through = require("through")
const path = require("path")
const escape = require("jsesc")
const pumpify = require("pumpify")

//const glslifyConcat = require("../glslify-browser")
const { updateShaderSource } = require("./shader-reload.server")
const entryFilePath = require.resolve("./shader-reload.browser.js")

// From:
// https://github.com/glslify/glslify/blob/master/browser.js

// Included manually in this module to speed up install time.

function glslifyConcat(strings) {
  if (typeof strings === "string") strings = [strings]
  var exprs = [].slice.call(arguments, 1)
  var parts = []
  for (var i = 0; i < strings.length - 1; i++) {
    parts.push(strings[i], exprs[i] || "")
  }
  parts.push(strings[i])
  return parts.join("")
}

function shaderReloadTransform(file, opts) {
  if (!/\.shader\.js$/i.test(file)) return through()

  if (!opts) opts = {}
  const vars = opts.vars || {
    __filename: file,
    __dirname: path.dirname(file)
  }

  const glslify = staticModule({ glslify: glslifyHandler }, { vars: vars })
  const reload = staticModule({ "shader-reload": reloadHandler }, { vars: vars })

  return pumpify(glslify, reload)

  function glslifyHandler(parts) {
    return `'${escape(glslifyConcat(parts))}'`
  }

  function reloadHandler(opt) {
    const fileRelative = path.join(path.sep, path.relative(process.cwd(), file))
    const vertex = opt.vertex || ""
    const fragment = opt.fragment || ""
    updateShaderSource(fileRelative, { vertex, fragment })

    return [
      `require('${escape(entryFilePath)}')({\n`,
      `  vertex: '${escape(vertex)}',\n`,
      `  fragment: '${escape(fragment)}'\n`,
      `}, '${escape(fileRelative)}')`
    ].join("")
  }
}

module.exports = shaderReloadTransform
