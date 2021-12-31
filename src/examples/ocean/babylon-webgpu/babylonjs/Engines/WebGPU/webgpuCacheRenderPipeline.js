import { Constants } from '../constants.js';
import { TextureFormat, PrimitiveTopology, BlendOperation, BlendFactor, CompareFunction, StencilOperation, VertexFormat, InputStepMode, FrontFace, CullMode, SamplerBindingType, TextureSampleType, IndexFormat } from './webgpuConstants.js';
import { VertexBuffer } from '../../Buffers/buffer.js';
import { WebGPUShaderProcessor } from './webgpuShaderProcessor.js';

var StatePosition;
(function (StatePosition) {
    //DepthBias = 0, // not used, so remove it to improve perf
    //DepthBiasClamp = 1, // not used, so remove it to improve perf
    StatePosition[StatePosition["StencilReadMask"] = 0] = "StencilReadMask";
    StatePosition[StatePosition["StencilWriteMask"] = 1] = "StencilWriteMask";
    StatePosition[StatePosition["DepthBias"] = 2] = "DepthBias";
    StatePosition[StatePosition["DepthBiasSlopeScale"] = 3] = "DepthBiasSlopeScale";
    StatePosition[StatePosition["MRTAttachments1"] = 4] = "MRTAttachments1";
    StatePosition[StatePosition["MRTAttachments2"] = 5] = "MRTAttachments2";
    StatePosition[StatePosition["DepthStencilState"] = 6] = "DepthStencilState";
    StatePosition[StatePosition["RasterizationState"] = 7] = "RasterizationState";
    StatePosition[StatePosition["ColorStates"] = 8] = "ColorStates";
    StatePosition[StatePosition["ShaderStage"] = 9] = "ShaderStage";
    StatePosition[StatePosition["TextureStage"] = 10] = "TextureStage";
    StatePosition[StatePosition["VertexState"] = 11] = "VertexState";
    StatePosition[StatePosition["NumStates"] = 12] = "NumStates";
})(StatePosition || (StatePosition = {}));
// only renderable color/depth/stencil formats are listed here because we use textureFormatToIndex only to map renderable textures
const textureFormatToIndex = {
    "": 0,
    "r8unorm": 1,
    "r8uint": 2,
    "r8sint": 3,
    "r16uint": 4,
    "r16sint": 5,
    "r16float": 6,
    "rg8unorm": 7,
    "rg8uint": 8,
    "rg8sint": 9,
    "r32uint": 10,
    "r32sint": 11,
    "r32float": 12,
    "rg16uint": 13,
    "rg16sint": 14,
    "rg16float": 15,
    "rgba8unorm": 16,
    "rgba8unorm-srgb": 17,
    "rgba8uint": 18,
    "rgba8sint": 19,
    "bgra8unorm": 20,
    "bgra8unorm-srgb": 21,
    "rgb10a2unorm": 22,
    "rg32uint": 23,
    "rg32sint": 24,
    "rg32float": 25,
    "rgba16uint": 26,
    "rgba16sint": 27,
    "rgba16float": 28,
    "rgba32uint": 29,
    "rgba32sint": 30,
    "rgba32float": 31,
    "stencil8": 32,
    "depth16unorm": 33,
    "depth24plus": 34,
    "depth24plus-stencil8": 35,
    "depth32float": 36,
    "depth24unorm-stencil8": 37,
    "depth32float-stencil8": 38,
};
const alphaBlendFactorToIndex = {
    0: 1,
    1: 2,
    0x0300: 3,
    0x0301: 4,
    0x0302: 5,
    0x0303: 6,
    0x0304: 7,
    0x0305: 8,
    0x0306: 9,
    0x0307: 10,
    0x0308: 11,
    0x8001: 12,
    0x8002: 13,
    0x8003: 12,
    0x8004: 13, // OneMinusBlendColor (alpha)
};
const stencilOpToIndex = {
    0x0000: 0,
    0x1E00: 1,
    0x1E01: 2,
    0x1E02: 3,
    0x1E03: 4,
    0x150A: 5,
    0x8507: 6,
    0x8508: 7, // DECR_WRAP
};
/** @hidden */
class WebGPUCacheRenderPipeline {
    constructor(device, emptyVertexBuffer, useTextureStage) {
        this._device = device;
        this._useTextureStage = useTextureStage;
        this._states = new Array(30); // pre-allocate enough room so that no new allocation will take place afterwards
        this._statesLength = 0;
        this._stateDirtyLowestIndex = 0;
        this._emptyVertexBuffer = emptyVertexBuffer;
        this._mrtFormats = [];
        this._parameter = { token: undefined, pipeline: null };
        this.disabled = false;
        this.vertexBuffers = [];
        this._kMaxVertexBufferStride = device.limits.maxVertexBufferArrayStride || 2048;
        this.reset();
    }
    reset() {
        this._isDirty = true;
        this.vertexBuffers.length = 0;
        this.setAlphaToCoverage(false);
        this.resetDepthCullingState();
        this.setClampDepth(false);
        this.setDepthBias(0);
        //this.setDepthBiasClamp(0);
        this._webgpuColorFormat = [TextureFormat.BGRA8Unorm];
        this.setColorFormat(TextureFormat.BGRA8Unorm);
        this.setMRTAttachments([], []);
        this.setAlphaBlendEnabled(false);
        this.setAlphaBlendFactors([null, null, null, null], [null, null]);
        this.setWriteMask(0xF);
        this.setDepthStencilFormat(TextureFormat.Depth24PlusStencil8);
        this.setStencilEnabled(false);
        this.resetStencilState();
        this.setBuffers(null, null, null);
        this._setTextureState(0);
    }
    get colorFormats() {
        return this._mrtAttachments1 > 0 ? this._mrtFormats : this._webgpuColorFormat;
    }
    getRenderPipeline(fillMode, effect, sampleCount, textureState = 0) {
        if (this.disabled) {
            const topology = WebGPUCacheRenderPipeline._GetTopology(fillMode);
            this._setVertexState(effect); // to fill this.vertexBuffers with correct data
            this._parameter.pipeline = this._createRenderPipeline(effect, topology, sampleCount);
            WebGPUCacheRenderPipeline.NumCacheMiss++;
            WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame++;
            return this._parameter.pipeline;
        }
        this._setShaderStage(effect.uniqueId);
        this._setRasterizationState(fillMode, sampleCount);
        this._setColorStates();
        this._setDepthStencilState();
        this._setVertexState(effect);
        this._setTextureState(textureState);
        this.lastStateDirtyLowestIndex = this._stateDirtyLowestIndex;
        if (!this._isDirty && this._parameter.pipeline) {
            this._stateDirtyLowestIndex = this._statesLength;
            WebGPUCacheRenderPipeline.NumCacheHitWithoutHash++;
            return this._parameter.pipeline;
        }
        this._getRenderPipeline(this._parameter);
        this._isDirty = false;
        this._stateDirtyLowestIndex = this._statesLength;
        if (this._parameter.pipeline) {
            WebGPUCacheRenderPipeline.NumCacheHitWithHash++;
            return this._parameter.pipeline;
        }
        const topology = WebGPUCacheRenderPipeline._GetTopology(fillMode);
        this._parameter.pipeline = this._createRenderPipeline(effect, topology, sampleCount);
        this._setRenderPipeline(this._parameter);
        WebGPUCacheRenderPipeline.NumCacheMiss++;
        WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame++;
        return this._parameter.pipeline;
    }
    endFrame() {
        WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame;
        WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame = 0;
    }
    setAlphaToCoverage(enabled) {
        this._alphaToCoverageEnabled = enabled;
    }
    setFrontFace(frontFace) {
        this._frontFace = frontFace;
    }
    setCullEnabled(enabled) {
        this._cullEnabled = enabled;
    }
    setCullFace(cullFace) {
        this._cullFace = cullFace;
    }
    setClampDepth(clampDepth) {
        this._clampDepth = clampDepth;
    }
    resetDepthCullingState() {
        this.setDepthCullingState(false, 2, 1, 0, 0, true, true, Constants.ALWAYS);
    }
    setDepthCullingState(cullEnabled, frontFace, cullFace, zOffset, zOffsetUnits, depthTestEnabled, depthWriteEnabled, depthCompare) {
        this._depthWriteEnabled = depthWriteEnabled;
        this._depthTestEnabled = depthTestEnabled;
        this._depthCompare = (depthCompare !== null && depthCompare !== void 0 ? depthCompare : Constants.ALWAYS) - 0x0200;
        this._cullFace = cullFace;
        this._cullEnabled = cullEnabled;
        this._frontFace = frontFace;
        this.setDepthBiasSlopeScale(zOffset);
        this.setDepthBias(zOffsetUnits);
    }
    setDepthBias(depthBias) {
        if (this._depthBias !== depthBias) {
            this._depthBias = depthBias;
            this._states[StatePosition.DepthBias] = depthBias;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.DepthBias);
        }
    }
    /*public setDepthBiasClamp(depthBiasClamp: number): void {
        if (this._depthBiasClamp !== depthBiasClamp) {
            this._depthBiasClamp = depthBiasClamp;
            this._states[StatePosition.DepthBiasClamp] = depthBiasClamp.toString();
            this._isDirty = true;
        }
    }*/
    setDepthBiasSlopeScale(depthBiasSlopeScale) {
        if (this._depthBiasSlopeScale !== depthBiasSlopeScale) {
            this._depthBiasSlopeScale = depthBiasSlopeScale;
            this._states[StatePosition.DepthBiasSlopeScale] = depthBiasSlopeScale;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.DepthBiasSlopeScale);
        }
    }
    setColorFormat(format) {
        this._webgpuColorFormat[0] = format;
        this._colorFormat = textureFormatToIndex[format];
    }
    setMRTAttachments(attachments, textureArray) {
        var _a;
        if (attachments.length > 10) {
            // If we want more than 10 attachments we need to change this method (and the StatePosition enum) but 10 seems plenty
            // As we need 39 different values we are using 6 bits to encode a texture format, meaning we can encode 5 texture formats in 32 bits
            // We are using 2x32 bit values to handle 10 textures
            throw "Can't handle more than 10 attachments for a MRT in cache render pipeline!";
        }
        this.mrtAttachments = attachments;
        this.mrtTextureArray = textureArray;
        let bits = [0, 0], indexBits = 0, mask = 0, numRT = 0;
        for (let i = 0; i < attachments.length; ++i) {
            const index = attachments[i];
            if (index === 0) {
                continue;
            }
            const texture = textureArray[index - 1];
            const gpuWrapper = texture === null || texture === void 0 ? void 0 : texture._hardwareTexture;
            this._mrtFormats[numRT] = (_a = gpuWrapper === null || gpuWrapper === void 0 ? void 0 : gpuWrapper.format) !== null && _a !== void 0 ? _a : this._webgpuColorFormat[0];
            bits[indexBits] += textureFormatToIndex[this._mrtFormats[numRT]] << mask;
            mask += 6;
            numRT++;
            if (mask >= 32) {
                mask = 0;
                indexBits++;
            }
        }
        this._mrtFormats.length = numRT;
        if (this._mrtAttachments1 !== bits[0] || this._mrtAttachments2 !== bits[1]) {
            this._mrtAttachments1 = bits[0];
            this._mrtAttachments2 = bits[1];
            this._states[StatePosition.MRTAttachments1] = bits[0];
            this._states[StatePosition.MRTAttachments2] = bits[1];
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.MRTAttachments1);
        }
    }
    setAlphaBlendEnabled(enabled) {
        this._alphaBlendEnabled = enabled;
    }
    setAlphaBlendFactors(factors, operations) {
        this._alphaBlendFuncParams = factors;
        this._alphaBlendEqParams = operations;
    }
    setWriteMask(mask) {
        this._writeMask = mask;
    }
    setDepthStencilFormat(format) {
        this._webgpuDepthStencilFormat = format;
        this._depthStencilFormat = format === undefined ? 0 : textureFormatToIndex[format];
    }
    setDepthTestEnabled(enabled) {
        this._depthTestEnabled = enabled;
    }
    setDepthWriteEnabled(enabled) {
        this._depthWriteEnabled = enabled;
    }
    setDepthCompare(func) {
        this._depthCompare = (func !== null && func !== void 0 ? func : Constants.ALWAYS) - 0x0200;
    }
    setStencilEnabled(enabled) {
        this._stencilEnabled = enabled;
    }
    setStencilCompare(func) {
        this._stencilFrontCompare = (func !== null && func !== void 0 ? func : Constants.ALWAYS) - 0x0200;
    }
    setStencilDepthFailOp(op) {
        this._stencilFrontDepthFailOp = op === null ? 1 /* KEEP */ : stencilOpToIndex[op];
    }
    setStencilPassOp(op) {
        this._stencilFrontPassOp = op === null ? 2 /* REPLACE */ : stencilOpToIndex[op];
    }
    setStencilFailOp(op) {
        this._stencilFrontFailOp = op === null ? 1 /* KEEP */ : stencilOpToIndex[op];
    }
    setStencilReadMask(mask) {
        if (this._stencilReadMask !== mask) {
            this._stencilReadMask = mask;
            this._states[StatePosition.StencilReadMask] = mask;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.StencilReadMask);
        }
    }
    setStencilWriteMask(mask) {
        if (this._stencilWriteMask !== mask) {
            this._stencilWriteMask = mask;
            this._states[StatePosition.StencilWriteMask] = mask;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.StencilWriteMask);
        }
    }
    resetStencilState() {
        this.setStencilState(false, Constants.ALWAYS, Constants.KEEP, Constants.REPLACE, Constants.KEEP, 0xFF, 0xFF);
    }
    setStencilState(stencilEnabled, compare, depthFailOp, passOp, failOp, readMask, writeMask) {
        this._stencilEnabled = stencilEnabled;
        this._stencilFrontCompare = (compare !== null && compare !== void 0 ? compare : Constants.ALWAYS) - 0x0200;
        this._stencilFrontDepthFailOp = depthFailOp === null ? 1 /* KEEP */ : stencilOpToIndex[depthFailOp];
        this._stencilFrontPassOp = passOp === null ? 2 /* REPLACE */ : stencilOpToIndex[passOp];
        this._stencilFrontFailOp = failOp === null ? 1 /* KEEP */ : stencilOpToIndex[failOp];
        this.setStencilReadMask(readMask);
        this.setStencilWriteMask(writeMask);
    }
    setBuffers(vertexBuffers, indexBuffer, overrideVertexBuffers) {
        this._vertexBuffers = vertexBuffers;
        this._overrideVertexBuffers = overrideVertexBuffers;
        this._indexBuffer = indexBuffer;
    }
    static _GetTopology(fillMode) {
        switch (fillMode) {
            // Triangle views
            case Constants.MATERIAL_TriangleFillMode:
                return PrimitiveTopology.TriangleList;
            case Constants.MATERIAL_PointFillMode:
                return PrimitiveTopology.PointList;
            case Constants.MATERIAL_WireFrameFillMode:
                return PrimitiveTopology.LineList;
            // Draw modes
            case Constants.MATERIAL_PointListDrawMode:
                return PrimitiveTopology.PointList;
            case Constants.MATERIAL_LineListDrawMode:
                return PrimitiveTopology.LineList;
            case Constants.MATERIAL_LineLoopDrawMode:
                // return this._gl.LINE_LOOP;
                // TODO WEBGPU. Line Loop Mode Fallback at buffer load time.
                throw "LineLoop is an unsupported fillmode in WebGPU";
            case Constants.MATERIAL_LineStripDrawMode:
                return PrimitiveTopology.LineStrip;
            case Constants.MATERIAL_TriangleStripDrawMode:
                return PrimitiveTopology.TriangleStrip;
            case Constants.MATERIAL_TriangleFanDrawMode:
                // return this._gl.TRIANGLE_FAN;
                // TODO WEBGPU. Triangle Fan Mode Fallback at buffer load time.
                throw "TriangleFan is an unsupported fillmode in WebGPU";
            default:
                return PrimitiveTopology.TriangleList;
        }
    }
    static _GetAphaBlendOperation(operation) {
        switch (operation) {
            case Constants.GL_ALPHA_EQUATION_ADD:
                return BlendOperation.Add;
            case Constants.GL_ALPHA_EQUATION_SUBTRACT:
                return BlendOperation.Subtract;
            case Constants.GL_ALPHA_EQUATION_REVERSE_SUBTRACT:
                return BlendOperation.ReverseSubtract;
            case Constants.GL_ALPHA_EQUATION_MIN:
                return BlendOperation.Min;
            case Constants.GL_ALPHA_EQUATION_MAX:
                return BlendOperation.Max;
            default:
                return BlendOperation.Add;
        }
    }
    static _GetAphaBlendFactor(factor) {
        switch (factor) {
            case 0:
                return BlendFactor.Zero;
            case 1:
                return BlendFactor.One;
            case Constants.GL_ALPHA_FUNCTION_SRC:
                return BlendFactor.Src;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_SRC_COLOR:
                return BlendFactor.OneMinusSrc;
            case Constants.GL_ALPHA_FUNCTION_SRC_ALPHA:
                return BlendFactor.SrcAlpha;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_SRC_ALPHA:
                return BlendFactor.OneMinusSrcAlpha;
            case Constants.GL_ALPHA_FUNCTION_DST_ALPHA:
                return BlendFactor.DstAlpha;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_DST_ALPHA:
                return BlendFactor.OneMinusDstAlpha;
            case Constants.GL_ALPHA_FUNCTION_DST_COLOR:
                return BlendFactor.Dst;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_DST_COLOR:
                return BlendFactor.OneMinusDst;
            case Constants.GL_ALPHA_FUNCTION_SRC_ALPHA_SATURATED:
                return BlendFactor.SrcAlphaSaturated;
            case Constants.GL_ALPHA_FUNCTION_CONSTANT_COLOR:
                return BlendFactor.Constant;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_CONSTANT_COLOR:
                return BlendFactor.OneMinusConstant;
            case Constants.GL_ALPHA_FUNCTION_CONSTANT_ALPHA:
                return BlendFactor.Constant;
            case Constants.GL_ALPHA_FUNCTION_ONE_MINUS_CONSTANT_ALPHA:
                return BlendFactor.OneMinusConstant;
            default:
                return BlendFactor.One;
        }
    }
    static _GetCompareFunction(compareFunction) {
        switch (compareFunction) {
            case 0: // NEVER
                return CompareFunction.Never;
            case 1: // LESS
                return CompareFunction.Less;
            case 2: // EQUAL
                return CompareFunction.Equal;
            case 3: // LEQUAL
                return CompareFunction.LessEqual;
            case 4: // GREATER
                return CompareFunction.Greater;
            case 5: // NOTEQUAL
                return CompareFunction.NotEqual;
            case 6: // GEQUAL
                return CompareFunction.GreaterEqual;
            case 7: // ALWAYS
                return CompareFunction.Always;
        }
        return CompareFunction.Never;
    }
    static _GetStencilOpFunction(operation) {
        switch (operation) {
            case 0:
                return StencilOperation.Zero;
            case 1:
                return StencilOperation.Keep;
            case 2:
                return StencilOperation.Replace;
            case 3:
                return StencilOperation.IncrementClamp;
            case 4:
                return StencilOperation.DecrementClamp;
            case 5:
                return StencilOperation.Invert;
            case 6:
                return StencilOperation.IncrementWrap;
            case 7:
                return StencilOperation.DecrementWrap;
        }
        return StencilOperation.Keep;
    }
    static _GetVertexInputDescriptorFormat(vertexBuffer) {
        const type = vertexBuffer.type;
        const normalized = vertexBuffer.normalized;
        const size = vertexBuffer.getSize();
        switch (type) {
            case VertexBuffer.BYTE:
                switch (size) {
                    case 1:
                    case 2:
                        return normalized ? VertexFormat.Snorm8x2 : VertexFormat.Sint8x2;
                    case 3:
                    case 4:
                        return normalized ? VertexFormat.Snorm8x4 : VertexFormat.Sint8x4;
                }
                break;
            case VertexBuffer.UNSIGNED_BYTE:
                switch (size) {
                    case 1:
                    case 2:
                        return normalized ? VertexFormat.Unorm8x2 : VertexFormat.Uint8x2;
                    case 3:
                    case 4:
                        return normalized ? VertexFormat.Unorm8x4 : VertexFormat.Uint8x4;
                }
                break;
            case VertexBuffer.SHORT:
                switch (size) {
                    case 1:
                    case 2:
                        return normalized ? VertexFormat.Snorm16x2 : VertexFormat.Sint16x2;
                    case 3:
                    case 4:
                        return normalized ? VertexFormat.Snorm16x4 : VertexFormat.Sint16x4;
                }
                break;
            case VertexBuffer.UNSIGNED_SHORT:
                switch (size) {
                    case 1:
                    case 2:
                        return normalized ? VertexFormat.Unorm16x2 : VertexFormat.Uint16x2;
                    case 3:
                    case 4:
                        return normalized ? VertexFormat.Unorm16x4 : VertexFormat.Uint16x4;
                }
                break;
            case VertexBuffer.INT:
                switch (size) {
                    case 1:
                        return VertexFormat.Sint32;
                    case 2:
                        return VertexFormat.Sint32x2;
                    case 3:
                        return VertexFormat.Sint32x3;
                    case 4:
                        return VertexFormat.Sint32x4;
                }
                break;
            case VertexBuffer.UNSIGNED_INT:
                switch (size) {
                    case 1:
                        return VertexFormat.Uint32;
                    case 2:
                        return VertexFormat.Uint32x2;
                    case 3:
                        return VertexFormat.Uint32x3;
                    case 4:
                        return VertexFormat.Uint32x4;
                }
                break;
            case VertexBuffer.FLOAT:
                switch (size) {
                    case 1:
                        return VertexFormat.Float32;
                    case 2:
                        return VertexFormat.Float32x2;
                    case 3:
                        return VertexFormat.Float32x3;
                    case 4:
                        return VertexFormat.Float32x4;
                }
                break;
        }
        throw new Error(`Invalid Format '${vertexBuffer.getKind()}' - type=${type}, normalized=${normalized}, size=${size}`);
    }
    _getAphaBlendState() {
        if (!this._alphaBlendEnabled) {
            return null;
        }
        return {
            srcFactor: WebGPUCacheRenderPipeline._GetAphaBlendFactor(this._alphaBlendFuncParams[2]),
            dstFactor: WebGPUCacheRenderPipeline._GetAphaBlendFactor(this._alphaBlendFuncParams[3]),
            operation: WebGPUCacheRenderPipeline._GetAphaBlendOperation(this._alphaBlendEqParams[1]),
        };
    }
    _getColorBlendState() {
        if (!this._alphaBlendEnabled) {
            return null;
        }
        return {
            srcFactor: WebGPUCacheRenderPipeline._GetAphaBlendFactor(this._alphaBlendFuncParams[0]),
            dstFactor: WebGPUCacheRenderPipeline._GetAphaBlendFactor(this._alphaBlendFuncParams[1]),
            operation: WebGPUCacheRenderPipeline._GetAphaBlendOperation(this._alphaBlendEqParams[0]),
        };
    }
    _setShaderStage(id) {
        if (this._shaderId !== id) {
            this._shaderId = id;
            this._states[StatePosition.ShaderStage] = id;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.ShaderStage);
        }
    }
    _setRasterizationState(topology, sampleCount) {
        const frontFace = this._frontFace;
        const cullMode = this._cullEnabled ? this._cullFace : 0;
        const clampDepth = this._clampDepth ? 1 : 0;
        const alphaToCoverage = this._alphaToCoverageEnabled ? 1 : 0;
        const rasterizationState = (frontFace - 1) +
            (cullMode << 1) +
            (clampDepth << 3) +
            (alphaToCoverage << 4) +
            (topology << 5) +
            (sampleCount << 8);
        if (this._rasterizationState !== rasterizationState) {
            this._rasterizationState = rasterizationState;
            this._states[StatePosition.RasterizationState] = this._rasterizationState;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.RasterizationState);
        }
    }
    _setColorStates() {
        let colorStates = ((this._writeMask ? 1 : 0) << 22) + (this._colorFormat << 23) +
            ((this._depthWriteEnabled ? 1 : 0) << 29); // this state has been moved from depthStencilState here because alpha and depth are related (generally when alpha is on, depth write is off and the other way around)
        if (this._alphaBlendEnabled) {
            colorStates +=
                ((this._alphaBlendFuncParams[0] === null ? 2 : alphaBlendFactorToIndex[this._alphaBlendFuncParams[0]]) << 0) +
                    ((this._alphaBlendFuncParams[1] === null ? 2 : alphaBlendFactorToIndex[this._alphaBlendFuncParams[1]]) << 4) +
                    ((this._alphaBlendFuncParams[2] === null ? 2 : alphaBlendFactorToIndex[this._alphaBlendFuncParams[2]]) << 8) +
                    ((this._alphaBlendFuncParams[3] === null ? 2 : alphaBlendFactorToIndex[this._alphaBlendFuncParams[3]]) << 12) +
                    ((this._alphaBlendEqParams[0] === null ? 1 : this._alphaBlendEqParams[0] - 0x8005) << 16) +
                    ((this._alphaBlendEqParams[1] === null ? 1 : this._alphaBlendEqParams[1] - 0x8005) << 19);
        }
        if (colorStates !== this._colorStates) {
            this._colorStates = colorStates;
            this._states[StatePosition.ColorStates] = this._colorStates;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.ColorStates);
        }
    }
    _setDepthStencilState() {
        let stencilState = !this._stencilEnabled ?
            7 /* ALWAYS */ + (1 /* KEEP */ << 3) + (1 /* KEEP */ << 6) + (1 /* KEEP */ << 9) :
            this._stencilFrontCompare + (this._stencilFrontDepthFailOp << 3) + (this._stencilFrontPassOp << 6) + (this._stencilFrontFailOp << 9);
        const depthStencilState = this._depthStencilFormat +
            ((this._depthTestEnabled ? this._depthCompare : 7 /* ALWAYS */) << 6) +
            (stencilState << 10); // stencil front - stencil back is the same
        if (this._depthStencilState !== depthStencilState) {
            this._depthStencilState = depthStencilState;
            this._states[StatePosition.DepthStencilState] = this._depthStencilState;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.DepthStencilState);
        }
    }
    _setVertexState(effect) {
        var _a, _b;
        const currStateLen = this._statesLength;
        let newNumStates = StatePosition.VertexState;
        const webgpuPipelineContext = effect._pipelineContext;
        const attributes = webgpuPipelineContext.shaderProcessingContext.attributeNamesFromEffect;
        const locations = webgpuPipelineContext.shaderProcessingContext.attributeLocationsFromEffect;
        let currentGPUBuffer;
        let numVertexBuffers = 0;
        for (var index = 0; index < attributes.length; index++) {
            const location = locations[index];
            let vertexBuffer = (_a = (this._overrideVertexBuffers && this._overrideVertexBuffers[attributes[index]])) !== null && _a !== void 0 ? _a : this._vertexBuffers[attributes[index]];
            if (!vertexBuffer) {
                // In WebGL it's valid to not bind a vertex buffer to an attribute, but it's not valid in WebGPU
                // So we must bind a dummy buffer when we are not given one for a specific attribute
                vertexBuffer = this._emptyVertexBuffer;
            }
            const buffer = (_b = vertexBuffer.getBuffer()) === null || _b === void 0 ? void 0 : _b.underlyingResource;
            // We optimize usage of GPUVertexBufferLayout: we will create a single GPUVertexBufferLayout for all the attributes which follow each other and which use the same GPU buffer
            // However, there are some constraints in the attribute.offset value range, so we must check for them before being able to reuse the same GPUVertexBufferLayout
            // See _getVertexInputDescriptor() below
            if (vertexBuffer._validOffsetRange === undefined) {
                const offset = vertexBuffer.byteOffset;
                const formatSize = vertexBuffer.getSize(true);
                const byteStride = vertexBuffer.byteStride;
                vertexBuffer._validOffsetRange = offset <= (this._kMaxVertexBufferStride - formatSize) && (byteStride === 0 || (offset + formatSize) <= byteStride);
            }
            if (!(currentGPUBuffer && currentGPUBuffer === buffer && vertexBuffer._validOffsetRange)) {
                // we can't combine the previous vertexBuffer with the current one
                this.vertexBuffers[numVertexBuffers++] = vertexBuffer;
                currentGPUBuffer = vertexBuffer._validOffsetRange ? buffer : null;
            }
            const vid = vertexBuffer.hashCode + (location << 7);
            this._isDirty = this._isDirty || this._states[newNumStates] !== vid;
            this._states[newNumStates++] = vid;
        }
        this.vertexBuffers.length = numVertexBuffers;
        this._statesLength = newNumStates;
        this._isDirty = this._isDirty || newNumStates !== currStateLen;
        if (this._isDirty) {
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.VertexState);
        }
    }
    _setTextureState(textureState) {
        if (this._textureState !== textureState) {
            this._textureState = textureState;
            this._states[StatePosition.TextureStage] = this._textureState;
            this._isDirty = true;
            this._stateDirtyLowestIndex = Math.min(this._stateDirtyLowestIndex, StatePosition.TextureStage);
        }
    }
    _createPipelineLayout(webgpuPipelineContext) {
        if (this._useTextureStage) {
            return this._createPipelineLayoutWithTextureStage(webgpuPipelineContext);
        }
        const bindGroupLayouts = [];
        const bindGroupLayoutEntries = webgpuPipelineContext.shaderProcessingContext.bindGroupLayoutEntries;
        for (let i = 0; i < bindGroupLayoutEntries.length; i++) {
            const setDefinition = bindGroupLayoutEntries[i];
            bindGroupLayouts[i] = this._device.createBindGroupLayout({
                entries: setDefinition,
            });
        }
        webgpuPipelineContext.bindGroupLayouts = bindGroupLayouts;
        return this._device.createPipelineLayout({ bindGroupLayouts });
    }
    _createPipelineLayoutWithTextureStage(webgpuPipelineContext) {
        var _a;
        const shaderProcessingContext = webgpuPipelineContext.shaderProcessingContext;
        const bindGroupLayoutEntries = shaderProcessingContext.bindGroupLayoutEntries;
        let bitVal = 1;
        for (let i = 0; i < bindGroupLayoutEntries.length; i++) {
            const setDefinition = bindGroupLayoutEntries[i];
            for (let j = 0; j < setDefinition.length; j++) {
                const entry = bindGroupLayoutEntries[i][j];
                if (entry.texture) {
                    const name = shaderProcessingContext.bindGroupLayoutEntryInfo[i][entry.binding].name;
                    const textureInfo = shaderProcessingContext.availableTextures[name];
                    const samplerInfo = textureInfo.autoBindSampler ? shaderProcessingContext.availableSamplers[name + WebGPUShaderProcessor.AutoSamplerSuffix] : null;
                    let sampleType = textureInfo.sampleType;
                    let samplerType = (_a = samplerInfo === null || samplerInfo === void 0 ? void 0 : samplerInfo.type) !== null && _a !== void 0 ? _a : SamplerBindingType.Filtering;
                    if ((this._textureState & bitVal) && sampleType !== TextureSampleType.Depth) {
                        // The texture is a 32 bits float texture but the system does not support linear filtering for them:
                        // we set the sampler to "non-filtering" and the texture sample type to "unfilterable-float"
                        if (textureInfo.autoBindSampler) {
                            samplerType = SamplerBindingType.NonFiltering;
                        }
                        sampleType = TextureSampleType.UnfilterableFloat;
                    }
                    entry.texture.sampleType = sampleType;
                    if (samplerInfo) {
                        const binding = shaderProcessingContext.bindGroupLayoutEntryInfo[samplerInfo.binding.groupIndex][samplerInfo.binding.bindingIndex].index;
                        bindGroupLayoutEntries[samplerInfo.binding.groupIndex][binding].sampler.type = samplerType;
                    }
                    bitVal = bitVal << 1;
                }
            }
        }
        const bindGroupLayouts = [];
        for (let i = 0; i < bindGroupLayoutEntries.length; ++i) {
            bindGroupLayouts[i] = this._device.createBindGroupLayout({
                entries: bindGroupLayoutEntries[i],
            });
        }
        webgpuPipelineContext.bindGroupLayouts = bindGroupLayouts;
        return this._device.createPipelineLayout({ bindGroupLayouts });
    }
    _getVertexInputDescriptor(effect, topology) {
        var _a, _b;
        const descriptors = [];
        const webgpuPipelineContext = effect._pipelineContext;
        const attributes = webgpuPipelineContext.shaderProcessingContext.attributeNamesFromEffect;
        const locations = webgpuPipelineContext.shaderProcessingContext.attributeLocationsFromEffect;
        let currentGPUBuffer;
        let currentGPUAttributes;
        for (var index = 0; index < attributes.length; index++) {
            const location = locations[index];
            let vertexBuffer = (_a = (this._overrideVertexBuffers && this._overrideVertexBuffers[attributes[index]])) !== null && _a !== void 0 ? _a : this._vertexBuffers[attributes[index]];
            if (!vertexBuffer) {
                // In WebGL it's valid to not bind a vertex buffer to an attribute, but it's not valid in WebGPU
                // So we must bind a dummy buffer when we are not given one for a specific attribute
                vertexBuffer = this._emptyVertexBuffer;
            }
            let buffer = (_b = vertexBuffer.getBuffer()) === null || _b === void 0 ? void 0 : _b.underlyingResource;
            // We reuse the same GPUVertexBufferLayout for all attributes that use the same underlying GPU buffer (and for attributes that follow each other in the attributes array)
            let offset = vertexBuffer.byteOffset;
            const invalidOffsetRange = !vertexBuffer._validOffsetRange;
            if (!(currentGPUBuffer && currentGPUAttributes && currentGPUBuffer === buffer) || invalidOffsetRange) {
                const vertexBufferDescriptor = {
                    arrayStride: vertexBuffer.byteStride,
                    stepMode: vertexBuffer.getIsInstanced() ? InputStepMode.Instance : InputStepMode.Vertex,
                    attributes: []
                };
                descriptors.push(vertexBufferDescriptor);
                currentGPUAttributes = vertexBufferDescriptor.attributes;
                if (invalidOffsetRange) {
                    offset = 0; // the offset will be set directly in the setVertexBuffer call
                    buffer = null; // buffer can't be reused
                }
            }
            currentGPUAttributes.push({
                shaderLocation: location,
                offset,
                format: WebGPUCacheRenderPipeline._GetVertexInputDescriptorFormat(vertexBuffer),
            });
            currentGPUBuffer = buffer;
        }
        return descriptors;
    }
    _createRenderPipeline(effect, topology, sampleCount) {
        const webgpuPipelineContext = effect._pipelineContext;
        const inputStateDescriptor = this._getVertexInputDescriptor(effect, topology);
        const pipelineLayout = this._createPipelineLayout(webgpuPipelineContext);
        const colorStates = [];
        const alphaBlend = this._getAphaBlendState();
        const colorBlend = this._getColorBlendState();
        if (this._mrtAttachments1 > 0) {
            for (let i = 0; i < this._mrtFormats.length; ++i) {
                const descr = {
                    format: this._mrtFormats[i],
                    writeMask: this._writeMask,
                };
                if (alphaBlend && colorBlend) {
                    descr.blend = {
                        alpha: alphaBlend,
                        color: colorBlend,
                    };
                }
                colorStates.push(descr);
            }
        }
        else {
            const descr = {
                format: this._webgpuColorFormat[0],
                writeMask: this._writeMask,
            };
            if (alphaBlend && colorBlend) {
                descr.blend = {
                    alpha: alphaBlend,
                    color: colorBlend,
                };
            }
            colorStates.push(descr);
        }
        const stencilFrontBack = {
            compare: WebGPUCacheRenderPipeline._GetCompareFunction(this._stencilEnabled ? this._stencilFrontCompare : 7 /* ALWAYS */),
            depthFailOp: WebGPUCacheRenderPipeline._GetStencilOpFunction(this._stencilEnabled ? this._stencilFrontDepthFailOp : 1 /* KEEP */),
            failOp: WebGPUCacheRenderPipeline._GetStencilOpFunction(this._stencilEnabled ? this._stencilFrontFailOp : 1 /* KEEP */),
            passOp: WebGPUCacheRenderPipeline._GetStencilOpFunction(this._stencilEnabled ? this._stencilFrontPassOp : 1 /* KEEP */)
        };
        let stripIndexFormat = undefined;
        if (topology === PrimitiveTopology.LineStrip || topology === PrimitiveTopology.TriangleStrip) {
            stripIndexFormat = !this._indexBuffer || this._indexBuffer.is32Bits ? IndexFormat.Uint32 : IndexFormat.Uint16;
        }
        return this._device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: webgpuPipelineContext.stages.vertexStage.module,
                entryPoint: webgpuPipelineContext.stages.vertexStage.entryPoint,
                buffers: inputStateDescriptor,
            },
            primitive: {
                topology,
                stripIndexFormat,
                frontFace: this._frontFace === 1 ? FrontFace.CCW : FrontFace.CW,
                cullMode: !this._cullEnabled ? CullMode.None : this._cullFace === 2 ? CullMode.Front : CullMode.Back,
            },
            fragment: !webgpuPipelineContext.stages.fragmentStage ? undefined : {
                module: webgpuPipelineContext.stages.fragmentStage.module,
                entryPoint: webgpuPipelineContext.stages.fragmentStage.entryPoint,
                targets: colorStates,
            },
            multisample: {
                count: sampleCount,
                /*mask,
                alphaToCoverageEnabled,*/
            },
            depthStencil: this._webgpuDepthStencilFormat === undefined ? undefined : {
                depthWriteEnabled: this._depthWriteEnabled,
                depthCompare: this._depthTestEnabled ? WebGPUCacheRenderPipeline._GetCompareFunction(this._depthCompare) : CompareFunction.Always,
                format: this._webgpuDepthStencilFormat,
                stencilFront: stencilFrontBack,
                stencilBack: stencilFrontBack,
                stencilReadMask: this._stencilReadMask,
                stencilWriteMask: this._stencilWriteMask,
                depthBias: this._depthBias,
                depthBiasClamp: this._depthBiasClamp,
                depthBiasSlopeScale: this._depthBiasSlopeScale,
                /*clampDepth*/
            },
        });
    }
}
WebGPUCacheRenderPipeline.NumCacheHitWithoutHash = 0;
WebGPUCacheRenderPipeline.NumCacheHitWithHash = 0;
WebGPUCacheRenderPipeline.NumCacheMiss = 0;
WebGPUCacheRenderPipeline.NumPipelineCreationLastFrame = 0;
WebGPUCacheRenderPipeline._NumPipelineCreationCurrentFrame = 0;

export { WebGPUCacheRenderPipeline };
