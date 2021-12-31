import { FilterMode, AddressMode } from './webgpuConstants.js';
import { Constants } from '../constants.js';
import { WebGPUTextureHelper } from './webgpuTextureHelper.js';

const filterToBits = [
    0 | 0 << 1 | 0 << 2,
    0 | 0 << 1 | 0 << 2,
    1 | 1 << 1 | 0 << 2,
    1 | 1 << 1 | 1 << 2,
    0 | 0 << 1 | 0 << 2,
    0 | 1 << 1 | 0 << 2,
    0 | 1 << 1 | 1 << 2,
    0 | 1 << 1 | 0 << 2,
    0 | 0 << 1 | 1 << 2,
    1 | 0 << 1 | 0 << 2,
    1 | 0 << 1 | 1 << 2,
    1 | 1 << 1 | 0 << 2,
    1 | 0 << 1 | 0 << 2, // TEXTURE_LINEAR_NEAREST
];
// subtract 0x01FF from the comparison function value before indexing this array!
const comparisonFunctionToBits = [
    0 << 3 | 0 << 4 | 0 << 5 | 0 << 6,
    0 << 3 | 0 << 4 | 0 << 5 | 1 << 6,
    0 << 3 | 0 << 4 | 1 << 5 | 0 << 6,
    0 << 3 | 0 << 4 | 1 << 5 | 1 << 6,
    0 << 3 | 1 << 4 | 0 << 5 | 0 << 6,
    0 << 3 | 1 << 4 | 0 << 5 | 1 << 6,
    0 << 3 | 1 << 4 | 1 << 5 | 0 << 6,
    0 << 3 | 1 << 4 | 1 << 5 | 1 << 6,
    1 << 3 | 0 << 4 | 0 << 5 | 0 << 6, // ALWAYS
];
const filterNoMipToBits = [
    0 << 7,
    1 << 7,
    1 << 7,
    0 << 7,
    0 << 7,
    0 << 7,
    0 << 7,
    1 << 7,
    0 << 7,
    0 << 7,
    0 << 7,
    0 << 7,
    1 << 7, // TEXTURE_LINEAR_NEAREST
];
/** @hidden */
class WebGPUCacheSampler {
    constructor(device) {
        this._samplers = {};
        this._device = device;
        this.disabled = false;
    }
    static GetSamplerHashCode(sampler) {
        var _a, _b, _c;
        // The WebGPU spec currently only allows values 1 and 4 for anisotropy
        const anisotropy = sampler._cachedAnisotropicFilteringLevel && sampler._cachedAnisotropicFilteringLevel > 1 ? 4 : 1;
        let code = filterToBits[sampler.samplingMode] +
            comparisonFunctionToBits[(sampler._comparisonFunction || 0x0202) - 0x0200 + 1] +
            filterNoMipToBits[sampler.samplingMode] + // handle the lodMinClamp = lodMaxClamp = 0 case when no filter used for mip mapping
            (((_a = sampler._cachedWrapU) !== null && _a !== void 0 ? _a : 1) << 8) +
            (((_b = sampler._cachedWrapV) !== null && _b !== void 0 ? _b : 1) << 10) +
            (((_c = sampler._cachedWrapR) !== null && _c !== void 0 ? _c : 1) << 12) +
            ((sampler.useMipMaps ? 1 : 0) << 14) + // need to factor this in because _getSamplerFilterDescriptor depends on samplingMode AND useMipMaps!
            (anisotropy << 15);
        return code;
    }
    static _GetSamplerFilterDescriptor(sampler, anisotropy) {
        let magFilter, minFilter, mipmapFilter, lodMinClamp, lodMaxClamp;
        const useMipMaps = sampler.useMipMaps;
        switch (sampler.samplingMode) {
            case Constants.TEXTURE_LINEAR_LINEAR_MIPNEAREST:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Linear;
                mipmapFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    lodMinClamp = lodMaxClamp = 0;
                }
                break;
            case Constants.TEXTURE_LINEAR_LINEAR_MIPLINEAR:
            case Constants.TEXTURE_TRILINEAR_SAMPLINGMODE:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Linear;
                if (!useMipMaps) {
                    mipmapFilter = FilterMode.Nearest;
                    lodMinClamp = lodMaxClamp = 0;
                }
                else {
                    mipmapFilter = FilterMode.Linear;
                }
                break;
            case Constants.TEXTURE_NEAREST_NEAREST_MIPLINEAR:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    mipmapFilter = FilterMode.Nearest;
                    lodMinClamp = lodMaxClamp = 0;
                }
                else {
                    mipmapFilter = FilterMode.Linear;
                }
                break;
            case Constants.TEXTURE_NEAREST_NEAREST_MIPNEAREST:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Nearest;
                mipmapFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    lodMinClamp = lodMaxClamp = 0;
                }
                break;
            case Constants.TEXTURE_NEAREST_LINEAR_MIPNEAREST:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Linear;
                mipmapFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    lodMinClamp = lodMaxClamp = 0;
                }
                break;
            case Constants.TEXTURE_NEAREST_LINEAR_MIPLINEAR:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Linear;
                if (!useMipMaps) {
                    mipmapFilter = FilterMode.Nearest;
                    lodMinClamp = lodMaxClamp = 0;
                }
                else {
                    mipmapFilter = FilterMode.Linear;
                }
                break;
            case Constants.TEXTURE_NEAREST_LINEAR:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Linear;
                mipmapFilter = FilterMode.Nearest;
                lodMinClamp = lodMaxClamp = 0;
                break;
            case Constants.TEXTURE_NEAREST_NEAREST:
            case Constants.TEXTURE_NEAREST_SAMPLINGMODE:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Nearest;
                mipmapFilter = FilterMode.Nearest;
                lodMinClamp = lodMaxClamp = 0;
                break;
            case Constants.TEXTURE_LINEAR_NEAREST_MIPNEAREST:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Nearest;
                mipmapFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    lodMinClamp = lodMaxClamp = 0;
                }
                break;
            case Constants.TEXTURE_LINEAR_NEAREST_MIPLINEAR:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Nearest;
                if (!useMipMaps) {
                    mipmapFilter = FilterMode.Nearest;
                    lodMinClamp = lodMaxClamp = 0;
                }
                else {
                    mipmapFilter = FilterMode.Linear;
                }
                break;
            case Constants.TEXTURE_LINEAR_LINEAR:
            case Constants.TEXTURE_BILINEAR_SAMPLINGMODE:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Linear;
                mipmapFilter = FilterMode.Nearest;
                lodMinClamp = lodMaxClamp = 0;
                break;
            case Constants.TEXTURE_LINEAR_NEAREST:
                magFilter = FilterMode.Linear;
                minFilter = FilterMode.Nearest;
                mipmapFilter = FilterMode.Nearest;
                lodMinClamp = lodMaxClamp = 0;
                break;
            default:
                magFilter = FilterMode.Nearest;
                minFilter = FilterMode.Nearest;
                mipmapFilter = FilterMode.Nearest;
                lodMinClamp = lodMaxClamp = 0;
                break;
        }
        if (anisotropy > 1 && (lodMinClamp !== 0 || lodMaxClamp !== 0)) {
            return {
                magFilter: FilterMode.Linear,
                minFilter: FilterMode.Linear,
                mipmapFilter: FilterMode.Linear,
                anisotropyEnabled: true,
            };
        }
        return {
            magFilter,
            minFilter,
            mipmapFilter,
            lodMinClamp,
            lodMaxClamp,
        };
    }
    static _GetWrappingMode(mode) {
        switch (mode) {
            case Constants.TEXTURE_WRAP_ADDRESSMODE:
                return AddressMode.Repeat;
            case Constants.TEXTURE_CLAMP_ADDRESSMODE:
                return AddressMode.ClampToEdge;
            case Constants.TEXTURE_MIRROR_ADDRESSMODE:
                return AddressMode.MirrorRepeat;
        }
        return AddressMode.Repeat;
    }
    static _GetSamplerWrappingDescriptor(sampler) {
        return {
            addressModeU: this._GetWrappingMode(sampler._cachedWrapU),
            addressModeV: this._GetWrappingMode(sampler._cachedWrapV),
            addressModeW: this._GetWrappingMode(sampler._cachedWrapR),
        };
    }
    static _GetSamplerDescriptor(sampler) {
        // The WebGPU spec currently only allows values 1 and 4 for anisotropy
        const anisotropy = sampler.useMipMaps && sampler._cachedAnisotropicFilteringLevel && sampler._cachedAnisotropicFilteringLevel > 1 ? 4 : 1;
        const filterDescriptor = this._GetSamplerFilterDescriptor(sampler, anisotropy);
        return {
            ...filterDescriptor,
            ...this._GetSamplerWrappingDescriptor(sampler),
            compare: sampler._comparisonFunction ? WebGPUTextureHelper.GetCompareFunction(sampler._comparisonFunction) : undefined,
            maxAnisotropy: filterDescriptor.anisotropyEnabled ? anisotropy : 1,
        };
    }
    getSampler(sampler, bypassCache = false, hash = 0) {
        if (this.disabled) {
            return this._device.createSampler(WebGPUCacheSampler._GetSamplerDescriptor(sampler));
        }
        if (bypassCache) {
            hash = 0;
        }
        else if (hash === 0) {
            hash = WebGPUCacheSampler.GetSamplerHashCode(sampler);
        }
        let gpuSampler = bypassCache ? undefined : this._samplers[hash];
        if (!gpuSampler) {
            gpuSampler = this._device.createSampler(WebGPUCacheSampler._GetSamplerDescriptor(sampler));
            if (!bypassCache) {
                this._samplers[hash] = gpuSampler;
            }
        }
        return gpuSampler;
    }
}

export { WebGPUCacheSampler };
