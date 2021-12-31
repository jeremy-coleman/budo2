import { parse } from "acorn-node";
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;
function forEach(obj, fn, ctx) {
    if (toString.call(fn) !== "[object Function]") {
        throw new TypeError("iterator must be a function");
    }
    var l = obj.length;
    if (l === +l) {
        for (var i = 0; i < l; i++) {
            fn.call(ctx, obj[i], i, obj);
        }
    }
    else {
        for (var k in obj) {
            if (hasOwn.call(obj, k)) {
                fn.call(ctx, obj[k], k, obj);
            }
        }
    }
}
function falafel(src, opts, fn) {
    if (typeof opts === "function") {
        fn = opts;
        opts = {};
    }
    if (src && typeof src === "object" && src.constructor.name === "Buffer") {
        src = src.toString();
    }
    else if (src && typeof src === "object") {
        opts = src;
        src = opts.source;
        delete opts.source;
    }
    src = src === undefined ? opts.source : src;
    if (typeof src !== "string") {
        src = String(src);
    }
    var ast = parse(src, opts);
    var result = {
        chunks: src.split(""),
        toString: function () {
            return result.chunks.join("");
        },
        inspect: function () {
            return result.toString();
        },
    };
    var index = 0;
    (function walk(node, parent) {
        insertHelpers(node, parent, result.chunks);
        forEach(Object.keys(node), function (key) {
            if (key === "parent")
                return;
            var child = node[key];
            if (Array.isArray(child)) {
                forEach(child, function (c) {
                    if (c && typeof c.type === "string") {
                        walk(c, node);
                    }
                });
            }
            else if (child && typeof child.type === "string") {
                walk(child, node);
            }
        });
        fn(node);
    })(ast, undefined);
    return result;
}
function insertHelpers(node, parent, chunks) {
    node.parent = parent;
    node.source = function () {
        return chunks.slice(node.start, node.end).join("");
    };
    if (node.update && typeof node.update === "object") {
        var prev = node.update;
        forEach(Object.keys(prev), function (key) {
            update[key] = prev[key];
        });
        node.update = update;
    }
    else {
        node.update = update;
    }
    function update(s) {
        chunks[node.start] = s;
        for (var i = node.start + 1; i < node.end; i++) {
            chunks[i] = "";
        }
    }
}
export { falafel };
