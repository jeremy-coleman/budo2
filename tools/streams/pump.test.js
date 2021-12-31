var pump = require('./pump')

var rs = require('fs').createReadStream('/dev/random')
var ws = require('fs').createWriteStream('/dev/null')

var toHex = function () {
  var reverse = new (require('stream').Transform)()

  reverse._transform = function (chunk, enc, callback) {
    reverse.push(chunk.toString('hex'))
    callback()
  }

  return reverse
}

var wsClosed = false
var rsClosed = false
var callbackCalled = false

var check = function () {
  if (wsClosed && rsClosed && callbackCalled) {
    console.log('test-node.js passes')
    clearTimeout(timeout)
  }
}

ws.on('close', function () {
  wsClosed = true
  check()
})

rs.on('close', function () {
  rsClosed = true
  check()
})

var res = pump(rs, toHex(), toHex(), toHex(), ws, function () {
  callbackCalled = true
  check()
})

if (res !== ws) {
  throw new Error('should return last stream')
}

setTimeout(function () {
  rs.destroy()
}, 1000)

var timeout = setTimeout(function () {
  throw new Error('timeout')
}, 5000)


//browser tests

// var stream = require('stream')
// var pump = require('./pump')

// var rs = new stream.Readable()
// var ws = new stream.Writable()

// rs._read = function (size) {
//   this.push(Buffer(size).fill('abc'))
// }

// ws._write = function (chunk, encoding, cb) {
//   setTimeout(function () {
//     cb()
//   }, 100)
// }

// var toHex = function () {
//   var reverse = new (require('stream').Transform)()

//   reverse._transform = function (chunk, enc, callback) {
//     reverse.push(chunk.toString('hex'))
//     callback()
//   }

//   return reverse
// }

// var wsClosed = false
// var rsClosed = false
// var callbackCalled = false

// var check = function () {
//   if (wsClosed && rsClosed && callbackCalled) {
//     console.log('test-browser.js passes')
//     clearTimeout(timeout)
//   }
// }

// ws.on('finish', function () {
//   wsClosed = true
//   check()
// })

// rs.on('end', function () {
//   rsClosed = true
//   check()
// })

// var res = pump(rs, toHex(), toHex(), toHex(), ws, function () {
//   callbackCalled = true
//   check()
// })

// if (res !== ws) {
//   throw new Error('should return last stream')
// }

// setTimeout(function () {
//   rs.push(null)
//   rs.emit('close')
// }, 1000)

// var timeout = setTimeout(function () {
//   check()
//   throw new Error('timeout')
// }, 5000)
