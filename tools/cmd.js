#!/usr/bin/env node

// Starts budo with stdout
// Handles --help and error messaging
// Uses auto port-finding
var args = process.argv.slice(2)

var budo = require('./budo')
var color = require('kolorist')
var stdoutStream = require('stdout-stream')
var {exec} = require('child_process')
var subarg = require('subarg')
var xtend = require('xtend')


function parseArgs (args, opt) {
  // before parsing subarg, remove the bundler arguments
  var bundlerFlags = []
  var stopIndex = args.indexOf('--')
  if (stopIndex >= 0) {
    bundlerFlags = args.slice(stopIndex + 1)
    args = args.slice(0, stopIndex)
  }
  var argv = subarg(args, {
    boolean: [
      'stream',
      'debug',
      'errorHandler',
      'forceDefaultIndex',
      'open',
      'portfind',
      'ndjson',
      'verbose',
      'cors',
      'ssl'
    ],
    string: [
      'host',
      'port',
      'dir',
      'onupdate',
      'serve',
      'title',
      'watchGlob',
      'cert',
      'key'
    ],
    default: module.exports.defaults,
    alias: {
      port: 'p',
      ssl: 'S',
      serve: 's',
      cert: 'C',
      key: 'K',
      verbose: 'v',
      help: 'h',
      host: 'H',
      dir: 'd',
      live: 'l',
      open: 'o',
      staticOptions: [ 'static-options' ],
      watchGlob: [ 'wg', 'watch-glob' ],
      errorHandler: 'error-handler',
      forceDefaultIndex: 'force-default-index',
      pushstate: 'P'
    },
    '--': true
  })
  // add back in the bundler flags
  argv['--'] = bundlerFlags
  return xtend(argv, opt)
}


function cli (args, opts) {
  var argv = parseArgs(args, opts)

  // if no stream is specified, default to stdout
  if (argv.stream !== false) {
    argv.stream = /^win/.test(process.platform) ? process.stdout : stdoutStream
  }

  var entries = argv._
  delete argv._

  argv.browserifyArgs = argv['--']
  delete argv['--']

  // if (argv.version) {
  //   console.log('budo v' + require('./package.json').version)
  //   console.log('browserify v' + require('browserify/package.json').version)
  //   console.log('watchify v' + require('watchify-middleware').getWatchifyVersion())
  //   return null
  // }

  if (argv.help) {
    var help = require('path').join(__dirname, 'bin', 'help.txt')
    require('fs').createReadStream(help)
      .pipe(process.stdout)
    return null
  }

  if (argv.outfile) {
    console.error(color.yellow('WARNING'), '--outfile has been removed in budo@3.0')
  }

  if (typeof argv.pushstate === 'string') {
    // support backwards compatibility with CLI like this:
    //    budo -P index.js:bundle.js
    var newEntry = argv.pushstate
    argv.pushstate = argv.P = true
    entries.unshift(newEntry)
    console.error(color.yellow('WARNING'), '\nAs of budo@10.x, --pushstate should come ' +
        'after your JS entries.\nExample:\n' +
        '  budo index.js:bundle.js --pushstate')
  }

  if (typeof argv.port === 'string') {
    argv.port = parseInt(argv.port, 10)
  }
  if (typeof argv.livePort === 'string') {
    argv.livePort = parseInt(argv.livePort, 10)
  }

  // opts.live can be a glob or a boolean
  if (typeof argv.live === 'string' && /(true|false)/.test(argv.live)) {
    argv.live = argv.live === 'true'
  }

  // CLI only option for executing a child process
  var instance = budo(entries, argv).on('error', exit)
  var onUpdates = [].concat(argv.onupdate).filter(Boolean)
  onUpdates.forEach(function (cmd) {
    instance.on('update', execFunc(cmd))
  })

  return instance
}

function execFunc (cmd) {
  return function run () {
    var p = exec(cmd)
    p.stderr.pipe(process.stderr)
    p.stdout.pipe(process.stdout)
  }
}

function exit (err) {
  console.log(color.red('ERROR'), err.message)
  process.exit(1)
}



cli(args)
