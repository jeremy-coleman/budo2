import { readFileSync } from "fs";
import https from "https";
import _ from "lodash";
import { resolve } from "path";
import { Server } from "ws";
import { through } from "../streams";
function log(msg, ...data) {
    const t = /T([0-9:.]+)Z/g.exec(new Date().toISOString())[1];
    console.log(colors.green(`[${t}] HMR`), "::", colors.cyan(msg));
    data.forEach((d) => console.log(colors.yellow("  >"), colors.yellow(d)));
}
function logError(error) {
    if (error) {
        log(error);
    }
}
export function startServer({ port, sslKey, sslCert }) {
    if ((sslCert && !sslKey) || (!sslCert && sslKey)) {
        throw new Error("You need both a certificate AND key in order to use SSL");
    }
    let wss;
    if (sslCert && sslKey) {
        const key = readFileSync(sslKey, "utf8");
        const cert = readFileSync(sslCert, "utf8");
        const credentials = { key, cert };
        const server = https.createServer(credentials);
        server.listen(port);
        wss = new Server({ server });
    }
    else {
        wss = new Server({ port });
    }
    log("Reload server up and listening in port " + port + "...");
    const server = {
        notifyReload(metadata) {
            if (wss.clients.length) {
                log("Notify clients about bundle change...");
            }
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "change",
                    data: metadata
                }), logError);
            });
        },
        notifyBundleError(error) {
            if (wss.clients.length) {
                log("Notify clients about bundle error...");
            }
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "bundle_error",
                    data: { error: error.toString() }
                }), logError);
            });
        }
    };
    wss.on("connection", (client) => {
        log("New client connected");
    });
    return server;
}
/*eslint semi: "error"*/
/**
 * This is modified version of Browserify's original module loader function,
 * made to support HotReload's reloading functionality.
 *
 *
 * @param mappings
 *    An object containing modules and their metadata, created by
 *    HotReload plugin. The structure of the mappings object is:
 *    {
 *      [module_id]: [
 *        "...module_source...",
 *        {
 *          "module": target_id,
 *          "./another/module": target_id,
 *          ...
 *        },
 *        {
 *          hash: "32bit_hash_from_source",
 *          isEntry: true|false
 *        }
 *      ],
 *      ...
 *    }
 *
 * @param entryPoints
 *    List of bundle's entry point ids. At the moment, only one entry point
 *    is supported by HotReload
 * @param options
 *    HotReload options passed from the CLI/plugin params
 */
