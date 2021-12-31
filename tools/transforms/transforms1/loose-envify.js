import { PassThrough, Transform } from "stream";
var jsonExtRe = /\.json$/;
/**
 * equivalent of loose-envify/custom
 * if you want standard behvarior, just do require('./loose-envify')(process.env)
 */
function envify(rootEnv) {
    rootEnv = rootEnv || process.env;
    return function (file, trOpts) {
        if (jsonExtRe.test(file)) {
            return new PassThrough();
        }
        var envs = trOpts ? [rootEnv, trOpts] : [rootEnv];
        return new LooseEnvify(envs);
    };
}
class LooseEnvify extends Transform {
    _data;
    _envs;
    constructor(envs) {
        super();
        this._data = "";
        this._envs = envs;
    }
    _transform(buf, enc, cb) {
        this._data += buf;
        cb();
    }
    _flush(cb) {
        var replaced = replace(this._data, this._envs);
        this.push(replaced);
        cb();
    }
}
//replace logic
var jsTokens = /((['"])(?:(?!\2|\\).|\\(?:\r\n|[\s\S]))*(\2)?|`(?:[^`\\$]|\\[\s\S]|\$(?!\{)|\$\{(?:[^{}]|\{[^}]*\}?)*\}?)*(`)?)|(\/\/.*)|(\/\*(?:[^*]|\*(?!\/))*(\*\/)?)|(\/(?!\*)(?:\[(?:(?![\]\\]).|\\.)*\]|(?![\/\]\\]).|\\.)+\/(?:(?!\s*(?:\b|[\u0080-\uFFFF$\\'"~({]|[+\-!](?!=)|\.?\d))|[gmiyus]{1,6}\b(?![\u0080-\uFFFF$\\]|\s*(?:[+\-*%&|^<>!=?({]|\/(?![\/*])))))|(0[xX][\da-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)|((?!\d)(?:(?!\s)[$\w\u0080-\uFFFF]|\\u[\da-fA-F]{4}|\\u\{[\da-fA-F]+\})+)|(--|\+\+|&&|\|\||=>|\.{3}|(?:[+\-\/%&|^]|\*{1,2}|<{1,2}|>{1,3}|!=?|={1,2})=?|[?~.,:;[\](){}])|(\s+)|(^$|[\s\S])/g;
var processEnvRe = /\bprocess\.env\.[_$a-zA-Z][$\w]+\b/;
var spaceOrCommentRe = /^(?:\s|\/[/*])/;
function replace(src, envs) {
    if (!processEnvRe.test(src)) {
        return src;
    }
    var out = [];
    var purge = envs.some(function (env) {
        return env._ && env._.indexOf("purge") !== -1;
    });
    jsTokens.lastIndex = 0;
    var parts = src.match(jsTokens);
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "process" && parts[i + 1] === "." && parts[i + 2] === "env" && parts[i + 3] === ".") {
            var prevCodeToken = getAdjacentCodeToken(-1, parts, i);
            var nextCodeToken = getAdjacentCodeToken(1, parts, i + 4);
            var replacement = getReplacementString(envs, parts[i + 4], purge);
            if (prevCodeToken !== "." && nextCodeToken !== "." && nextCodeToken !== "=" && typeof replacement === "string") {
                out.push(replacement);
                i += 4;
                continue;
            }
        }
        out.push(parts[i]);
    }
    return out.join("");
}
function getAdjacentCodeToken(dir, parts, i) {
    while (true) {
        var part = parts[(i += dir)];
        if (!spaceOrCommentRe.test(part)) {
            return part;
        }
    }
}
function getReplacementString(envs, name, purge) {
    for (var j = 0; j < envs.length; j++) {
        var env = envs[j];
        if (typeof env[name] !== "undefined") {
            return JSON.stringify(env[name]);
        }
    }
    if (purge) {
        return "undefined";
    }
}
export { envify };
