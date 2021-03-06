"use strict";

module.exports = onHeaders

function createWriteHead(prevWriteHead, listener) {
    var fired = false;
    return function writeHead(statusCode) {
        var args = setWriteHeadHeaders.apply(this, arguments);
        if (!fired) {
            fired = true;
            listener.call(this);
            if (typeof args[0] === "number" && this.statusCode !== args[0]) {
                args[0] = this.statusCode;
                args.length = 1;
            }
        }
        return prevWriteHead.apply(this, args);
    };
}
function onHeaders(res, listener) {
    if (!res) {
        throw new TypeError("argument res is required");
    }
    if (typeof listener !== "function") {
        throw new TypeError("argument listener must be a function");
    }
    res.writeHead = createWriteHead(res.writeHead, listener);
}
function setHeadersFromArray(res, headers) {
    for (var i = 0; i < headers.length; i++) {
        res.setHeader(headers[i][0], headers[i][1]);
    }
}
function setHeadersFromObject(res, headers) {
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k)
            res.setHeader(k, headers[k]);
    }
}
function setWriteHeadHeaders(statusCode) {
    var length = arguments.length;
    var headerIndex = length > 1 && typeof arguments[1] === "string" ? 2 : 1;
    var headers = length >= headerIndex + 1 ? arguments[headerIndex] : undefined;
    this.statusCode = statusCode;
    if (Array.isArray(headers)) {
        setHeadersFromArray(this, headers);
    }
    else if (headers) {
        setHeadersFromObject(this, headers);
    }
    var args = new Array(Math.min(length, headerIndex));
    for (var i = 0; i < args.length; i++) {
        args[i] = arguments[i];
    }
    return args;
}

