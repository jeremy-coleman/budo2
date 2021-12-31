import { PassThrough, Transform } from 'stream';
import ts from 'typescript';
var tsconfig = {
    module: "esnext",
    target: "esnext",
    allowJs: true,
    jsx: "preserve",
    experimentalDecorators: true,
    removeComments: true,
    sourceMap: false,
};
function initConfig(filePath) {
    return {
        fileName: filePath,
        compilerOptions: tsconfig,
    };
}
function configure(tscOpts = "FIXME") {
    return function (filename) {
        if (/\.[tj]sx?$/i.test(filename) === false) {
            return new PassThrough();
        }
        const tsConfigObject = initConfig(filename);
        if (tsConfigObject === null) {
            return new PassThrough();
        }
        return new TypescriptStream(tsConfigObject);
    };
}
class TypescriptStream extends Transform {
    _data;
    _opts;
    constructor(opts) {
        super();
        this._data = [];
        this._opts = opts;
    }
    _transform(buf, enc, callback) {
        this._data.push(buf);
        callback();
    }
    _flush(callback) {
        // Merge the chunks before transform
        const data = Buffer.concat(this._data).toString();
        try {
            let result = ts.transpileModule(data, this._opts);
            var code = result !== null ? result.outputText : data;
            this.push(code);
            callback();
        }
        catch (e) {
            callback(e);
        }
    }
}
var tsify = Object.assign(configure(), {
    configure
});
export { tsify };
