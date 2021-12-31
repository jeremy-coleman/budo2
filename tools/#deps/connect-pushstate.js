var URL = require("url")
const { extname } = require("path")

module.exports = pushState

function pushState(options) {
    options = options || {};
    var root = options.root || "/";
    var allow = options && (options.allow = new RegExp(options.allow));
    var disallow = options && (options.disallow = new RegExp(options.disallow));
    return function pushState(req, res, next) {
        var pathname = parse(req.url).pathname;
        var allowed = allow && allow.test(pathname);
        var disallowed = disallow && disallow.test(pathname);
        var hasFileExtension = !!extname(pathname);
        if (allowed || (!disallowed && hasFileExtension)) {
            next();
        }
        else {
            req.url = root;
            next();
        }
    };
}
