import { DataBuffer } from '../../Buffers/dataBuffer.js';

/** @hidden */
class WebGPUDataBuffer extends DataBuffer {
    constructor(resource) {
        super();
        this._buffer = resource;
    }
    get underlyingResource() {
        return this._buffer;
    }
}

export { WebGPUDataBuffer };
