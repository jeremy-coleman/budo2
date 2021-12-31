import { Constants } from '../../Engines/constants.js';

/**
 * Class used to store a texture sampler data
 */
class TextureSampler {
    /**
     * Creates a Sampler instance
     */
    constructor() {
        /**
         * Gets the sampling mode of the texture
         */
        this.samplingMode = -1;
        this._useMipMaps = true;
        /** @hidden */
        this._cachedWrapU = null;
        /** @hidden */
        this._cachedWrapV = null;
        /** @hidden */
        this._cachedWrapR = null;
        /** @hidden */
        this._cachedAnisotropicFilteringLevel = null;
        /** @hidden */
        this._comparisonFunction = 0;
    }
    /**
    * | Value | Type               | Description |
    * | ----- | ------------------ | ----------- |
    * | 0     | CLAMP_ADDRESSMODE  |             |
    * | 1     | WRAP_ADDRESSMODE   |             |
    * | 2     | MIRROR_ADDRESSMODE |             |
    */
    get wrapU() {
        return this._cachedWrapU;
    }
    set wrapU(value) {
        this._cachedWrapU = value;
    }
    /**
    * | Value | Type               | Description |
    * | ----- | ------------------ | ----------- |
    * | 0     | CLAMP_ADDRESSMODE  |             |
    * | 1     | WRAP_ADDRESSMODE   |             |
    * | 2     | MIRROR_ADDRESSMODE |             |
    */
    get wrapV() {
        return this._cachedWrapV;
    }
    set wrapV(value) {
        this._cachedWrapV = value;
    }
    /**
    * | Value | Type               | Description |
    * | ----- | ------------------ | ----------- |
    * | 0     | CLAMP_ADDRESSMODE  |             |
    * | 1     | WRAP_ADDRESSMODE   |             |
    * | 2     | MIRROR_ADDRESSMODE |             |
    */
    get wrapR() {
        return this._cachedWrapR;
    }
    set wrapR(value) {
        this._cachedWrapR = value;
    }
    /**
     * With compliant hardware and browser (supporting anisotropic filtering)
     * this defines the level of anisotropic filtering in the texture.
     * The higher the better but the slower.
     */
    get anisotropicFilteringLevel() {
        return this._cachedAnisotropicFilteringLevel;
    }
    set anisotropicFilteringLevel(value) {
        this._cachedAnisotropicFilteringLevel = value;
    }
    /**
     * Gets or sets the comparison function (Constants.LESS, Constants.EQUAL, etc). Set 0 to not use a comparison function
     */
    get comparisonFunction() {
        return this._comparisonFunction;
    }
    set comparisonFunction(value) {
        this._comparisonFunction = value;
    }
    /**
     * Indicates to use the mip maps (if available on the texture).
     * Thanks to this flag, you can instruct the sampler to not sample the mipmaps even if they exist (and if the sampling mode is set to a value that normally samples the mipmaps!)
     */
    get useMipMaps() {
        return this._useMipMaps;
    }
    set useMipMaps(value) {
        this._useMipMaps = value;
    }
    /**
     * Sets all the parameters of the sampler
     * @param wrapU u address mode (default: TEXTURE_WRAP_ADDRESSMODE)
     * @param wrapV v address mode (default: TEXTURE_WRAP_ADDRESSMODE)
     * @param wrapR r address mode (default: TEXTURE_WRAP_ADDRESSMODE)
     * @param anisotropicFilteringLevel anisotropic level (default: 1)
     * @param samplingMode sampling mode (default: Constants.TEXTURE_BILINEAR_SAMPLINGMODE)
     * @param comparisonFunction comparison function (default: 0 - no comparison function)
     * @returns the current sampler instance
     */
    setParameters(wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE, wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE, wrapR = Constants.TEXTURE_WRAP_ADDRESSMODE, anisotropicFilteringLevel = 1, samplingMode = Constants.TEXTURE_BILINEAR_SAMPLINGMODE, comparisonFunction = 0) {
        this._cachedWrapU = wrapU;
        this._cachedWrapV = wrapV;
        this._cachedWrapR = wrapR;
        this._cachedAnisotropicFilteringLevel = anisotropicFilteringLevel;
        this.samplingMode = samplingMode;
        this._comparisonFunction = comparisonFunction;
        return this;
    }
    /**
     * Compares this sampler with another one
     * @param other sampler to compare with
     * @returns true if the samplers have the same parametres, else false
     */
    compareSampler(other) {
        return this._cachedWrapU === other._cachedWrapU &&
            this._cachedWrapV === other._cachedWrapV &&
            this._cachedWrapR === other._cachedWrapR &&
            this._cachedAnisotropicFilteringLevel === other._cachedAnisotropicFilteringLevel &&
            this.samplingMode === other.samplingMode &&
            this._comparisonFunction === other._comparisonFunction &&
            this._useMipMaps === other._useMipMaps;
    }
}

export { TextureSampler };
