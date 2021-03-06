/**
 * Class used to store gfx data (like WebGLBuffer)
 */
class DataBuffer {
    /**
     * Constructs the buffer
     */
    constructor() {
        /**
         * Gets or sets the number of objects referencing this buffer
         */
        this.references = 0;
        /** Gets or sets the size of the underlying buffer */
        this.capacity = 0;
        /**
         * Gets or sets a boolean indicating if the buffer contains 32bits indices
         */
        this.is32Bits = false;
        this.uniqueId = DataBuffer._Counter++;
    }
    /**
     * Gets the underlying buffer
     */
    get underlyingResource() {
        return null;
    }
}
DataBuffer._Counter = 0;

export { DataBuffer };
