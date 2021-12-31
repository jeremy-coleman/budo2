var path = require("path");
const { Transform, PassThrough } = require("stream");
const fs = require("fs");
//
// ─── WARNING!!!! SUPER WIP ──────────────────────────────────────────────────────────
//
const projectSourceDirectory = path.resolve(process.cwd(), "src");
const sourceDirs = fs
    .readdirSync(projectSourceDirectory)
    .filter(f => !f.includes("."));
//todo , merge this with fs read tsconfig + user options + maybe like a web_modules
//or just use findup
let createConfig = () => {
    const config = {
        baseUrl: ".",
        paths: {}
    };
    for (var x of sourceDirs) {
        config.paths[`${x}/*`] = [`src/${x}/*`];
    }
    return config;
};
const compilerOptions = createConfig();
const findImport = (line) => {
    const matches = line.match(/from (["'])(.*?)\1/) ||
        line.match(/import\((["'])(.*?)\1\)/) ||
        line.match(/require\((["'])(.*?)\1\)/);
    if (!matches) {
        return null;
    }
    //   [..._code_string.matchAll(/require\((["'])(.*?)\1\)/g)].map((v) => v[2]),
    //   [..._code_string.matchAll(/import\((["'])(.*?)\1\)/g)].map((v) => v[2]),
    //   [..._code_string.matchAll(/(}| })from (["'])(.*?)\1/g)].map((v) => v[2]),
    //recurse, (idk why this doesnt break without returning, but it doesnt seem to)
    [
        /from (["'])(.*?)\1/g,
        /import\((["'])(.*?)\1\)/g,
        /require\((["'])(.*?)\1\)/g
    ].some(exp => {
        const results = line.match(exp);
        //console.log(results) return results && results.length > 1
        if (results && results.length > 1) {
            results.map(r => findImport(r));
        }
    });
    return matches[2];
};
function compile(filePath, chunk) {
    const { baseUrl, paths } = compilerOptions;
    const aliases = {};
    const file = chunk.split("\n");
    const lines = [...file];
    const imports = lines
        .map((line, index) => {
        const importLines = findImport(line);
        if (importLines === null) {
            return null;
        }
        return {
            path: filePath,
            index: index,
            import: importLines
        };
    })
        .filter(value => value !== null && value !== undefined);
    Object.entries(paths).forEach(([absoluteKey, ...relativePathValues]) => {
        let resolved = absoluteKey;
        if (absoluteKey.endsWith("/*")) {
            resolved = absoluteKey.replace("/*", "/");
        }
        aliases[resolved] = paths[absoluteKey];
    });
    for (const imported of imports) {
        const line = file[imported.index];
        let resolved = "";
        for (const alias in aliases) {
            if (aliases.hasOwnProperty(alias) && imported.import.startsWith(alias)) {
                const choices = aliases[alias];
                if (choices != undefined) {
                    resolved = choices[0];
                    if (resolved.endsWith("/*")) {
                        resolved = resolved.replace("/*", "/");
                    }
                    resolved = imported.import.replace(alias, resolved);
                    break;
                }
            }
        }
        if (resolved.length < 1) {
            continue;
        }
        let relative = path
            .relative(path.dirname(imported.path), path.resolve(path.dirname(imported.path), path.join(path.relative(path.dirname(imported.path), baseUrl || "./"), resolved)))
            .replace(/\\/g, "/");
        if (relative.length === 0 || !relative.startsWith(".")) {
            relative = "./" + relative;
        }
        lines[imported.index] = line.replace(imported.import, relative);
    }
    return lines.join("\n");
}
const tspathify = (file) => {
    if (!/\.[tjs]x?$/.test(file)) {
        return new PassThrough();
    }
    var _transform = new Transform();
    _transform._write = (chunk, encoding, next) => {
        _transform.push(compile(file, chunk.toString("utf8")));
        next();
    };
    return _transform;
};
module.exports = { tspathify };
