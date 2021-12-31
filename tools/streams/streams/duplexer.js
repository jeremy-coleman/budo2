/* -------------------------------------------------------------------------- */
/*                                  duplexer2                                 */
/* -------------------------------------------------------------------------- */
import { Duplex, Readable } from "stream";
class DuplexWrapper extends Duplex {
    _writable;
    _readable;
    _waiting;
    constructor(writable, readable, options) {
        super({ objectMode: true, ...options });
        if (typeof readable.read !== "function") {
            readable = new Readable(options).wrap(readable);
        }
        this._writable = writable;
        this._readable = readable;
        this._waiting = false;
        var self = this;
        writable.once("finish", function () {
            self.end();
        });
        this.once("finish", function () {
            writable.end();
        });
        readable.on("readable", function () {
            if (self._waiting) {
                self._waiting = false;
                self._read();
            }
        });
        readable.once("end", function () {
            self.push(null);
        });
        if (!options || typeof options.bubbleErrors === "undefined" || options.bubbleErrors) {
            writable.on("error", function (err) {
                self.emit("error", err);
            });
            readable.on("error", function (err) {
                self.emit("error", err);
            });
        }
    }
    _write(input, encoding, done) {
        this._writable.write(input, encoding, done);
    }
    _read() {
        var buf;
        var reads = 0;
        while ((buf = this._readable.read()) !== null) {
            this.push(buf);
            reads++;
        }
        if (reads === 0) {
            this._waiting = true;
        }
    }
}
export { DuplexWrapper };
