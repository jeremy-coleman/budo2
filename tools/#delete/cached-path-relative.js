/**
 * Modules
 */

var path = require('path')
//var memo = require("lodash/memoize")
var memo = require("fast-memoize")

//module.exports = path.relative // memo(path.relative)
module.exports = memo(path.relative)
