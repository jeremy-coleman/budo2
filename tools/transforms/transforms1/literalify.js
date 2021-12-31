import { makeRequireTransform } from "./transform-tools";
var literalify = makeRequireTransform("literalify", { excludeExtensions: ["json"] }, function (args, opts, cb) {
    if (opts.config && args[0] in opts.config) {
        return cb(null, opts.config[args[0]]);
    }
    else {
        return cb();
    }
});
export { literalify };
