var acorn = require('acorn')

var CJSParser = acorn.Parser
  .extend(require('./lib/bigint'))
  .extend(require('./lib/class-fields'))
  .extend(require('./lib/static-class-features'))
  .extend(require('./lib/numeric-separator'))

var ESModulesParser = CJSParser
  .extend(require('./lib/export-ns-from'))
  .extend(require('./lib/import-meta'))

function mapOptions (opts) {
  if (!opts) opts = {}
  return Object.assign({}, {
    ecmaVersion: 2020,
    allowHashBang: true,
    allowReturnOutsideFunction: true
  }, opts)
}

function getParser (opts) {
  if (!opts) opts = {}
  return opts.sourceType === 'module' ? ESModulesParser : CJSParser
}

module.exports = exports = Object.assign({}, acorn, {
  parse: function parse (src, opts) {
    return getParser(opts).parse(src, mapOptions(opts))
  },
  parseExpressionAt: function parseExpressionAt (src, offset, opts) {
    return getParser(opts).parseExpressionAt(src, offset, mapOptions(opts))
  },
  tokenizer: function tokenizer (src, opts) {
    return getParser(opts).tokenizer(src, mapOptions(opts))
  }
})
