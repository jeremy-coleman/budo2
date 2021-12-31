import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { falafel } from "./falafel";
import { through } from "../streams/through1";
var indexOf = [].indexOf;
var packageJsonCache = {};
var configCache = {};
function parentDir(dir, fileToFind, done) {
    return fs.exists(path.join(dir, fileToFind), function (fileExists) {
        var parent;
        if (fileExists) {
            return done(null, dir);
        }
        else {
            parent = path.resolve(dir, "..");
            if (parent === dir) {
                return done(null, null);
            }
            else {
                return parentDir(parent, fileToFind, done);
            }
        }
    });
}
function parentDirSync(dir, fileToFind) {
    var oldDirToCheck;
    var dirToCheck = path.resolve(dir);
    var answer = null;
    while (true) {
        if (fs.existsSync(path.join(dirToCheck, fileToFind))) {
            answer = dirToCheck;
            break;
        }
        oldDirToCheck = dirToCheck;
        dirToCheck = path.resolve(dirToCheck, "..");
        if (oldDirToCheck === dirToCheck) {
            break;
        }
    }
    return answer;
}
function findPackageJson(dirname, done) {
    var answer;
    answer = packageJsonCache[dirname];
    if (answer) {
        return process.nextTick(function () {
            return done(null, answer);
        });
    }
    else {
        return parentDir(dirname, "package.json", function (err, packageDir) {
            var packageFile;
            if (err) {
                return done(err);
            }
            if (packageDir) {
                packageFile = path.join(packageDir, "package.json");
            }
            else {
                packageFile = null;
            }
            packageJsonCache[dirname] = packageFile;
            return done(null, packageFile);
        });
    }
}
function findPackageJsonSync(dirname) {
    var answer, packageDir, packageFile;
    answer = packageJsonCache[dirname];
    if (!answer) {
        packageDir = parentDirSync(dirname, "package.json");
        if (packageDir) {
            packageFile = path.join(packageDir, "package.json");
        }
        else {
            packageFile = null;
        }
        packageJsonCache[dirname] = packageFile;
        answer = packageFile;
    }
    return answer;
}
function getConfigFromCache(transformName, packageFile) {
    var cacheKey;
    cacheKey = transformName + ":" + packageFile;
    if (configCache[cacheKey] != null) {
        return configCache[cacheKey];
    }
    else {
        return null;
    }
}
function storeConfigInCache(transformName, packageFile, configData) {
    var cacheKey, cachedConfigData, key, value;
    cacheKey = transformName + ":" + packageFile;
    cachedConfigData = {};
    for (key in configData) {
        value = configData[key];
        cachedConfigData[key] = value;
    }
    cachedConfigData.cached = true;
    return (configCache[cacheKey] = cachedConfigData);
}
function loadJsonAsync(filename, done) {
    return fs.readFile(filename, "utf-8", function (err, content) {
        if (err) {
            return done(err);
        }
        try {
            return done(null, JSON.parse(content));
        }
        catch (_error) {
            err = _error;
            return done(err);
        }
    });
}
function loadExternalConfig(packageFile, relativeConfigFile) {
    var config, configDir, configFile, packageDir;
    packageDir = path.dirname(packageFile);
    configFile = path.resolve(packageDir, relativeConfigFile);
    configDir = path.dirname(configFile);
    config = require(configFile);
    return {
        config: config,
        configDir: configDir,
        configFile: configFile,
        packageFile: packageFile,
        cached: false
    };
}
function processConfig(transformName, packageFile, config) {
    var configData, configDir, configFile;
    if (typeof config === "string") {
        configData = loadExternalConfig(packageFile, config);
    }
    else {
        configFile = packageFile;
        configDir = path.dirname(packageFile);
        configData = {
            config: config,
            configDir: configDir,
            configFile: configFile,
            packageFile: packageFile,
            cached: false
        };
    }
    if (configData.config.appliesTo) {
        configData.appliesTo = configData.config.appliesTo;
        delete configData.config.appliesTo;
    }
    storeConfigInCache(transformName, packageFile, configData);
    return configData;
}
function loadTransformConfig(transformName, file, options, done) {
    var dir, findConfig;
    if (done == null) {
        done = options;
        options = {};
    }
    if (options.fromSourceFileDir) {
        dir = path.dirname(file);
    }
    else {
        dir = process.cwd();
    }
    findConfig = function (dirname) {
        return findPackageJson(dirname, function (err, packageFile) {
            var configData;
            if (err) {
                return done(err);
            }
            if (packageFile == null) {
                return done(null, null);
            }
            else {
                configData = getConfigFromCache(transformName, packageFile);
                if (configData) {
                    return done(null, configData);
                }
                else {
                    return loadJsonAsync(packageFile, function (err, pkg) {
                        var config, packageDir, parent;
                        if (err) {
                            return done(err);
                        }
                        config = pkg[transformName];
                        packageDir = path.dirname(packageFile);
                        if (config == null) {
                            if (!options.fromSourceFileDir) {
                                return done(null, null);
                            }
                            else {
                                parent = path.resolve(packageDir, "..");
                                if (parent === packageDir) {
                                    return done(null, null);
                                }
                                else {
                                    return findConfig(parent);
                                }
                            }
                        }
                        else {
                            try {
                                configData = processConfig(transformName, packageFile, config);
                                return done(null, configData);
                            }
                            catch (_error) {
                                err = _error;
                                return done(err);
                            }
                        }
                    });
                }
            }
        });
    };
    return findConfig(dir);
}
function loadTransformConfigSync(transformName, file, options) {
    var config, configData, dirname, done, packageDir, packageFile, pkg;
    if (options == null) {
        options = {};
    }
    configData = null;
    if (options.fromSourceFileDir) {
        dirname = path.dirname(file);
    }
    else {
        dirname = process.cwd();
    }
    done = false;
    while (!done) {
        packageFile = findPackageJsonSync(dirname);
        if (packageFile == null) {
            configData = null;
            done = true;
        }
        else {
            configData = getConfigFromCache(transformName, packageFile);
            if (configData) {
                done = true;
            }
            else {
                pkg = require(packageFile);
                config = pkg[transformName];
                packageDir = path.dirname(packageFile);
                if (config == null) {
                    if (!options.fromSourceFileDir) {
                        done = true;
                    }
                    else {
                        dirname = path.resolve(packageDir, "..");
                        if (dirname === packageDir) {
                            done = true;
                        }
                    }
                }
                else {
                    configData = processConfig(transformName, packageFile, config);
                    done = true;
                }
            }
        }
    }
    return configData;
}
function clearConfigCache() {
    packageJsonCache = {};
    return (configCache = {});
}
var JS_EXTENSIONS = [".js", ".coffee", ".coffee.md", ".litcoffee", "._js", "._coffee", ".jsx", ".es", ".es6"];
function isArray(obj) {
    return Object.prototype.toString.call(obj) === "[object Array]";
}
function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}
function skipFile(file, configData, options) {
    var appliesTo, extension, fileToTest, i, includeExtensions, includeThisFile, j, k, l, len, len1, len2, len3, ref, ref1, regex, regexes, skip;
    if (configData == null) {
        configData = {};
    }
    if (options == null) {
        options = {};
    }
    file = path.resolve(file);
    skip = false;
    appliesTo = configData.appliesTo;
    if (appliesTo == null ||
        (appliesTo.includeExtensions == null &&
            appliesTo.excludeExtensions == null &&
            appliesTo.regex == null &&
            appliesTo.files == null)) {
        appliesTo = options;
    }
    includeExtensions = appliesTo != null ? appliesTo.includeExtensions : void 0;
    if ((appliesTo != null ? appliesTo.jsFilesOnly : void 0) && !includeExtensions) {
        includeExtensions = JS_EXTENSIONS;
    }
    if (appliesTo.regex != null) {
        regexes = appliesTo.regex;
        includeThisFile = false;
        if (!isArray(regexes)) {
            regexes = [regexes];
        }
        for (i = 0, len = regexes.length; i < len; i++) {
            regex = regexes[i];
            if (!regex.test) {
                regex = new RegExp(regex);
            }
            if (regex.test(file)) {
                includeThisFile = true;
                break;
            }
        }
        if (!includeThisFile) {
            skip = true;
        }
    }
    else if (appliesTo.files != null) {
        includeThisFile = false;
        ref = appliesTo.files;
        for (j = 0, len1 = ref.length; j < len1; j++) {
            fileToTest = ref[j];
            fileToTest = path.resolve(configData.configDir, fileToTest);
            if (fileToTest === file) {
                includeThisFile = true;
                break;
            }
        }
        if (!includeThisFile) {
            skip = true;
        }
    }
    else if (appliesTo.excludeExtensions != null) {
        ref1 = appliesTo.excludeExtensions;
        for (k = 0, len2 = ref1.length; k < len2; k++) {
            extension = ref1[k];
            if (endsWith(file, extension)) {
                skip = true;
                break;
            }
        }
    }
    else if (includeExtensions != null) {
        includeThisFile = false;
        for (l = 0, len3 = includeExtensions.length; l < len3; l++) {
            extension = includeExtensions[l];
            if (endsWith(file, extension)) {
                includeThisFile = true;
                break;
            }
        }
        if (!includeThisFile) {
            skip = true;
        }
    }
    return skip;
}
function isRootDir(filename) {
    return filename === path.resolve(filename, "/");
}
function merge(a, b) {
    var answer, key;
    if (a == null) {
        a = {};
    }
    if (b == null) {
        b = {};
    }
    answer = {};
    for (key in a) {
        answer[key] = a[key];
    }
    for (key in b) {
        answer[key] = b[key];
    }
    return answer;
}
function clone(a) {
    var answer, key;
    if (!a) {
        return a;
    }
    answer = {};
    for (key in a) {
        answer[key] = a[key];
    }
    return answer;
}
function makeStringTransform(transformName, options, transformFn) {
    var transform;
    if (options == null) {
        options = {};
    }
    if (transformFn == null) {
        transformFn = options;
        options = {};
    }
    transform = function (file, config) {
        var configData, content, end, ref, write;
        configData =
            transform.configData != null ? transform.configData : loadTransformConfigSync(transformName, file, options);
        if (config != null) {
            configData =
                (ref = clone(configData)) != null
                    ? ref
                    : {
                        config: {}
                    };
            configData.config = merge(configData.config, config);
            if (configData.config.appliesTo) {
                configData.appliesTo = configData.config.appliesTo;
                delete configData.config.appliesTo;
            }
        }
        if (skipFile(file, configData, options)) {
            return new PassThrough();
            //return through()
        }
        content = "";
        write = function (buf) {
            return (content += buf);
        };
        end = function () {
            var err, handleError, transformOptions;
            handleError = (function (_this) {
                return function (error) {
                    var suffix;
                    suffix = " (while " + transformName + " was processing " + file + ")";
                    if (error instanceof Error && error.message) {
                        error.message += suffix;
                    }
                    else {
                        error = new Error("" + error + suffix);
                    }
                    return _this.emit("error", error);
                };
            })(this);
            try {
                transformOptions = {
                    file: file,
                    configData: configData,
                    config: configData != null ? configData.config : void 0,
                    opts: configData != null ? configData.config : void 0
                };
                return transformFn.call(this, content, transformOptions, (function (_this) {
                    return function (err, transformed) {
                        if (err) {
                            return handleError(err);
                        }
                        _this.push(String(transformed));
                        return _this.push(null);
                    };
                })(this));
            }
            catch (_error) {
                err = _error;
                return handleError(err);
            }
        };
        return through(write, end);
    };
    transform.configure = function (config, configOptions) {
        var answer;
        if (configOptions == null) {
            configOptions = {};
        }
        answer = makeStringTransform(transformName, options, transformFn);
        answer.setConfig(config, configOptions);
        return answer;
    };
    transform.setConfig = function (config, configOptions) {
        var configDir, configFile;
        if (configOptions == null) {
            configOptions = {};
        }
        configFile = configOptions.configFile || null;
        configDir = configOptions.configDir || (configFile ? path.dirname(configFile) : null);
        if (!config) {
            this.configData = null;
        }
        else {
            this.configData = {
                config: config,
                configFile: configFile,
                configDir: configDir,
                cached: false
            };
            if (config.appliesTo) {
                this.configData.appliesTo = config.appliesTo;
                delete config.appliesTo;
            }
        }
        return this;
    };
    return transform;
}
function makeFalafelTransform(transformName, options, transformFn) {
    var falafelOptions, ref, transform;
    if (options == null) {
        options = {};
    }
    if (transformFn == null) {
        transformFn = options;
        options = {};
    }
    falafelOptions = (ref = options.falafelOptions) != null ? ref : {};
    transform = makeStringTransform(transformName, options, function (content, transformOptions, done) {
        var pending, transformCb, transformErr, transformed;
        transformErr = null;
        pending = 1;
        transformed = null;
        transformCb = function (err) {
            if (err && !transformErr) {
                transformErr = err;
                done(err);
            }
            if (transformErr) {
                return;
            }
            pending--;
            if (pending === 0) {
                return done(null, transformed);
            }
        };
        transformed = falafel(content, falafelOptions, function (node) {
            var err;
            pending++;
            try {
                return transformFn(node, transformOptions, transformCb);
            }
            catch (_error) {
                err = _error;
                return transformCb(err);
            }
        });
        return transformCb(transformErr, transformed);
    });
    transform.configure = function (config, configOptions) {
        var answer;
        if (configOptions == null) {
            configOptions = {};
        }
        answer = makeFalafelTransform(transformName, options, transformFn);
        answer.setConfig(config, configOptions);
        return answer;
    };
    return transform;
}
function makeRequireTransform(transformName, options, transformFn) {
    var evaluateArguments, ref, transform;
    if (options == null) {
        options = {};
    }
    if (transformFn == null) {
        transformFn = options;
        options = {};
    }
    evaluateArguments = (ref = options.evaluateArguments) != null ? ref : true;
    transform = makeFalafelTransform(transformName, options, function (node, transformOptions, done) {
        var args;
        if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
            args = evaluateFunctionArgs(evaluateArguments, transformOptions, node);
            return transformFn(args.values(), transformOptions, function (err, transformed) {
                if (err) {
                    return done(err);
                }
                if (transformed != null) {
                    node.update(transformed);
                }
                return done();
            });
        }
        else {
            return done();
        }
    });
    transform.configure = function (config, configOptions) {
        var answer;
        if (configOptions == null) {
            configOptions = {};
        }
        answer = makeRequireTransform(transformName, options, transformFn);
        answer.setConfig(config, configOptions);
        return answer;
    };
    return transform;
}
function makeFunctionTransform(transformName, options, transformFn) {
    var evaluateArguments;
    var functionNames = [];
    var ref;
    var transform;
    if (options == null) {
        options = {};
    }
    if (transformFn == null) {
        transformFn = options;
        options = {};
    }
    evaluateArguments = (ref = options.evaluateArguments) != null ? ref : true;
    if (options.functionNames != null) {
        if (Array.isArray(options.functionNames) || {}.toString.call(options.functionNames) === "[object Array]") {
            functionNames = options.functionNames;
        }
        else if (typeof options.functionNames === "string") {
            functionNames = [options.functionNames];
        }
    }
    if (functionNames.length === 0) {
        functionNames.push("require");
    }
    transform = makeFalafelTransform(transformName, options, function (node, transformOptions, done) {
        var args, ref1;
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            ((ref1 = node.callee.name), indexOf.call(functionNames, ref1) >= 0)) {
            args = evaluateFunctionArgs(evaluateArguments, transformOptions, node);
            return transformFn({
                name: node.callee.name,
                args: args
            }, transformOptions, function (err, transformed) {
                if (err) {
                    return done(err);
                }
                if (transformed != null) {
                    node.update(transformed);
                }
                return done();
            });
        }
        else {
            return done();
        }
    });
    transform.configure = function (config, configOptions) {
        var answer;
        if (configOptions == null) {
            configOptions = {};
        }
        answer = makeFunctionTransform(transformName, options, transformFn);
        answer.setConfig(config, configOptions);
        return answer;
    };
    return transform;
}
function runTransform(transform, file, options, done) {
    var doTransform;
    if (options == null) {
        options = {};
    }
    if (done == null) {
        done = options;
        options = {};
    }
    doTransform = function (content) {
        var data, err, throughStream;
        data = "";
        err = null;
        throughStream = options.config != null ? transform(file, options.config) : transform(file);
        throughStream.on("data", function (d) {
            return (data += d);
        });
        throughStream.on("end", function () {
            if (!err) {
                return done(null, data);
            }
        });
        throughStream.on("error", function (e) {
            err = e;
            return done(err);
        });
        throughStream.write(content);
        return throughStream.end();
    };
    if (options.content) {
        return process.nextTick(function () {
            return doTransform(options.content);
        });
    }
    else {
        return fs.readFile(file, "utf-8", function (err, content) {
            if (err) {
                return done(err);
            }
            return doTransform(content);
        });
    }
}
function evaluateFunctionArgs(evaluateArguments, transformOptions, node) {
    var arg, args, dirname, varNames, vars;
    if (evaluateArguments) {
        dirname = path.dirname(transformOptions.file);
        varNames = ["__filename", "__dirname", "path", "join"];
        vars = [transformOptions.file, dirname, path, path.join];
        args = node["arguments"].map(function (arg) {
            var err, t;
            t = "return " + arg.source();
            try {
                return {
                    value: Function(varNames, t).apply(null, vars),
                    type: arg.type
                };
            }
            catch (_error) {
                err = _error;
                return {
                    value: arg.source(),
                    type: arg.type
                };
            }
        });
    }
    else {
        args = (function () {
            var i, len, ref, results;
            ref = node["arguments"];
            results = [];
            for (i = 0, len = ref.length; i < len; i++) {
                arg = ref[i];
                results.push({
                    value: arg.source(),
                    type: arg.type
                });
            }
            return results;
        })();
    }
    args.values = function () {
        var i, len, values;
        values = [];
        for (i = 0, len = this.length; i < len; i++) {
            arg = this[i];
            if (arg.value != null) {
                values.push(arg.value);
            }
        }
        return values;
    };
    return args;
}
export var transformTools = {
    parentDir,
    parentDirSync,
    clearConfigCache,
    loadTransformConfig,
    loadTransformConfigSync,
    runTransform,
    makeFalafelTransform,
    makeRequireTransform,
    makeFunctionTransform,
    makeStringTransform,
    skipFile
};
export { parentDir, parentDirSync, clearConfigCache, loadTransformConfig, loadTransformConfigSync, runTransform, makeFalafelTransform, makeRequireTransform, makeFunctionTransform, makeStringTransform, skipFile };
// through v1
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)
//create a readable writable stream.
// function through1(write, end, opts) {
//   write =
//     write ||
//     function (data) {
//       this.queue(data)
//     }
//   end =
//     end ||
//     function () {
//       this.queue(null)
//     }
//   var ended = false
//   var destroyed = false
//   var buffer = []
//   var _ended = false
//   var stream = new Stream()
//   //var stream = new Transform()
//   stream.readable = stream.writable = true
//   stream.paused = false
//   //  stream.autoPause   = !(opts && opts.autoPause   === false)
//   stream.autoDestroy = !(opts && opts.autoDestroy === false)
//   stream.write = function (data) {
//     write.call(this, data)
//     return !stream.paused
//   }
//   function drain() {
//     while (buffer.length && !stream.paused) {
//       var data = buffer.shift()
//       if (null === data) return stream.emit("end")
//       else stream.emit("data", data)
//     }
//   }
//   stream.queue = stream.push = function (data) {
//     //    console.error(ended)
//     if (_ended) return stream
//     if (data === null) _ended = true
//     buffer.push(data)
//     drain()
//     return stream
//   }
//   //this will be registered as the first 'end' listener
//   //must call destroy next tick, to make sure we're after any
//   //stream piped from here.
//   //this is only a problem if end is not emitted synchronously.
//   //a nicer way to do this is to make sure this is the last listener for 'end'
//   stream.on("end", function () {
//     stream.readable = false
//     if (!stream.writable && stream.autoDestroy)
//       process.nextTick(function () {
//         stream.destroy()
//       })
//   })
//   function _end() {
//     stream.writable = false
//     end.call(stream)
//     if (!stream.readable && stream.autoDestroy) stream.destroy()
//   }
//   stream.end = function (data) {
//     if (ended) return
//     ended = true
//     if (arguments.length) stream.write(data)
//     _end() // will emit or queue
//     return stream
//   }
//   stream.destroy = function () {
//     if (destroyed) return
//     destroyed = true
//     ended = true
//     buffer.length = 0
//     stream.writable = stream.readable = false
//     stream.emit("close")
//     return stream
//   }
//   stream.pause = function () {
//     if (stream.paused) return
//     stream.paused = true
//     return stream
//   }
//   stream.resume = function () {
//     if (stream.paused) {
//       stream.paused = false
//       stream.emit("resume")
//     }
//     drain()
//     //may have become paused again,
//     //as drain emits 'data'.
//     if (!stream.paused) stream.emit("drain")
//     return stream
//   }
//   return stream
// }
