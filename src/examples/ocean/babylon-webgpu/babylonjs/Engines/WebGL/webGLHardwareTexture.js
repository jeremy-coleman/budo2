/** @hidden */
class WebGLHardwareTexture {
    constructor(existingTexture = null, context) {
        this._MSAARenderBuffer = null;
        this._context = context;
        if (!existingTexture) {
            existingTexture = context.createTexture();
            if (!existingTexture) {
                throw new Error("Unable to create webGL texture");
            }
        }
        this.set(existingTexture);
    }
    get underlyingResource() {
        return this._webGLTexture;
    }
    setUsage(textureSource, generateMipMaps, isCube, width, height) {
    }
    set(hardwareTexture) {
        this._webGLTexture = hardwareTexture;
    }
    reset() {
        this._webGLTexture = null;
        this._MSAARenderBuffer = null;
    }
    release() {
        if (this._MSAARenderBuffer) {
            this._context.deleteRenderbuffer(this._MSAARenderBuffer);
            this._MSAARenderBuffer = null;
        }
        if (this._webGLTexture) {
            this._context.deleteTexture(this._webGLTexture);
        }
        this.reset();
    }
}

export { WebGLHardwareTexture };
