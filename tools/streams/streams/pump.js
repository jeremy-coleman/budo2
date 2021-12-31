//import once from "lodash/once"
import { eos } from "./eos";
var noop = function () { };
function once(callback) {
    var called = false;
    return function () {
        if (called)
            return;
        called = true;
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }
        callback.apply(this, args);
    };
}
function isFn(fn) {
    return typeof fn === "function";
}
function isRequest(stream) {
    return stream.setHeader && isFn(stream.abort);
}
function destroyer(stream, reading, writing, callback) {
    callback = once(callback);
    var closed = false;
    stream.on("close", function () {
        closed = true;
    });
    eos(stream, { readable: reading, writable: writing }, function (err) {
        if (err)
            return callback(err);
        closed = true;
        callback();
    });
    var destroyed = false;
    return function (err) {
        if (closed)
            return;
        if (destroyed)
            return;
        destroyed = true;
        //if (false) return stream.close(noop) // use close for fs streams to avoid fd leaks
        if (isRequest(stream))
            return stream.abort(); // request.destroy just do .end - .abort is what we want
        if (isFn(stream.destroy))
            return stream.destroy();
        callback(err || new Error("stream was destroyed"));
    };
}
function call(fn) {
    fn();
}
function pipe(from, to) {
    return from.pipe(to);
}
function pump(...streams) {
    var callback = (isFn(streams[streams.length - 1] || noop) && streams.pop()) || noop;
    if (Array.isArray(streams[0]))
        streams = streams[0];
    if (streams.length < 2)
        throw new Error("pump requires two streams per minimum");
    var error;
    var destroys = streams.map(function (stream, i) {
        var reading = i < streams.length - 1;
        var writing = i > 0;
        return destroyer(stream, reading, writing, function (err) {
            if (!error)
                error = err;
            if (err)
                destroys.forEach(call);
            if (reading)
                return;
            destroys.forEach(call);
            callback(error);
        });
    });
    return streams.reduce(pipe);
}
export { pump };