function loader(mappings, entryPoints, options) {
    if (entryPoints.length > 1) {
        throw new Error("HotReload supports only one entry point at the moment");
    }
    var entryId = entryPoints[0];
    var scope = {
        mappings: mappings,
        cache: {},
        reloadHooks: {}
    };
    function startClient() {
        if (!options.clientEnabled) {
            return;
        }
        if (typeof window.WebSocket === "undefined") {
            warn("WebSocket API not available, reloading is disabled");
            return;
        }
        var protocol = window.location.protocol === "https:" ? "wss" : "ws";
        var url = protocol + "://" + (options.host || window.location.hostname);
        if (options.port != 80) {
            url = url + ":" + options.port;
        }
        var ws = new WebSocket(url);
        ws.onopen = function () {
            info("WebSocket client listening for changes...");
        };
        ws.onmessage = function (m) {
            var msg = JSON.parse(m.data);
            if (msg.type === "change") {
                handleBundleChange(msg.data);
            }
            else if (msg.type === "bundle_error") {
                handleBundleError(msg.data);
            }
        };
    }
    function compile(mapping) {
        var body = mapping[0];
        if (typeof body !== "function") {
            var compiled = compileModule(body, mapping[2].sourcemap);
            mapping[0] = compiled;
            mapping[2].source = body;
        }
    }
    function compileModule(source, sourcemap) {
        var toModule = new Function("__HotReload_source", "__HotReload_sourcemap", "return eval('function __HotReload_module(require, module, exports){\\n' + __HotReload_source + '\\n}; __HotReload_module;' + (__HotReload_sourcemap || ''));");
        return toModule(source, sourcemap);
    }
    function unknownUseCase() {
        throw new Error("HotReload::Unknown use-case encountered!");
    }
    // returns loaded module from cache or if not found, then
    // loads it from the source and caches it
    function load(id) {
        var mappings = scope.mappings;
        var cache = scope.cache;
        if (!cache[id]) {
            if (!mappings[id]) {
                var req = typeof require == "function" && require;
                if (req)
                    return req(id);
                var error = new Error("Cannot find module '" + id + "'");
                error.code = "MODULE_NOT_FOUND";
                throw error;
            }
            var module = (cache[id] = {
                exports: {},
                hot: {
                    onUpdate: function (maybe, hook) {
                        var realHook = hook;
                        if (!realHook) {
                            realHook = maybe;
                        }
                        else {
                            console.warn("HotReload: You are providing two arguments to the module.hot.onUpdate hook, and we are" +
                                "ignoring the first argument. You may have copied and pasted a webpack hook. For compatibility, we are" +
                                "accepting this, and it will probably work, but please remove the first argument to avoid confusion.");
                        }
                        scope.reloadHooks[id] = realHook;
                    }
                }
            });
            mappings[id][0].call(module.exports, function require(path) {
                var targetId = mappings[id][1][path];
                return load(targetId ? targetId : path);
            }, module, module.exports, unknownUseCase, mappings, cache, entryPoints);
        }
        return cache[id].exports;
    }
    /**
     * Patches the existing modules with new sources and returns a list of changes
     * (module id and old mapping. ATTENTION: This function does not do any reloading yet.
     *
     * @param mappings
     *    New mappings
     * @returns {Array}
     *    List of changes
     */
    function patch(mappings) {
        var changes = [];
        keys(mappings).forEach(function (id) {
            var old = scope.mappings[id];
            var mapping = mappings[id];
            var meta = mapping[2];
            if (!old || old[2].hash !== meta.hash) {
                compile(mapping);
                scope.mappings[id] = mapping;
                changes.push([id, old]);
            }
        });
        return changes;
    }
    /**
     * Reloads modules based on the given changes. If reloading fails, this function
     * tries to restore old implementation.
     *
     * @param changes
     *    Changes array received from "patch" function
     */
    function reload(changes) {
        var changedModules = changes.map(function (c) {
            return c[0];
        });
        var newMods = changes
            .filter(function (c) {
            return !c[1];
        })
            .map(function (c) {
            return c[0];
        });
        try {
            info("Applying changes...");
            evaluate(entryId, {});
            info("Reload complete!");
        }
        catch (e) {
            error("Error occurred while reloading changes. Restoring old implementation...");
            console.error(e);
            console.error(e.stack);
            try {
                restore();
                evaluate(entryId, {});
                info("Restored!");
            }
            catch (re) {
                error("Restore failed. You may need to refresh your browser... :-/");
                console.error(re);
                console.error(re.stack);
            }
        }
        function evaluate(id, changeCache) {
            if (id in changeCache) {
                return changeCache[id];
            }
            if (isExternalModule(id)) {
                return false;
            }
            // initially mark change status to follow module's change status
            // TODO: how to propagate change status from children to this without causing infinite recursion?
            var meChanged = contains(changedModules, id);
            changeCache[id] = meChanged;
            var originalCache = scope.cache[id];
            if (id in scope.cache) {
                delete scope.cache[id];
            }
            var deps = vals(scope.mappings[id][1]).filter(isLocalModule);
            var depsChanged = deps.map(function (dep) {
                return evaluate(dep, changeCache);
            });
            // In the case of circular dependencies, the module evaluation stops because of the
            // changeCache check above. Also module cache should be clear. However, if some circular
            // dependency (or its descendant) gets reloaded, it (re)loads new version of this
            // module back to cache. That's why we need to ensure that we're not
            //    1) reloading module twice (so that we don't break cross-refs)
            //    2) reload any new version if there is no need for reloading
            //
            // Hence the complex "scope.cache" stuff...
            //
            var isReloaded = originalCache !== undefined && id in scope.cache;
            var depChanged = any(depsChanged);
            if (isReloaded || depChanged || meChanged) {
                if (!isReloaded) {
                    var hook = scope.reloadHooks[id];
                    if (typeof hook === "function" && hook()) {
                        console.log(" > Manually accepted", id);
                        scope.cache[id] = originalCache;
                        changeCache[id] = false;
                    }
                    else {
                        var msg = contains(newMods, id) ? " > Add new module   ::" : " > Reload module    ::";
                        console.log(msg, id);
                        load(id);
                        changeCache[id] = true;
                    }
                }
                else {
                    console.log(" > Already reloaded ::", id);
                }
                return changeCache[id];
            }
            else {
                // restore old version of the module
                if (originalCache !== undefined) {
                    scope.cache[id] = originalCache;
                }
                return false;
            }
        }
        function restore() {
            changes.forEach(function (c) {
                var id = c[0], mapping = c[1];
                if (mapping) {
                    scope.mappings[id] = mapping;
                }
                else {
                    delete scope.mappings[id];
                }
            });
        }
    }
    function handleBundleChange(newMappings) {
        info("Bundle changed");
        var changes = patch(newMappings);
        if (changes.length > 0) {
            reload(changes);
        }
        else {
            info("Nothing to reload");
        }
    }
    function handleBundleError(data) {
        error("Bundling error occurred");
        error(data.error);
    }
    // prepare mappings before starting the app
    forEachValue(scope.mappings, compile);
    startClient();
    if (options.clientRequires && options.clientRequires.length) {
        options.clientRequires.forEach(load);
    }
    // standalone bundles may need the exports from entry module
    return load(entryId);
    function isLocalModule(id) {
        //if(id.indexOf(options.nodeModulesRoot) === -1)console.log(id)
        return id.indexOf(options.nodeModulesRoot) === -1;
    }
    function isExternalModule(id) {
        return !(id in scope.mappings);
    }
    function keys(obj) {
        return obj ? Object.keys(obj) : [];
    }
    function vals(obj) {
        return keys(obj).map(function (key) {
            return obj[key];
        });
    }
    function contains(col, val) {
        for (var i = 0; i < col.length; i++) {
            if (col[i] === val)
                return true;
        }
        return false;
    }
    function all(col, f) {
        if (!f) {
            f = function (x) {
                return x;
            };
        }
        for (var i = 0; i < col.length; i++) {
            if (!f(col[i]))
                return false;
        }
        return true;
    }
    function any(col) {
        for (var i = 0; i < col.length; i++) {
            if (col[i])
                return true;
        }
        return false;
    }
    function forEachValue(obj, fn) {
        keys(obj).forEach(function (key) {
            if (obj.hasOwnProperty(key)) {
                fn(obj[key]);
            }
        });
    }
    function info(msg) {
        console.info("HotReload ::", msg);
    }
    function warn(msg) {
        console.warn("HotReload ::", msg);
    }
    function error(msg) {
        console.error("HotReload ::", msg);
    }
}
function leftPad(str, len, ch) {
    str = String(str);
    var i = -1;
    if (!ch && ch !== 0)
        ch = " ";
    len = len - str.length;
    while (++i < len) {
        str = ch + str;
    }
    return str;
}
function HotReloadPlugin(b, opts = {}) {
    const { port = 4474, host = null, babel = true, client = true, dedupe = true, debug = false, basedir = process.cwd(), sslCert = null, sslKey = null } = opts;
    // server is alive as long as watchify is running
    const server = opts.server !== false ? startServer({ port: Number(port), sslCert, sslKey }) : null;
    let clientRequires = [];
    // try {
    //   const RHLPatchModule = "react-hot-loader/patch"
    //   require.resolve(RHLPatchModule)
    //   clientRequires.push(RHLPatchModule)
    // } catch (e) {}
    const clientOpts = {
        // assuming that livereload package is in global mdule directory (node_modules)
        // and this file is in ./lib/babel-plugin folder
        //nodeModulesRoot: resolve(__dirname, '../../..'),
        nodeModulesRoot: resolve(process.cwd(), "node_modules"),
        port: Number(port),
        host: host,
        clientEnabled: client,
        debug: debug,
        babel: babel,
        clientRequires: clientRequires
    };
    clientRequires.forEach((file) => b.require(file, opts));
    b.on("reset", addHooks);
    addHooks();
    function addHooks() {
        // this cache object is preserved over single bundling
        // pipeline so when next bundling occurs, this cache
        // object is thrown away
        const mappings = {};
        const pathById = {};
        const pathByIdx = {};
        const entries = [];
        let standalone = null;
        const idToPath = (id) => pathById[id] || (_.isString(id) && id) || throws("Full path not found for id: " + id);
        const idxToPath = (idx) => pathByIdx[idx] || (_.isString(idx) && idx) || throws("Full path not found for index: " + idx);
        if (server) {
            b.pipeline.on("error", server.notifyBundleError);
        }
        b.pipeline.get("record").push(through.obj(function transform(row, enc, next) {
            const s = _.get(row, "options._flags.standalone");
            if (s) {
                standalone = s;
            }
            next(null, row);
        }));
        b.pipeline.get("sort").push(through.obj(function transform(row, enc, next) {
            const { id, index, file } = row;
            pathById[id] = file;
            pathByIdx[index] = file;
            next(null, row);
        }));
        if (!dedupe) {
            b.pipeline.splice("dedupe", 1, through.obj());
            if (b.pipeline.get("dedupe")) {
                log("Other plugins have added de-duplicate transformations. --no-dedupe is not effective");
            }
        }
        else {
            b.pipeline.splice("dedupe", 0, through.obj(function transform(row, enc, next) {
                const cloned = _.extend({}, row);
                if (row.dedupeIndex) {
                    cloned.dedupeIndex = idxToPath(row.dedupeIndex);
                }
                if (row.dedupe) {
                    cloned.dedupe = idToPath(row.dedupe);
                }
                next(null, cloned);
            }));
        }
        b.pipeline.get("label").push(through.obj(function transform(row, enc, next) {
            const { id, file, source, deps, entry } = row;
            //const converter = convertSourceMaps.fromSource(source)
            let sourceWithoutMaps = source;
            let adjustedSourcemap = "";
            let hash;
            // if (converter) {
            //   const sources = converter.getProperty("sources") || []
            //   sourceWithoutMaps = convertSourceMaps.removeComments(source)
            //   hash = getHash(sourceWithoutMaps)
            //   converter.setProperty(
            //     "sources",
            //     sources.map((source) => (source += "?version=" + hash))
            //   )
            //   adjustedSourcemap = convertSourceMaps.fromObject(offsetSourceMaps(converter.toObject(), 1)).toComment()
            // }
            // else {
            //   hash = getHash(source)
            // }
            hash = getHash(source);
            if (entry) {
                entries.push(file);
            }
            mappings[file] = [
                sourceWithoutMaps,
                deps,
                { id: file, hash: hash, browserifyId: id, sourcemap: adjustedSourcemap }
            ];
            next(null, row);
        }, function flush(next) {
            next();
        }));
        b.pipeline.get("wrap").push(through.obj(function transform(row, enc, next) {
            next(null);
        }, function flush(next) {
            const pathById = _.fromPairs(_.toPairs(mappings).map(([file, [s, d, { browserifyId: id }]]) => [id, file]));
            const idToPath = (id) => pathById[id] || (_.isString(id) && id);
            const depsToPaths = (deps) => _.reduce(deps, (m, v, k) => {
                let id = idToPath(v);
                if (id) {
                    m[k] = id;
                }
                return m;
            }, {});
            const withFixedDepsIds = _.mapValues(mappings, ([src, deps, meta]) => [src, depsToPaths(deps), meta]);
            const args = [withFixedDepsIds, entries, clientOpts];
            let bundleSrc = `(${loader.toString()})(${args.map((a) => JSON.stringify(a, null, 2)).join(", ")});`;
            //other finalizers could go here
            // if (standalone) {
            //   var umd = require("umd")
            //   bundleSrc = umd(standalone, `return ${bundleSrc}`)
            // }
            this.push(Buffer.from(bundleSrc, "utf8"));
            if (server) {
                server.notifyReload(withFixedDepsIds);
            }
            next();
        }));
    }
    function throws(msg) {
        throw new Error(msg);
    }
}
//https://github.com/alexgorbatchev/node-crc
function defineCrc(model, calc) {
    const fn = (buf, previous) => calc(buf, previous) >>> 0;
    fn.signed = calc;
    fn.unsigned = fn;
    fn.model = model;
    return fn;
}
// Generated by `./pycrc.py --algorithm=table-driven --model=crc-32 --generate=c`
// prettier-ignore
let TABLE = new Int32Array([
    0x00000000, 0x77073096, 0xee0e612c, 0x990951ba,
    0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
    0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988,
    0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
    0x1db71064, 0x6ab020f2, 0xf3b97148, 0x84be41de,
    0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
    0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec,
    0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
    0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172,
    0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
    0x35b5a8fa, 0x42b2986c, 0xdbbbc9d6, 0xacbcf940,
    0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
    0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116,
    0x21b4f4b5, 0x56b3c423, 0xcfba9599, 0xb8bda50f,
    0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924,
    0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
    0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a,
    0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
    0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818,
    0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
    0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e,
    0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
    0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c,
    0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2,
    0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
    0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0,
    0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9,
    0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086,
    0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
    0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4,
    0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
    0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a,
    0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
    0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8,
    0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
    0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe,
    0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
    0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc,
    0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5,
    0xd6d6a3e8, 0xa1d1937e, 0x38d8c2c4, 0x4fdff252,
    0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
    0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60,
    0xdf60efc3, 0xa867df55, 0x316e8eef, 0x4669be79,
    0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236,
    0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f,
    0xc5ba3bbe, 0xb2bd0b28, 0x2bb45a92, 0x5cb36a04,
    0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
    0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a,
    0x9c0906a9, 0xeb0e363f, 0x72076785, 0x05005713,
    0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38,
    0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21,
    0x86d3d2d4, 0xf1d4e242, 0x68ddb3f8, 0x1fda836e,
    0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
    0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c,
    0x8f659eff, 0xf862ae69, 0x616bffd3, 0x166ccf45,
    0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2,
    0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db,
    0xaed16a4a, 0xd9d65adc, 0x40df0b66, 0x37d83bf0,
    0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
    0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6,
    0xbad03605, 0xcdd70693, 0x54de5729, 0x23d967bf,
    0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94,
    0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
]);
const crc32 = defineCrc("crc-32", function (buf, previous) {
    if (!Buffer.isBuffer(buf))
        buf = Buffer.from(buf);
    let crc = previous === 0 ? 0 : ~~previous ^ -1;
    for (let index = 0; index < buf.length; index++) {
        const byte = buf[index];
        crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return crc ^ -1;
});
function getHash(data) {
    const crcHash = leftPad(crc32(data).toString(16), 8, "0");
    return Buffer.from(crcHash, "hex").toString("base64").replace(/=/g, "");
}
function defineColor(start, end) {
    const open = `\x1b[${start}m`;
    const close = `\x1b[${end}m`;
    const regex = new RegExp(`\\x1b\\[${end}m`, "g");
    return (str) => {
        return open + ("" + str).replace(regex, open) + close;
    };
}
var colors = {
    // modifiers
    reset: defineColor(0, 0),
    bold: defineColor(1, 22),
    dim: defineColor(2, 22),
    italic: defineColor(3, 23),
    underline: defineColor(4, 24),
    inverse: defineColor(7, 27),
    hidden: defineColor(8, 28),
    strikethrough: defineColor(9, 29),
    // colors
    black: defineColor(30, 39),
    red: defineColor(31, 39),
    green: defineColor(32, 39),
    yellow: defineColor(33, 39),
    blue: defineColor(34, 39),
    magenta: defineColor(35, 39),
    cyan: defineColor(36, 39),
    white: defineColor(97, 39),
    gray: defineColor(90, 39),
    lightGray: defineColor(37, 39),
    lightRed: defineColor(91, 39),
    lightGreen: defineColor(92, 39),
    lightYellow: defineColor(93, 39),
    lightBlue: defineColor(94, 39),
    lightMagenta: defineColor(95, 39),
    lightCyan: defineColor(96, 39),
    // background colors
    bgBlack: defineColor(40, 49),
    bgRed: defineColor(41, 49),
    bgGreen: defineColor(42, 49),
    bgYellow: defineColor(43, 49),
    bgBlue: defineColor(44, 49),
    bgMagenta: defineColor(45, 49),
    bgCyan: defineColor(46, 49),
    bgWhite: defineColor(107, 49),
    bgGray: defineColor(100, 49),
    bgLightRed: defineColor(101, 49),
    bgLightGreen: defineColor(102, 49),
    bgLightYellow: defineColor(103, 49),
    bgLightBlue: defineColor(104, 49),
    bgLightMagenta: defineColor(105, 49),
    bgLightCyan: defineColor(106, 49),
    bgLightGray: defineColor(47, 49)
};
export { HotReloadPlugin };
