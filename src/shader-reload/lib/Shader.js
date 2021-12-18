var { EventEmitter } = require("events")

class Shader extends EventEmitter {
  constructor(opt) {
    super()
    opt = opt || {}
    this.vertex = opt.vertex || ""
    this.fragment = opt.fragment || ""
    this.version = 0
    this.setMaxListeners(10000)
  }
}

module.exports = Shader
