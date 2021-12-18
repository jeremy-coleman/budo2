var { EventEmitter } = require("events")
var emitter = new EventEmitter()
emitter.setMaxListeners(10000)
module.exports = emitter
