import { DataBuffer } from '../../Buffers/dataBuffer.js';

/** @hidden */
class WebGLDataBuffer extends DataBuffer {
    constructor(resource) {
        super();
        this._buffer = resource;
    }
    get underlyingResource() {
        return this._buffer;
    }
}

export { WebGLDataBuffer };
