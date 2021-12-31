import less from "less";
import { PassThrough, Transform } from "stream";
function createOptions(filename) {
    let options = {
        filename: filename
    };
    return options;
}
function configure(opts) {
    return function (filename) {
        if (/\.(less|css)$/i.test(filename) === false) {
            return new PassThrough();
        }
        return new LessStream(createOptions(opts));
    };
}
class LessStream extends Transform {
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
        less.render(data, this._opts, (err, output) => {
            try {
                var css = cssToCommonjs(output.css, this._opts.autoInject);
                this.push(css);
                callback();
            }
            catch (err) {
                callback(err);
            }
        });
    }
}
function cssToCommonjs(css, autoInject = true) {
    var stringifiedCss = JSON.stringify(css);
    if (autoInject) {
        const out = `var css = ${stringifiedCss}; (require('insert-css'))(css); module.exports = css;`;
        return out;
    }
    else {
        return "module.exports = " + stringifiedCss;
    }
}
var lessify = Object.assign(configure(), {
    configure
});
export { lessify };
