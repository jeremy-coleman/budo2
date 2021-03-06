var through = require('./through2');
var {Readable} = require('stream');

var concat = require('./concat-stream');
var duplexer = require('./duplexer2');
var acorn = require('acorn-node');
var walkAst = require('acorn-node/walk').full;
var scan = require('scope-analyzer');
var unparse = require('escodegen').generate;
var inspect = require('object-inspect');
var evaluate = require('./static-eval');
var copy = require('./shallow-copy');

var MagicString = require('magic-string');
var convertSourceMap = require('./convert-source-map');
var mergeSourceMap = require('./merge-source-map');

//var has = Object.hasOwnProperty
//var has = require('has');
var has = Reflect.has

module.exports = function parse (modules, opts) {
    if (!opts) opts = {};
    var vars = opts.vars || {};
    var varModules = opts.varModules || {};
    var parserOpts = copy(opts.parserOpts || {});
    var updates = [];
    var moduleBindings = [];
    var sourcemapper;
    var inputMap;

    var output = through();
    var body, ast;
    return duplexer(concat({ encoding: 'buffer' }, function (buf) {
        try {
            body = buf.toString('utf8').replace(/^#!/, '//#!');
            var matches = false;
            for (var key in modules) {
                if (body.indexOf(key) !== -1) {
                    matches = true;
                    break;
                }
            }

            if (!matches) {
                // just pass it through
                output.end(buf);
                return;
            }

            if (opts.sourceMap) {
                inputMap = convertSourceMap.fromSource(body);
                if (inputMap) inputMap = inputMap.toObject();
                body = convertSourceMap.removeComments(body);
                sourcemapper = new MagicString(body);
            }

            ast = acorn.parse(body, parserOpts);
            // scan.crawl does .parent tracking, so we can use acorn's builtin walker.
            scan.crawl(ast);
            walkAst(ast, walk);
        }
        catch (err) { return error(err) }

        finish(body);
    }), output);

    function finish (src) {
        var pos = 0;
        src = String(src);

        moduleBindings.forEach(function (binding) {
            if (binding.isReferenced()) {
                return;
            }
            var node = binding.initializer;
            if (node.type === 'VariableDeclarator') {
                var i = node.parent.declarations.indexOf(node);
                if (node.parent.declarations.length === 1) {
                    // remove the entire declaration
                    updates.push({
                        start: node.parent.start,
                        offset: node.parent.end - node.parent.start,
                        stream: st()
                    });
                } else if (i === node.parent.declarations.length - 1) {
                    updates.push({
                        // remove ", a = 1"
                        start: node.parent.declarations[i - 1].end,
                        offset: node.end - node.parent.declarations[i - 1].end,
                        stream: st()
                    });
                } else {
                    updates.push({
                        // remove "a = 1, "
                        start: node.start,
                        offset: node.parent.declarations[i + 1].start - node.start,
                        stream: st()
                    });
                }
            } else if (node.parent.type === 'SequenceExpression' && node.parent.expressions.length > 1) {
                var i = node.parent.expressions.indexOf(node);
                if (i === node.parent.expressions.length - 1) {
                    updates.push({
                        // remove ", a = 1"
                        start: node.parent.expressions[i - 1].end,
                        offset: node.end - node.parent.expressions[i - 1].end,
                        stream: st()
                    });
                } else {
                    updates.push({
                        // remove "a = 1, "
                        start: node.start,
                        offset: node.parent.expressions[i + 1].start - node.start,
                        stream: st()
                    });
                }
            } else {
                if (node.parent.type === 'ExpressionStatement') node = node.parent;
                updates.push({
                    start: node.start,
                    offset: node.end - node.start,
                    stream: st()
                });
            }
        });
        updates.sort(function(a, b) { return a.start - b.start; });

        (function next () {
            if (updates.length === 0) return done();
            var s = updates.shift();

            output.write(src.slice(pos, s.start));
            pos = s.start + s.offset;

            s.stream.pipe(output, { end: false });
            if (opts.sourceMap) {
                s.stream.pipe(concat({ encoding: 'string' }, function (chunk) {
                    // We have to give magic-string the replacement string,
                    // so it can calculate the amount of lines and columns.
                    if (s.offset === 0) {
                        sourcemapper.appendRight(s.start, chunk);
                    } else {
                        sourcemapper.overwrite(s.start, s.start + s.offset, chunk);
                    }
                })).on('finish', next);
            } else {
                s.stream.on('end', next);
            }
        })();

        function done () {
            output.write(src.slice(pos));
            if (opts.sourceMap) {
                var map = sourcemapper.generateMap({
                    source: opts.inputFilename || 'input.js',
                    includeContent: true
                });
                if (inputMap) {
                    var merged = mergeSourceMap(inputMap, map);
                    output.write('\n' + convertSourceMap.fromObject(merged).toComment() + '\n');
                } else {
                    output.write('\n//# sourceMappingURL=' + map.toUrl() + '\n');
                }
            }
            output.end();
        }
    }

    function error (msg) {
        var err = typeof msg === 'string' ? new Error(msg) : msg;
        output.emit('error', err);
    }

    function walk (node) {
        if (opts.sourceMap) {
            sourcemapper.addSourcemapLocation(node.start);
            sourcemapper.addSourcemapLocation(node.end);
        }

        var isreq = isRequire(node);
        var isreqm = false, isreqv = false, reqid;
        if (isreq) {
            reqid = node.arguments[0].value;
            isreqm = has(modules, reqid);
            isreqv = has(varModules, reqid);
        }

        if (isreqv && node.parent.type === 'VariableDeclarator'
        && node.parent.id.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.id);
            if (binding) binding.value = varModules[reqid];
        }
        else if (isreqv && node.parent.type === 'AssignmentExpression'
        && node.parent.left.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.left);
            if (binding) binding.value = varModules[reqid];
        }
        else if (isreqv && node.parent.type === 'MemberExpression'
        && isStaticProperty(node.parent.property)
        && node.parent.parent.type === 'VariableDeclarator'
        && node.parent.parent.id.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.parent.id);
            var v = varModules[reqid][resolveProperty(node.parent.property)];
            if (binding) binding.value = v;
        }
        else if (isreqv && node.parent.type === 'MemberExpression'
        && node.parent.property.type === 'Identifier') {
            //vars[node.parent.parent.id.name] = varModules[reqid];
        }
        else if (isreqv && node.parent.type === 'CallExpression') {
            //
        }

        if (isreqm && node.parent.type === 'VariableDeclarator'
        && node.parent.id.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.id);
            if (binding) {
                binding.module = modules[reqid];
                binding.initializer = node.parent;
                binding.remove(node.parent.id);
                moduleBindings.push(binding);
            }
        }
        else if (isreqm && node.parent.type === 'AssignmentExpression'
        && node.parent.left.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.left);
            if (binding) {
                binding.module = modules[reqid];
                binding.initializer = node.parent;
                binding.remove(node.parent.left);
                moduleBindings.push(binding);
            }
        }
        else if (isreqm && node.parent.type === 'MemberExpression'
        && isStaticProperty(node.parent.property)
        && node.parent.parent.type === 'VariableDeclarator'
        && node.parent.parent.id.type === 'Identifier') {
            var binding = scan.getBinding(node.parent.parent.id);
            if (binding) {
                binding.module = modules[reqid][resolveProperty(node.parent.property)];
                binding.initializer = node.parent.parent;
                binding.remove(node.parent.parent.id);
                moduleBindings.push(binding);
            }
        }
        else if (isreqm && node.parent.type === 'MemberExpression'
        && isStaticProperty(node.parent.property)) {
            var name = resolveProperty(node.parent.property);
            var cur = copy(node.parent.parent);
            cur.callee = copy(node.parent.property);
            cur.callee.parent = cur;
            traverse(cur.callee, modules[reqid][name]);
        }
        else if (isreqm && node.parent.type === 'CallExpression') {
            var cur = copy(node.parent);
            var iname = Math.pow(16,8) * Math.random();
            cur.callee = {
                type: 'Identifier',
                name: '_' + Math.floor(iname).toString(16),
                parent: cur
            };
            traverse(cur.callee, modules[reqid]);
        }

        if (node.type === 'Identifier') {
            var binding = scan.getBinding(node)
            if (binding && binding.module) traverse(node, binding.module, binding);
        }
    }

    function traverse (node, val, binding) {
        for (var p = node; p; p = p.parent) {
            if (p.start === undefined || p.end === undefined) continue;
        }

        if (node.parent.type === 'CallExpression') {
            if (typeof val !== 'function') {
                return error(
                    'tried to statically call ' + inspect(val)
                    + ' as a function'
                );
            }

            var xvars = getVars(node.parent, vars);
            xvars[node.name] = val;

            var res = evaluate(node.parent, xvars);
            if (res !== undefined) {
                if (binding) binding.remove(node)
                updates.push({
                    start: node.parent.start,
                    offset: node.parent.end - node.parent.start,
                    stream: isStream(res) ? wrapStream(res) : st(String(res))
                });
            }
        }
        else if (node.parent.type === 'MemberExpression') {
            if (!isStaticProperty(node.parent.property)) {
                return error(
                    'dynamic property in member expression: '
                    + body.slice(node.parent.start, node.parent.end)
                );
            }

            var cur = node.parent.parent;

            if (cur.type === 'MemberExpression') {
                cur = cur.parent;
                if (cur.type !== 'CallExpression'
                && cur.parent.type === 'CallExpression') {
                    cur = cur.parent;
                }
            }
            if (node.parent.type === 'MemberExpression'
            && (cur.type !== 'CallExpression'
            && cur.type !== 'MemberExpression')) {
                cur = node.parent;
            }

            var xvars = getVars(cur, vars);
            xvars[node.name] = val;

            var res = evaluate(cur, xvars);
            if (res === undefined && cur.type === 'CallExpression') {
                // static-eval can't safely evaluate code with callbacks, so do it manually in a safe way
                var callee = evaluate(cur.callee, xvars);
                var args = cur.arguments.map(function (arg) {
                    // Return a function stub for callbacks so that `static-module` users
                    // can do `callback.toString()` and get the original source
                    if (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression') {
                        var fn = function () {
                            throw new Error('static-module: cannot call callbacks defined inside source code');
                        };
                        fn.toString = function () {
                            return body.slice(arg.start, arg.end);
                        };
                        return fn;
                    }
                    return evaluate(arg, xvars);
                });

                if (callee !== undefined) {
                    try {
                        res = callee.apply(null, args);
                    } catch (err) {
                        // Evaluate to undefined
                    }
                }
            }

            if (res !== undefined) {
                if (binding) binding.remove(node)
                updates.push({
                    start: cur.start,
                    offset: cur.end - cur.start,
                    stream: isStream(res) ? wrapStream(res) : st(String(res))
                });
            }
        }
        else if (node.parent.type === 'UnaryExpression') {
            var xvars = getVars(node.parent, vars);
            xvars[node.name] = val;

            var res = evaluate(node.parent, xvars);
            if (res !== undefined) {
                if (binding) binding.remove(node)
                updates.push({
                    start: node.parent.start,
                    offset: node.parent.end - node.parent.start,
                    stream: isStream(res) ? wrapStream(res) : st(String(res))
                });
            } else {
                output.emit('error', new Error(
                    'unsupported unary operator: ' + node.parent.operator
                ));
            }
        }
        else {
            output.emit('error', new Error(
                'unsupported type for static module: ' + node.parent.type
                + '\nat expression:\n\n  ' + unparse(node.parent) + '\n'
            ));
        }
    }
}

function isRequire (node) {
    var c = node.callee;
    return c
        && node.type === 'CallExpression'
        && c.type === 'Identifier'
        && c.name === 'require'
    ;
}

function isStream (s) {
    return s && typeof s === 'object' && typeof s.pipe === 'function';
}

function wrapStream (s) {
    if (typeof s.read === 'function') return s
    else return (new Readable).wrap(s)
}

function isStaticProperty(node) {
    return node.type === 'Identifier' || node.type === 'Literal';
}

function resolveProperty(node) {
    return node.type === 'Identifier' ? node.name : node.value;
}

function st (msg) {
    var r = new Readable;
    r._read = function () {};
    if (msg != null) r.push(msg);
    r.push(null);
    return r;
}

function nearestScope(node) {
    do {
        var scope = scan.scope(node);
        if (scope) return scope;
    } while ((node = node.parent));
}

function getVars(node, vars) {
    var xvars = copy(vars || {});
    var scope = nearestScope(node);
    if (scope) {
        scope.forEachAvailable(function (binding, name) {
            if (binding.hasOwnProperty('value')) xvars[name] = binding.value;
        });
    }
    return xvars;
}
