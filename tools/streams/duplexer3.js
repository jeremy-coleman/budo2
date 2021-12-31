const { Duplex, Readable } = require("stream")

//similar to duplexer2, except options arg is last instead of first

class DuplexifyStream extends Duplex {
  constructor(writable, readable, options) {
    super(options)
    if (typeof readable.read !== "function") {
      readable = new Readable(options).wrap(readable)
    }
    this._writable = writable
    this._readable = readable
    this._waiting = false
    writable.once("finish", () => {
      this.end()
    })
    this.once("finish", () => {
      writable.end()
    })
    readable.on("readable", () => {
      if (this._waiting) {
        this._waiting = false
        this._read()
      }
    })
    readable.once("end", () => {
      this.push(null)
    })
    writable.on("error", (err) => {
      this.emit("error", err)
    })
    readable.on("error", (err) => {
      this.emit("error", err)
    })
  }
  _write(input, encoding, done) {
    this._writable.write(input, encoding, done)
  }
  _read() {
    var buf
    var reads = 0
    while ((buf = this._readable.read()) !== null) {
      this.push(buf)
      reads++
    }
    if (reads === 0) {
      this._waiting = true
    }
  }
}

function duplexer3(writable, readable, options) {
  return new DuplexifyStream(writable, readable, options)
}

module.exports = {
  duplexer3
}

