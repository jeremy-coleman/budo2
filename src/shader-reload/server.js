const path = require("path")

const sources = {}
const shaderFileRegex = /\.shader\.js$/i

module.exports = {
  updateShaderSource,
  isShaderReload,
  isShaderError,
  getErrorEvent,
  getEvent
}

function updateShaderSource (file, opt) {
  sources[file] = opt
}

function isShaderReload(deps) {
  return deps.length > 0 && deps.every((dep) => shaderFileRegex.test(dep))
}

function isShaderError(err) {
  return err.filename && shaderFileRegex.test(err.filename)
}

function getErrorEvent(error) {
  return {
    event: "shader-error",
    error: error.message
  }
}

function getEvent(deps, cwd) {
  cwd = cwd || process.cwd()

  // Use the same format as "__filename" in the browser
  const files = deps.map((dep) => {
    return path.join(path.sep, path.relative(process.cwd(), dep))
  })

  const updates = getUpdates(files)
  return {
    event: "shader-reload",
    updates: updates
  }
}

function getUpdates(files) {
  return files
    .map((file) => {
      if (file in sources) {
        return Object.assign({}, sources[file], {
          file
        })
      } else {
        return null
      }
    })
    .filter(Boolean)
}
