import { FilterMode, TextureFormat, PrimitiveTopology, IndexFormat, CompareFunction, TextureUsage, TextureViewDimension, LoadOp, StoreOp, TextureDimension, TextureAspect, BufferUsage } from './webgpuConstants.js';
import { Scalar } from '../../Maths/math.scalar.js';
import { Constants } from '../constants.js';
import { InternalTextureSource } from '../../Materials/Textures/internalTexture.js';
import { WebGPUHardwareTexture } from './webgpuHardwareTexture.js';

// License for the mipmap generation code:
// TODO WEBGPU improve mipmap generation by using compute shaders
// TODO WEBGPU use WGSL instead of GLSL
const mipmapVertexSource = `
    const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
    const vec2 tex[4] = vec2[4](vec2(0.0f, 0.0f), vec2(1.0f, 0.0f), vec2(0.0f, 1.0f), vec2(1.0f, 1.0f));

    layout(location = 0) out vec2 vTex;

    void main() {
        vTex = tex[gl_VertexIndex];
        gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
    }
    `;
const mipmapFragmentSource = `
    layout(set = 0, binding = 0) uniform sampler imgSampler;
    layout(set = 0, binding = 1) uniform texture2D img;

    layout(location = 0) in vec2 vTex;
    layout(location = 0) out vec4 outColor;

    void main() {
        outColor = texture(sampler2D(img, imgSampler), vTex);
    }
    `;
const invertYPreMultiplyAlphaVertexSource = `
    #extension GL_EXT_samplerless_texture_functions : enable

    const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
    const vec2 tex[4] = vec2[4](vec2(0.0f, 0.0f), vec2(1.0f, 0.0f), vec2(0.0f, 1.0f), vec2(1.0f, 1.0f));

    layout(set = 0, binding = 0) uniform texture2D img;

    #ifdef INVERTY
        layout(location = 0) out flat ivec2 vTextureSize;
    #endif

    void main() {
        #ifdef INVERTY
            vTextureSize = textureSize(img, 0);
        #endif
        gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
    }
    `;
const invertYPreMultiplyAlphaFragmentSource = `
    #extension GL_EXT_samplerless_texture_functions : enable

    layout(set = 0, binding = 0) uniform texture2D img;

    #ifdef INVERTY
        layout(location = 0) in flat ivec2 vTextureSize;
    #endif
    layout(location = 0) out vec4 outColor;

    void main() {
    #ifdef INVERTY
        vec4 color = texelFetch(img, ivec2(gl_FragCoord.x, vTextureSize.y - gl_FragCoord.y), 0);
    #else
        vec4 color = texelFetch(img, ivec2(gl_FragCoord.xy), 0);
    #endif
    #ifdef PREMULTIPLYALPHA
        color.rgb *= color.a;
    #endif
        outColor = color;
    }
    `;
const clearVertexSource = `
    const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));

    void main() {
        gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
    }
    `;
const clearFragmentSource = `
    layout(set = 0, binding = 0) uniform Uniforms {
        uniform vec4 color;
    };

    layout(location = 0) out vec4 outColor;

    void main() {
        outColor = color;
    }
    `;
var PipelineType;
(function (PipelineType) {
    PipelineType[PipelineType["MipMap"] = 0] = "MipMap";
    PipelineType[PipelineType["InvertYPremultiplyAlpha"] = 1] = "InvertYPremultiplyAlpha";
    PipelineType[PipelineType["Clear"] = 2] = "Clear";
})(PipelineType || (PipelineType = {}));
const shadersForPipelineType = [
    { vertex: mipmapVertexSource, fragment: mipmapFragmentSource },
    { vertex: invertYPreMultiplyAlphaVertexSource, fragment: invertYPreMultiplyAlphaFragmentSource },
    { vertex: clearVertexSource, fragment: clearFragmentSource },
];
/** @hidden */
class WebGPUTextureHelper {
    //------------------------------------------------------------------------------
    //                         Initialization / Helpers
    //------------------------------------------------------------------------------
    constructor(device, glslang, tintWASM, bufferManager) {
        this._pipelines = {};
        this._compiledShaders = [];
        this._deferredReleaseTextures = [];
        this._device = device;
        this._glslang = glslang;
        this._tintWASM = tintWASM;
        this._bufferManager = bufferManager;
        this._mipmapSampler = device.createSampler({ minFilter: FilterMode.Linear });
        this._getPipeline(TextureFormat.RGBA8Unorm);
    }
    static ComputeNumMipmapLevels(width, height) {
        return Scalar.ILog2(Math.max(width, height)) + 1;
    }
    _getPipeline(format, type = PipelineType.MipMap, params) {
        const index = type === PipelineType.MipMap ? 1 << 0 :
            type === PipelineType.InvertYPremultiplyAlpha ? ((params.invertY ? 1 : 0) << 1) + ((params.premultiplyAlpha ? 1 : 0) << 2) :
                type === PipelineType.Clear ? 1 << 3 : 0;
        if (!this._pipelines[format]) {
            this._pipelines[format] = [];
        }
        let pipelineAndBGL = this._pipelines[format][index];
        if (!pipelineAndBGL) {
            let defines = "#version 450\r\n";
            if (type === PipelineType.InvertYPremultiplyAlpha) {
                if (params.invertY) {
                    defines += "#define INVERTY\r\n";
                }
                if (params.premultiplyAlpha) {
                    defines += "#define PREMULTIPLYALPHA\r\n";
                }
            }
            let modules = this._compiledShaders[index];
            if (!modules) {
                let vertexCode = this._glslang.compileGLSL(defines + shadersForPipelineType[type].vertex, 'vertex');
                let fragmentCode = this._glslang.compileGLSL(defines + shadersForPipelineType[type].fragment, 'fragment');
                if (this._tintWASM) {
                    vertexCode = this._tintWASM.convertSpirV2WGSL(vertexCode);
                    fragmentCode = this._tintWASM.convertSpirV2WGSL(fragmentCode);
                }
                const vertexModule = this._device.createShaderModule({
                    code: vertexCode
                });
                const fragmentModule = this._device.createShaderModule({
                    code: fragmentCode
                });
                modules = this._compiledShaders[index] = [vertexModule, fragmentModule];
            }
            const pipeline = this._device.createRenderPipeline({
                vertex: {
                    module: modules[0],
                    entryPoint: 'main',
                },
                fragment: {
                    module: modules[1],
                    entryPoint: 'main',
                    targets: [{
                            format,
                        }],
                },
                primitive: {
                    topology: PrimitiveTopology.TriangleStrip,
                    stripIndexFormat: IndexFormat.Uint16,
                },
            });
            pipelineAndBGL = this._pipelines[format][index] = [pipeline, pipeline.getBindGroupLayout(0)];
        }
        return pipelineAndBGL;
    }
    static _GetTextureTypeFromFormat(format) {
        switch (format) {
            // One Component = 8 bits
            case TextureFormat.R8Unorm:
            case TextureFormat.R8Snorm:
            case TextureFormat.R8Uint:
            case TextureFormat.R8Sint:
            case TextureFormat.RG8Unorm:
            case TextureFormat.RG8Snorm:
            case TextureFormat.RG8Uint:
            case TextureFormat.RG8Sint:
            case TextureFormat.RGBA8Unorm:
            case TextureFormat.RGBA8UnormSRGB:
            case TextureFormat.RGBA8Snorm:
            case TextureFormat.RGBA8Uint:
            case TextureFormat.RGBA8Sint:
            case TextureFormat.BGRA8Unorm:
            case TextureFormat.BGRA8UnormSRGB:
            case TextureFormat.RGB10A2Unorm: // composite format - let's say it's byte...
            case TextureFormat.RGB9E5UFloat: // composite format - let's say it's byte...
            case TextureFormat.RG11B10UFloat: // composite format - let's say it's byte...
            case TextureFormat.Depth24UnormStencil8: // composite format - let's say it's byte...
            case TextureFormat.Depth32FloatStencil8: // composite format - let's say it's byte...
            case TextureFormat.BC7RGBAUnorm:
            case TextureFormat.BC7RGBAUnormSRGB:
            case TextureFormat.BC6HRGBUFloat:
            case TextureFormat.BC6HRGBFloat:
            case TextureFormat.BC5RGUnorm:
            case TextureFormat.BC5RGSnorm:
            case TextureFormat.BC3RGBAUnorm:
            case TextureFormat.BC3RGBAUnormSRGB:
            case TextureFormat.BC2RGBAUnorm:
            case TextureFormat.BC2RGBAUnormSRGB:
            case TextureFormat.BC4RUnorm:
            case TextureFormat.BC4RSnorm:
            case TextureFormat.BC1RGBAUnorm:
            case TextureFormat.BC1RGBAUnormSRGB:
            case TextureFormat.ETC2RGB8Unorm:
            case TextureFormat.ETC2RGB8UnormSRGB:
            case TextureFormat.ETC2RGB8A1Unorm:
            case TextureFormat.ETC2RGB8A1UnormSRGB:
            case TextureFormat.ETC2RGBA8Unorm:
            case TextureFormat.ETC2RGBA8UnormSRGB:
            case TextureFormat.EACR11Unorm:
            case TextureFormat.EACR11Snorm:
            case TextureFormat.EACRG11Unorm:
            case TextureFormat.EACRG11Snorm:
            case TextureFormat.ASTC4x4Unorm:
            case TextureFormat.ASTC4x4UnormSRGB:
            case TextureFormat.ASTC5x4Unorm:
            case TextureFormat.ASTC5x4UnormSRGB:
            case TextureFormat.ASTC5x5Unorm:
            case TextureFormat.ASTC5x5UnormSRGB:
            case TextureFormat.ASTC6x5Unorm:
            case TextureFormat.ASTC6x5UnormSRGB:
            case TextureFormat.ASTC6x6Unorm:
            case TextureFormat.ASTC6x6UnormSRGB:
            case TextureFormat.ASTC8x5Unorm:
            case TextureFormat.ASTC8x5UnormSRGB:
            case TextureFormat.ASTC8x6Unorm:
            case TextureFormat.ASTC8x6UnormSRGB:
            case TextureFormat.ASTC8x8Unorm:
            case TextureFormat.ASTC8x8UnormSRGB:
            case TextureFormat.ASTC10x5Unorm:
            case TextureFormat.ASTC10x5UnormSRGB:
            case TextureFormat.ASTC10x6Unorm:
            case TextureFormat.ASTC10x6UnormSRGB:
            case TextureFormat.ASTC10x8Unorm:
            case TextureFormat.ASTC10x8UnormSRGB:
            case TextureFormat.ASTC10x10Unorm:
            case TextureFormat.ASTC10x10UnormSRGB:
            case TextureFormat.ASTC12x10Unorm:
            case TextureFormat.ASTC12x10UnormSRGB:
            case TextureFormat.ASTC12x12Unorm:
            case TextureFormat.ASTC12x12UnormSRGB:
                return Constants.TEXTURETYPE_UNSIGNED_BYTE;
            // One component = 16 bits
            case TextureFormat.R16Uint:
            case TextureFormat.R16Sint:
            case TextureFormat.RG16Uint:
            case TextureFormat.RG16Sint:
            case TextureFormat.RGBA16Uint:
            case TextureFormat.RGBA16Sint:
            case TextureFormat.Depth16Unorm:
                return Constants.TEXTURETYPE_UNSIGNED_SHORT;
            case TextureFormat.R16Float:
            case TextureFormat.RG16Float:
            case TextureFormat.RGBA16Float:
                return Constants.TEXTURETYPE_HALF_FLOAT;
            // One component = 32 bits
            case TextureFormat.R32Uint:
            case TextureFormat.R32Sint:
            case TextureFormat.RG32Uint:
            case TextureFormat.RG32Sint:
            case TextureFormat.RGBA32Uint:
            case TextureFormat.RGBA32Sint:
                return Constants.TEXTURETYPE_UNSIGNED_INTEGER;
            case TextureFormat.R32Float:
            case TextureFormat.RG32Float:
            case TextureFormat.RGBA32Float:
            case TextureFormat.Depth32Float:
                return Constants.TEXTURETYPE_FLOAT;
            case TextureFormat.Stencil8:
                throw "No fixed size for Stencil8 format!";
            case TextureFormat.Depth24Plus:
                throw "No fixed size for Depth24Plus format!";
            case TextureFormat.Depth24PlusStencil8:
                throw "No fixed size for Depth24PlusStencil8 format!";
        }
        return Constants.TEXTURETYPE_UNSIGNED_BYTE;
    }
    static _GetBlockInformationFromFormat(format) {
        switch (format) {
            // 8 bits formats
            case TextureFormat.R8Unorm:
            case TextureFormat.R8Snorm:
            case TextureFormat.R8Uint:
            case TextureFormat.R8Sint:
                return { width: 1, height: 1, length: 1 };
            // 16 bits formats
            case TextureFormat.R16Uint:
            case TextureFormat.R16Sint:
            case TextureFormat.R16Float:
            case TextureFormat.RG8Unorm:
            case TextureFormat.RG8Snorm:
            case TextureFormat.RG8Uint:
            case TextureFormat.RG8Sint:
                return { width: 1, height: 1, length: 2 };
            // 32 bits formats
            case TextureFormat.R32Uint:
            case TextureFormat.R32Sint:
            case TextureFormat.R32Float:
            case TextureFormat.RG16Uint:
            case TextureFormat.RG16Sint:
            case TextureFormat.RG16Float:
            case TextureFormat.RGBA8Unorm:
            case TextureFormat.RGBA8UnormSRGB:
            case TextureFormat.RGBA8Snorm:
            case TextureFormat.RGBA8Uint:
            case TextureFormat.RGBA8Sint:
            case TextureFormat.BGRA8Unorm:
            case TextureFormat.BGRA8UnormSRGB:
            case TextureFormat.RGB9E5UFloat:
            case TextureFormat.RGB10A2Unorm:
            case TextureFormat.RG11B10UFloat:
                return { width: 1, height: 1, length: 4 };
            // 64 bits formats
            case TextureFormat.RG32Uint:
            case TextureFormat.RG32Sint:
            case TextureFormat.RG32Float:
            case TextureFormat.RGBA16Uint:
            case TextureFormat.RGBA16Sint:
            case TextureFormat.RGBA16Float:
                return { width: 1, height: 1, length: 8 };
            // 128 bits formats
            case TextureFormat.RGBA32Uint:
            case TextureFormat.RGBA32Sint:
            case TextureFormat.RGBA32Float:
                return { width: 1, height: 1, length: 16 };
            // Depth and stencil formats
            case TextureFormat.Stencil8:
                throw "No fixed size for Stencil8 format!";
            case TextureFormat.Depth16Unorm:
                return { width: 1, height: 1, length: 2 };
            case TextureFormat.Depth24Plus:
                throw "No fixed size for Depth24Plus format!";
            case TextureFormat.Depth24PlusStencil8:
                throw "No fixed size for Depth24PlusStencil8 format!";
            case TextureFormat.Depth32Float:
                return { width: 1, height: 1, length: 4 };
            case TextureFormat.Depth24UnormStencil8:
                return { width: 1, height: 1, length: 4 };
            case TextureFormat.Depth32FloatStencil8:
                return { width: 1, height: 1, length: 5 };
            // BC compressed formats usable if "texture-compression-bc" is both
            // supported by the device/user agent and enabled in requestDevice.
            case TextureFormat.BC7RGBAUnorm:
            case TextureFormat.BC7RGBAUnormSRGB:
            case TextureFormat.BC6HRGBUFloat:
            case TextureFormat.BC6HRGBFloat:
            case TextureFormat.BC5RGUnorm:
            case TextureFormat.BC5RGSnorm:
            case TextureFormat.BC3RGBAUnorm:
            case TextureFormat.BC3RGBAUnormSRGB:
            case TextureFormat.BC2RGBAUnorm:
            case TextureFormat.BC2RGBAUnormSRGB:
                return { width: 4, height: 4, length: 16 };
            case TextureFormat.BC4RUnorm:
            case TextureFormat.BC4RSnorm:
            case TextureFormat.BC1RGBAUnorm:
            case TextureFormat.BC1RGBAUnormSRGB:
                return { width: 4, height: 4, length: 8 };
            // ETC2 compressed formats usable if "texture-compression-etc2" is both
            // supported by the device/user agent and enabled in requestDevice.
            case TextureFormat.ETC2RGB8Unorm:
            case TextureFormat.ETC2RGB8UnormSRGB:
            case TextureFormat.ETC2RGB8A1Unorm:
            case TextureFormat.ETC2RGB8A1UnormSRGB:
            case TextureFormat.EACR11Unorm:
            case TextureFormat.EACR11Snorm:
                return { width: 4, height: 4, length: 8 };
            case TextureFormat.ETC2RGBA8Unorm:
            case TextureFormat.ETC2RGBA8UnormSRGB:
            case TextureFormat.EACRG11Unorm:
            case TextureFormat.EACRG11Snorm:
                return { width: 4, height: 4, length: 16 };
            // ASTC compressed formats usable if "texture-compression-astc" is both
            // supported by the device/user agent and enabled in requestDevice.
            case TextureFormat.ASTC4x4Unorm:
            case TextureFormat.ASTC4x4UnormSRGB:
                return { width: 4, height: 4, length: 16 };
            case TextureFormat.ASTC5x4Unorm:
            case TextureFormat.ASTC5x4UnormSRGB:
                return { width: 5, height: 4, length: 16 };
            case TextureFormat.ASTC5x5Unorm:
            case TextureFormat.ASTC5x5UnormSRGB:
                return { width: 5, height: 5, length: 16 };
            case TextureFormat.ASTC6x5Unorm:
            case TextureFormat.ASTC6x5UnormSRGB:
                return { width: 6, height: 5, length: 16 };
            case TextureFormat.ASTC6x6Unorm:
            case TextureFormat.ASTC6x6UnormSRGB:
                return { width: 6, height: 6, length: 16 };
            case TextureFormat.ASTC8x5Unorm:
            case TextureFormat.ASTC8x5UnormSRGB:
                return { width: 8, height: 5, length: 16 };
            case TextureFormat.ASTC8x6Unorm:
            case TextureFormat.ASTC8x6UnormSRGB:
                return { width: 8, height: 6, length: 16 };
            case TextureFormat.ASTC8x8Unorm:
            case TextureFormat.ASTC8x8UnormSRGB:
                return { width: 8, height: 8, length: 16 };
            case TextureFormat.ASTC10x5Unorm:
            case TextureFormat.ASTC10x5UnormSRGB:
                return { width: 10, height: 5, length: 16 };
            case TextureFormat.ASTC10x6Unorm:
            case TextureFormat.ASTC10x6UnormSRGB:
                return { width: 10, height: 6, length: 16 };
            case TextureFormat.ASTC10x8Unorm:
            case TextureFormat.ASTC10x8UnormSRGB:
                return { width: 10, height: 8, length: 16 };
            case TextureFormat.ASTC10x10Unorm:
            case TextureFormat.ASTC10x10UnormSRGB:
                return { width: 10, height: 10, length: 16 };
            case TextureFormat.ASTC12x10Unorm:
            case TextureFormat.ASTC12x10UnormSRGB:
                return { width: 12, height: 10, length: 16 };
            case TextureFormat.ASTC12x12Unorm:
            case TextureFormat.ASTC12x12UnormSRGB:
                return { width: 12, height: 12, length: 16 };
        }
        return { width: 1, height: 1, length: 4 };
    }
    static _IsHardwareTexture(texture) {
        return !!texture.release;
    }
    static _IsInternalTexture(texture) {
        return !!texture.dispose;
    }
    static GetCompareFunction(compareFunction) {
        switch (compareFunction) {
            case Constants.ALWAYS:
                return CompareFunction.Always;
            case Constants.EQUAL:
                return CompareFunction.Equal;
            case Constants.GREATER:
                return CompareFunction.Greater;
            case Constants.GEQUAL:
                return CompareFunction.GreaterEqual;
            case Constants.LESS:
                return CompareFunction.Less;
            case Constants.LEQUAL:
                return CompareFunction.LessEqual;
            case Constants.NEVER:
                return CompareFunction.Never;
            case Constants.NOTEQUAL:
                return CompareFunction.NotEqual;
            default:
                return CompareFunction.Less;
        }
    }
    static IsImageBitmap(imageBitmap) {
        return imageBitmap.close !== undefined;
    }
    static IsImageBitmapArray(imageBitmap) {
        return Array.isArray(imageBitmap) && imageBitmap[0].close !== undefined;
    }
    setCommandEncoder(encoder) {
        this._commandEncoderForCreation = encoder;
    }
    static IsCompressedFormat(format) {
        switch (format) {
            case TextureFormat.BC7RGBAUnormSRGB:
            case TextureFormat.BC7RGBAUnorm:
            case TextureFormat.BC6HRGBFloat:
            case TextureFormat.BC6HRGBUFloat:
            case TextureFormat.BC5RGSnorm:
            case TextureFormat.BC5RGUnorm:
            case TextureFormat.BC4RSnorm:
            case TextureFormat.BC4RUnorm:
            case TextureFormat.BC3RGBAUnormSRGB:
            case TextureFormat.BC3RGBAUnorm:
            case TextureFormat.BC2RGBAUnormSRGB:
            case TextureFormat.BC2RGBAUnorm:
            case TextureFormat.BC1RGBAUnormSRGB:
            case TextureFormat.BC1RGBAUnorm:
            case TextureFormat.ETC2RGB8Unorm:
            case TextureFormat.ETC2RGB8UnormSRGB:
            case TextureFormat.ETC2RGB8A1Unorm:
            case TextureFormat.ETC2RGB8A1UnormSRGB:
            case TextureFormat.ETC2RGBA8Unorm:
            case TextureFormat.ETC2RGBA8UnormSRGB:
            case TextureFormat.EACR11Unorm:
            case TextureFormat.EACR11Snorm:
            case TextureFormat.EACRG11Unorm:
            case TextureFormat.EACRG11Snorm:
            case TextureFormat.ASTC4x4Unorm:
            case TextureFormat.ASTC4x4UnormSRGB:
            case TextureFormat.ASTC5x4Unorm:
            case TextureFormat.ASTC5x4UnormSRGB:
            case TextureFormat.ASTC5x5Unorm:
            case TextureFormat.ASTC5x5UnormSRGB:
            case TextureFormat.ASTC6x5Unorm:
            case TextureFormat.ASTC6x5UnormSRGB:
            case TextureFormat.ASTC6x6Unorm:
            case TextureFormat.ASTC6x6UnormSRGB:
            case TextureFormat.ASTC8x5Unorm:
            case TextureFormat.ASTC8x5UnormSRGB:
            case TextureFormat.ASTC8x6Unorm:
            case TextureFormat.ASTC8x6UnormSRGB:
            case TextureFormat.ASTC8x8Unorm:
            case TextureFormat.ASTC8x8UnormSRGB:
            case TextureFormat.ASTC10x5Unorm:
            case TextureFormat.ASTC10x5UnormSRGB:
            case TextureFormat.ASTC10x6Unorm:
            case TextureFormat.ASTC10x6UnormSRGB:
            case TextureFormat.ASTC10x8Unorm:
            case TextureFormat.ASTC10x8UnormSRGB:
            case TextureFormat.ASTC10x10Unorm:
            case TextureFormat.ASTC10x10UnormSRGB:
            case TextureFormat.ASTC12x10Unorm:
            case TextureFormat.ASTC12x10UnormSRGB:
            case TextureFormat.ASTC12x12Unorm:
            case TextureFormat.ASTC12x12UnormSRGB:
                return true;
        }
        return false;
    }
    static GetWebGPUTextureFormat(type, format, useSRGBBuffer = false) {
        switch (format) {
            case Constants.TEXTUREFORMAT_DEPTH16:
                return TextureFormat.Depth16Unorm;
            case Constants.TEXTUREFORMAT_DEPTH24_STENCIL8:
                return TextureFormat.Depth24PlusStencil8;
            case Constants.TEXTUREFORMAT_DEPTH32_FLOAT:
                return TextureFormat.Depth32Float;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGBA_BPTC_UNORM:
                return useSRGBBuffer ? TextureFormat.BC7RGBAUnormSRGB : TextureFormat.BC7RGBAUnorm;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT:
                return TextureFormat.BC6HRGBUFloat;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGB_BPTC_SIGNED_FLOAT:
                return TextureFormat.BC6HRGBFloat;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT5:
                return useSRGBBuffer ? TextureFormat.BC3RGBAUnormSRGB : TextureFormat.BC3RGBAUnorm;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT3:
                return useSRGBBuffer ? TextureFormat.BC2RGBAUnormSRGB : TextureFormat.BC2RGBAUnorm;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT1:
            case Constants.TEXTUREFORMAT_COMPRESSED_RGB_S3TC_DXT1:
                return useSRGBBuffer ? TextureFormat.BC1RGBAUnormSRGB : TextureFormat.BC1RGBAUnorm;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGBA_ASTC_4x4:
                return useSRGBBuffer ? TextureFormat.ASTC4x4UnormSRGB : TextureFormat.ASTC4x4Unorm;
            case Constants.TEXTUREFORMAT_COMPRESSED_RGB_ETC1_WEBGL:
                return useSRGBBuffer ? TextureFormat.ETC2RGB8UnormSRGB : TextureFormat.ETC2RGB8Unorm;
        }
        switch (type) {
            case Constants.TEXTURETYPE_BYTE:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED:
                        return TextureFormat.R8Snorm;
                    case Constants.TEXTUREFORMAT_RG:
                        return TextureFormat.RG8Snorm;
                    case Constants.TEXTUREFORMAT_RGB:
                        throw "RGB format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R8Sint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG8Sint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA8Sint;
                    default:
                        return TextureFormat.RGBA8Snorm;
                }
            case Constants.TEXTURETYPE_UNSIGNED_BYTE:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED:
                        return TextureFormat.R8Unorm;
                    case Constants.TEXTUREFORMAT_RG:
                        return TextureFormat.RG8Unorm;
                    case Constants.TEXTUREFORMAT_RGB:
                        throw "TEXTUREFORMAT_RGB format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA:
                        return useSRGBBuffer ? TextureFormat.RGBA8UnormSRGB : TextureFormat.RGBA8Unorm;
                    case Constants.TEXTUREFORMAT_BGRA:
                        return useSRGBBuffer ? TextureFormat.BGRA8UnormSRGB : TextureFormat.BGRA8Unorm;
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R8Uint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG8Uint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA8Uint;
                    case Constants.TEXTUREFORMAT_ALPHA:
                        throw "TEXTUREFORMAT_ALPHA format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_LUMINANCE:
                        throw "TEXTUREFORMAT_LUMINANCE format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_LUMINANCE_ALPHA:
                        throw "TEXTUREFORMAT_LUMINANCE_ALPHA format not supported in WebGPU";
                    default:
                        return TextureFormat.RGBA8Unorm;
                }
            case Constants.TEXTURETYPE_SHORT:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R16Sint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG16Sint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "TEXTUREFORMAT_RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA16Sint;
                    default:
                        return TextureFormat.RGBA16Sint;
                }
            case Constants.TEXTURETYPE_UNSIGNED_SHORT:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R16Uint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG16Uint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "TEXTUREFORMAT_RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA16Uint;
                    default:
                        return TextureFormat.RGBA16Uint;
                }
            case Constants.TEXTURETYPE_INT:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R32Sint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG32Sint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "TEXTUREFORMAT_RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA32Sint;
                    default:
                        return TextureFormat.RGBA32Sint;
                }
            case Constants.TEXTURETYPE_UNSIGNED_INTEGER: // Refers to UNSIGNED_INT
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED_INTEGER:
                        return TextureFormat.R32Uint;
                    case Constants.TEXTUREFORMAT_RG_INTEGER:
                        return TextureFormat.RG32Uint;
                    case Constants.TEXTUREFORMAT_RGB_INTEGER:
                        throw "TEXTUREFORMAT_RGB_INTEGER format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        return TextureFormat.RGBA32Uint;
                    default:
                        return TextureFormat.RGBA32Uint;
                }
            case Constants.TEXTURETYPE_FLOAT:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED:
                        return TextureFormat.R32Float; // By default. Other possibility is R16Float.
                    case Constants.TEXTUREFORMAT_RG:
                        return TextureFormat.RG32Float; // By default. Other possibility is RG16Float.
                    case Constants.TEXTUREFORMAT_RGB:
                        throw "TEXTUREFORMAT_RGB format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA:
                        return TextureFormat.RGBA32Float; // By default. Other possibility is RGBA16Float.
                    default:
                        return TextureFormat.RGBA32Float;
                }
            case Constants.TEXTURETYPE_HALF_FLOAT:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RED:
                        return TextureFormat.R16Float;
                    case Constants.TEXTUREFORMAT_RG:
                        return TextureFormat.RG16Float;
                    case Constants.TEXTUREFORMAT_RGB:
                        throw "TEXTUREFORMAT_RGB format not supported in WebGPU";
                    case Constants.TEXTUREFORMAT_RGBA:
                        return TextureFormat.RGBA16Float;
                    default:
                        return TextureFormat.RGBA16Float;
                }
            case Constants.TEXTURETYPE_UNSIGNED_SHORT_5_6_5:
                throw "TEXTURETYPE_UNSIGNED_SHORT_5_6_5 format not supported in WebGPU";
            case Constants.TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV:
                throw "TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV format not supported in WebGPU";
            case Constants.TEXTURETYPE_UNSIGNED_INT_5_9_9_9_REV:
                throw "TEXTURETYPE_UNSIGNED_INT_5_9_9_9_REV format not supported in WebGPU";
            case Constants.TEXTURETYPE_UNSIGNED_SHORT_4_4_4_4:
                throw "TEXTURETYPE_UNSIGNED_SHORT_4_4_4_4 format not supported in WebGPU";
            case Constants.TEXTURETYPE_UNSIGNED_SHORT_5_5_5_1:
                throw "TEXTURETYPE_UNSIGNED_SHORT_5_5_5_1 format not supported in WebGPU";
            case Constants.TEXTURETYPE_UNSIGNED_INT_2_10_10_10_REV:
                switch (format) {
                    case Constants.TEXTUREFORMAT_RGBA:
                        return TextureFormat.RGB10A2Unorm;
                    case Constants.TEXTUREFORMAT_RGBA_INTEGER:
                        throw "TEXTUREFORMAT_RGBA_INTEGER format not supported in WebGPU when type is TEXTURETYPE_UNSIGNED_INT_2_10_10_10_REV";
                    default:
                        return TextureFormat.RGB10A2Unorm;
                }
        }
        return useSRGBBuffer ? TextureFormat.RGBA8UnormSRGB : TextureFormat.RGBA8Unorm;
    }
    static GetNumChannelsFromWebGPUTextureFormat(format) {
        switch (format) {
            case TextureFormat.R8Unorm:
            case TextureFormat.R8Snorm:
            case TextureFormat.R8Uint:
            case TextureFormat.R8Sint:
            case TextureFormat.BC4RUnorm:
            case TextureFormat.BC4RSnorm:
            case TextureFormat.R16Uint:
            case TextureFormat.R16Sint:
            case TextureFormat.Depth16Unorm:
            case TextureFormat.R16Float:
            case TextureFormat.R32Uint:
            case TextureFormat.R32Sint:
            case TextureFormat.R32Float:
            case TextureFormat.Depth32Float:
            case TextureFormat.Stencil8:
            case TextureFormat.Depth24Plus:
            case TextureFormat.EACR11Unorm:
            case TextureFormat.EACR11Snorm:
                return 1;
            case TextureFormat.RG8Unorm:
            case TextureFormat.RG8Snorm:
            case TextureFormat.RG8Uint:
            case TextureFormat.RG8Sint:
            case TextureFormat.Depth24UnormStencil8: // composite format - let's say it's byte...
            case TextureFormat.Depth32FloatStencil8: // composite format - let's say it's byte...
            case TextureFormat.BC5RGUnorm:
            case TextureFormat.BC5RGSnorm:
            case TextureFormat.RG16Uint:
            case TextureFormat.RG16Sint:
            case TextureFormat.RG16Float:
            case TextureFormat.RG32Uint:
            case TextureFormat.RG32Sint:
            case TextureFormat.RG32Float:
            case TextureFormat.Depth24PlusStencil8:
            case TextureFormat.EACRG11Unorm:
            case TextureFormat.EACRG11Snorm:
                return 2;
            case TextureFormat.RGB9E5UFloat: // composite format - let's say it's byte...
            case TextureFormat.RG11B10UFloat: // composite format - let's say it's byte...
            case TextureFormat.BC6HRGBUFloat:
            case TextureFormat.BC6HRGBFloat:
            case TextureFormat.ETC2RGB8Unorm:
            case TextureFormat.ETC2RGB8UnormSRGB:
                return 3;
            case TextureFormat.RGBA8Unorm:
            case TextureFormat.RGBA8UnormSRGB:
            case TextureFormat.RGBA8Snorm:
            case TextureFormat.RGBA8Uint:
            case TextureFormat.RGBA8Sint:
            case TextureFormat.BGRA8Unorm:
            case TextureFormat.BGRA8UnormSRGB:
            case TextureFormat.RGB10A2Unorm: // composite format - let's say it's byte...
            case TextureFormat.BC7RGBAUnorm:
            case TextureFormat.BC7RGBAUnormSRGB:
            case TextureFormat.BC3RGBAUnorm:
            case TextureFormat.BC3RGBAUnormSRGB:
            case TextureFormat.BC2RGBAUnorm:
            case TextureFormat.BC2RGBAUnormSRGB:
            case TextureFormat.BC1RGBAUnorm:
            case TextureFormat.BC1RGBAUnormSRGB:
            case TextureFormat.RGBA16Uint:
            case TextureFormat.RGBA16Sint:
            case TextureFormat.RGBA16Float:
            case TextureFormat.RGBA32Uint:
            case TextureFormat.RGBA32Sint:
            case TextureFormat.RGBA32Float:
            case TextureFormat.ETC2RGB8A1Unorm:
            case TextureFormat.ETC2RGB8A1UnormSRGB:
            case TextureFormat.ETC2RGBA8Unorm:
            case TextureFormat.ETC2RGBA8UnormSRGB:
            case TextureFormat.ASTC4x4Unorm:
            case TextureFormat.ASTC4x4UnormSRGB:
            case TextureFormat.ASTC5x4Unorm:
            case TextureFormat.ASTC5x4UnormSRGB:
            case TextureFormat.ASTC5x5Unorm:
            case TextureFormat.ASTC5x5UnormSRGB:
            case TextureFormat.ASTC6x5Unorm:
            case TextureFormat.ASTC6x5UnormSRGB:
            case TextureFormat.ASTC6x6Unorm:
            case TextureFormat.ASTC6x6UnormSRGB:
            case TextureFormat.ASTC8x5Unorm:
            case TextureFormat.ASTC8x5UnormSRGB:
            case TextureFormat.ASTC8x6Unorm:
            case TextureFormat.ASTC8x6UnormSRGB:
            case TextureFormat.ASTC8x8Unorm:
            case TextureFormat.ASTC8x8UnormSRGB:
            case TextureFormat.ASTC10x5Unorm:
            case TextureFormat.ASTC10x5UnormSRGB:
            case TextureFormat.ASTC10x6Unorm:
            case TextureFormat.ASTC10x6UnormSRGB:
            case TextureFormat.ASTC10x8Unorm:
            case TextureFormat.ASTC10x8UnormSRGB:
            case TextureFormat.ASTC10x10Unorm:
            case TextureFormat.ASTC10x10UnormSRGB:
            case TextureFormat.ASTC12x10Unorm:
            case TextureFormat.ASTC12x10UnormSRGB:
            case TextureFormat.ASTC12x12Unorm:
            case TextureFormat.ASTC12x12UnormSRGB:
                return 4;
        }
        throw `Unknown format ${format}!`;
    }
    invertYPreMultiplyAlpha(gpuOrHdwTexture, width, height, format, invertY = false, premultiplyAlpha = false, faceIndex = 0, mipLevel = 0, layers = 1, commandEncoder, allowGPUOptimization) {
        var _a, _b, _c, _d, _e, _f, _g;
        const useOwnCommandEncoder = commandEncoder === undefined;
        const [pipeline, bindGroupLayout] = this._getPipeline(format, PipelineType.InvertYPremultiplyAlpha, { invertY, premultiplyAlpha });
        faceIndex = Math.max(faceIndex, 0);
        if (useOwnCommandEncoder) {
            commandEncoder = this._device.createCommandEncoder({});
        }
        (_b = (_a = commandEncoder).pushDebugGroup) === null || _b === void 0 ? void 0 : _b.call(_a, `internal process texture - invertY=${invertY} premultiplyAlpha=${premultiplyAlpha}`);
        let gpuTexture;
        if (WebGPUTextureHelper._IsHardwareTexture(gpuOrHdwTexture)) {
            gpuTexture = gpuOrHdwTexture.underlyingResource;
            if (!(invertY && !premultiplyAlpha && layers === 1 && faceIndex === 0)) {
                // we optimize only for the most likely case (invertY=true, premultiplyAlpha=false, layers=1, faceIndex=0) to avoid dealing with big caches
                gpuOrHdwTexture = undefined;
            }
        }
        else {
            gpuTexture = gpuOrHdwTexture;
            gpuOrHdwTexture = undefined;
        }
        if (!gpuTexture) {
            return;
        }
        const webgpuHardwareTexture = gpuOrHdwTexture;
        const outputTexture = (_c = webgpuHardwareTexture === null || webgpuHardwareTexture === void 0 ? void 0 : webgpuHardwareTexture._copyInvertYTempTexture) !== null && _c !== void 0 ? _c : this.createTexture({ width, height, layers: 1 }, false, false, false, false, false, format, 1, commandEncoder, TextureUsage.CopySrc | TextureUsage.RenderAttachment | TextureUsage.TextureBinding);
        const renderPassDescriptor = (_d = webgpuHardwareTexture === null || webgpuHardwareTexture === void 0 ? void 0 : webgpuHardwareTexture._copyInvertYRenderPassDescr) !== null && _d !== void 0 ? _d : {
            colorAttachments: [{
                    view: outputTexture.createView({
                        format,
                        dimension: TextureViewDimension.E2d,
                        baseMipLevel: 0,
                        mipLevelCount: 1,
                        arrayLayerCount: 1,
                        baseArrayLayer: 0,
                    }),
                    loadValue: LoadOp.Load,
                    storeOp: StoreOp.Store,
                }],
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const bindGroup = (_e = webgpuHardwareTexture === null || webgpuHardwareTexture === void 0 ? void 0 : webgpuHardwareTexture._copyInvertYBindGroupd) !== null && _e !== void 0 ? _e : this._device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{
                    binding: 0,
                    resource: gpuTexture.createView({
                        format,
                        dimension: TextureViewDimension.E2d,
                        baseMipLevel: mipLevel,
                        mipLevelCount: 1,
                        arrayLayerCount: layers,
                        baseArrayLayer: faceIndex,
                    }),
                }],
        });
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(4, 1, 0, 0);
        passEncoder.endPass();
        commandEncoder.copyTextureToTexture({
            texture: outputTexture,
        }, {
            texture: gpuTexture,
            mipLevel,
            origin: {
                x: 0,
                y: 0,
                z: faceIndex,
            }
        }, {
            width,
            height,
            depthOrArrayLayers: 1,
        });
        if (webgpuHardwareTexture) {
            webgpuHardwareTexture._copyInvertYTempTexture = outputTexture;
            webgpuHardwareTexture._copyInvertYRenderPassDescr = renderPassDescriptor;
            webgpuHardwareTexture._copyInvertYBindGroupd = bindGroup;
        }
        else {
            this._deferredReleaseTextures.push([outputTexture, null]);
        }
        (_g = (_f = commandEncoder).popDebugGroup) === null || _g === void 0 ? void 0 : _g.call(_f);
        if (useOwnCommandEncoder) {
            this._device.queue.submit([commandEncoder.finish()]);
            commandEncoder = null;
        }
    }
    copyWithInvertY(srcTextureView, format, renderPassDescriptor, commandEncoder) {
        var _a, _b, _c, _d;
        const useOwnCommandEncoder = commandEncoder === undefined;
        const [pipeline, bindGroupLayout] = this._getPipeline(format, PipelineType.InvertYPremultiplyAlpha, { invertY: true, premultiplyAlpha: false });
        if (useOwnCommandEncoder) {
            commandEncoder = this._device.createCommandEncoder({});
        }
        (_b = (_a = commandEncoder).pushDebugGroup) === null || _b === void 0 ? void 0 : _b.call(_a, `internal copy texture with invertY`);
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const bindGroup = this._device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{
                    binding: 0,
                    resource: srcTextureView,
                }],
        });
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(4, 1, 0, 0);
        passEncoder.endPass();
        (_d = (_c = commandEncoder).popDebugGroup) === null || _d === void 0 ? void 0 : _d.call(_c);
        if (useOwnCommandEncoder) {
            this._device.queue.submit([commandEncoder.finish()]);
            commandEncoder = null;
        }
    }
    //------------------------------------------------------------------------------
    //                               Creation
    //------------------------------------------------------------------------------
    createTexture(imageBitmap, hasMipmaps = false, generateMipmaps = false, invertY = false, premultiplyAlpha = false, is3D = false, format = TextureFormat.RGBA8Unorm, sampleCount = 1, commandEncoder, usage = -1, additionalUsages = 0) {
        const layerCount = imageBitmap.layers || 1;
        let textureSize = {
            width: imageBitmap.width,
            height: imageBitmap.height,
            depthOrArrayLayers: layerCount,
        };
        const isCompressedFormat = WebGPUTextureHelper.IsCompressedFormat(format);
        const mipLevelCount = hasMipmaps ? WebGPUTextureHelper.ComputeNumMipmapLevels(imageBitmap.width, imageBitmap.height) : 1;
        const usages = usage >= 0 ? usage : TextureUsage.CopySrc | TextureUsage.CopyDst | TextureUsage.TextureBinding;
        additionalUsages |= hasMipmaps && !isCompressedFormat ? TextureUsage.CopySrc | TextureUsage.RenderAttachment : 0;
        if (!isCompressedFormat) {
            // we don't know in advance if the texture will be updated with copyImageBitmapToTexture (which requires to have those flags), so we need to force the flags all the times
            additionalUsages |= TextureUsage.RenderAttachment | TextureUsage.CopyDst;
        }
        const gpuTexture = this._device.createTexture({
            size: textureSize,
            dimension: is3D ? TextureDimension.E3d : TextureDimension.E2d,
            format,
            usage: usages | additionalUsages,
            sampleCount,
            mipLevelCount
        });
        if (WebGPUTextureHelper.IsImageBitmap(imageBitmap)) {
            this.updateTexture(imageBitmap, gpuTexture, imageBitmap.width, imageBitmap.height, layerCount, format, 0, 0, invertY, premultiplyAlpha, 0, 0, commandEncoder);
            if (hasMipmaps && generateMipmaps) {
                this.generateMipmaps(gpuTexture, format, mipLevelCount, 0, commandEncoder);
            }
        }
        return gpuTexture;
    }
    createCubeTexture(imageBitmaps, hasMipmaps = false, generateMipmaps = false, invertY = false, premultiplyAlpha = false, format = TextureFormat.RGBA8Unorm, sampleCount = 1, commandEncoder, usage = -1, additionalUsages = 0) {
        const width = WebGPUTextureHelper.IsImageBitmapArray(imageBitmaps) ? imageBitmaps[0].width : imageBitmaps.width;
        const height = WebGPUTextureHelper.IsImageBitmapArray(imageBitmaps) ? imageBitmaps[0].height : imageBitmaps.height;
        const isCompressedFormat = WebGPUTextureHelper.IsCompressedFormat(format);
        const mipLevelCount = hasMipmaps ? WebGPUTextureHelper.ComputeNumMipmapLevels(width, height) : 1;
        const usages = usage >= 0 ? usage : TextureUsage.CopySrc | TextureUsage.CopyDst | TextureUsage.TextureBinding;
        additionalUsages |= hasMipmaps && !isCompressedFormat ? TextureUsage.CopySrc | TextureUsage.RenderAttachment : 0;
        if (!isCompressedFormat) {
            // we don't know in advance if the texture will be updated with copyImageBitmapToTexture (which requires to have those flags), so we need to force the flags all the times
            additionalUsages |= TextureUsage.RenderAttachment | TextureUsage.CopyDst;
        }
        const gpuTexture = this._device.createTexture({
            size: {
                width,
                height,
                depthOrArrayLayers: 6,
            },
            dimension: TextureDimension.E2d,
            format,
            usage: usages | additionalUsages,
            sampleCount,
            mipLevelCount
        });
        if (WebGPUTextureHelper.IsImageBitmapArray(imageBitmaps)) {
            this.updateCubeTextures(imageBitmaps, gpuTexture, width, height, format, invertY, premultiplyAlpha, 0, 0, commandEncoder);
            if (hasMipmaps && generateMipmaps) {
                this.generateCubeMipmaps(gpuTexture, format, mipLevelCount, commandEncoder);
            }
        }
        return gpuTexture;
    }
    generateCubeMipmaps(gpuTexture, format, mipLevelCount, commandEncoder) {
        var _a, _b, _c, _d;
        const useOwnCommandEncoder = commandEncoder === undefined;
        if (useOwnCommandEncoder) {
            commandEncoder = this._device.createCommandEncoder({});
        }
        (_b = (_a = commandEncoder).pushDebugGroup) === null || _b === void 0 ? void 0 : _b.call(_a, `create cube mipmaps - ${mipLevelCount} levels`);
        for (let f = 0; f < 6; ++f) {
            this.generateMipmaps(gpuTexture, format, mipLevelCount, f, commandEncoder);
        }
        (_d = (_c = commandEncoder).popDebugGroup) === null || _d === void 0 ? void 0 : _d.call(_c);
        if (useOwnCommandEncoder) {
            this._device.queue.submit([commandEncoder.finish()]);
            commandEncoder = null;
        }
    }
    generateMipmaps(gpuOrHdwTexture, format, mipLevelCount, faceIndex = 0, commandEncoder) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const useOwnCommandEncoder = commandEncoder === undefined;
        const [pipeline, bindGroupLayout] = this._getPipeline(format);
        faceIndex = Math.max(faceIndex, 0);
        if (useOwnCommandEncoder) {
            commandEncoder = this._device.createCommandEncoder({});
        }
        (_b = (_a = commandEncoder).pushDebugGroup) === null || _b === void 0 ? void 0 : _b.call(_a, `create mipmaps for face #${faceIndex} - ${mipLevelCount} levels`);
        let gpuTexture;
        if (WebGPUTextureHelper._IsHardwareTexture(gpuOrHdwTexture)) {
            gpuTexture = gpuOrHdwTexture.underlyingResource;
            gpuOrHdwTexture._mipmapGenRenderPassDescr = gpuOrHdwTexture._mipmapGenRenderPassDescr || [];
            gpuOrHdwTexture._mipmapGenBindGroup = gpuOrHdwTexture._mipmapGenBindGroup || [];
        }
        else {
            gpuTexture = gpuOrHdwTexture;
            gpuOrHdwTexture = undefined;
        }
        if (!gpuTexture) {
            return;
        }
        const webgpuHardwareTexture = gpuOrHdwTexture;
        for (let i = 1; i < mipLevelCount; ++i) {
            const renderPassDescriptor = (_d = (_c = webgpuHardwareTexture === null || webgpuHardwareTexture === void 0 ? void 0 : webgpuHardwareTexture._mipmapGenRenderPassDescr[faceIndex]) === null || _c === void 0 ? void 0 : _c[i - 1]) !== null && _d !== void 0 ? _d : {
                colorAttachments: [{
                        view: gpuTexture.createView({
                            format,
                            dimension: TextureViewDimension.E2d,
                            baseMipLevel: i,
                            mipLevelCount: 1,
                            arrayLayerCount: 1,
                            baseArrayLayer: faceIndex,
                        }),
                        loadValue: LoadOp.Load,
                        storeOp: StoreOp.Store,
                    }],
            };
            if (webgpuHardwareTexture) {
                webgpuHardwareTexture._mipmapGenRenderPassDescr[faceIndex] = webgpuHardwareTexture._mipmapGenRenderPassDescr[faceIndex] || [];
                webgpuHardwareTexture._mipmapGenRenderPassDescr[faceIndex][i - 1] = renderPassDescriptor;
            }
            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            const bindGroup = (_f = (_e = webgpuHardwareTexture === null || webgpuHardwareTexture === void 0 ? void 0 : webgpuHardwareTexture._mipmapGenBindGroup[faceIndex]) === null || _e === void 0 ? void 0 : _e[i - 1]) !== null && _f !== void 0 ? _f : this._device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{
                        binding: 0,
                        resource: this._mipmapSampler,
                    }, {
                        binding: 1,
                        resource: gpuTexture.createView({
                            format,
                            dimension: TextureViewDimension.E2d,
                            baseMipLevel: i - 1,
                            mipLevelCount: 1,
                            arrayLayerCount: 1,
                            baseArrayLayer: faceIndex,
                        }),
                    }],
            });
            if (webgpuHardwareTexture) {
                webgpuHardwareTexture._mipmapGenBindGroup[faceIndex] = webgpuHardwareTexture._mipmapGenBindGroup[faceIndex] || [];
                webgpuHardwareTexture._mipmapGenBindGroup[faceIndex][i - 1] = bindGroup;
            }
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(4, 1, 0, 0);
            passEncoder.endPass();
        }
        (_h = (_g = commandEncoder).popDebugGroup) === null || _h === void 0 ? void 0 : _h.call(_g);
        if (useOwnCommandEncoder) {
            this._device.queue.submit([commandEncoder.finish()]);
            commandEncoder = null;
        }
    }
    createGPUTextureForInternalTexture(texture, width, height, depth, creationFlags) {
        if (!texture._hardwareTexture) {
            texture._hardwareTexture = new WebGPUHardwareTexture();
        }
        if (width === undefined) {
            width = texture.width;
        }
        if (height === undefined) {
            height = texture.height;
        }
        if (depth === undefined) {
            depth = texture.depth;
        }
        const gpuTextureWrapper = texture._hardwareTexture;
        const isStorageTexture = ((creationFlags !== null && creationFlags !== void 0 ? creationFlags : 0) & Constants.TEXTURE_CREATIONFLAG_STORAGE) !== 0;
        gpuTextureWrapper.format = WebGPUTextureHelper.GetWebGPUTextureFormat(texture.type, texture.format, texture._useSRGBBuffer);
        gpuTextureWrapper.textureUsages =
            texture._source === InternalTextureSource.RenderTarget || texture.source === InternalTextureSource.MultiRenderTarget ? TextureUsage.TextureBinding | TextureUsage.CopySrc | TextureUsage.RenderAttachment :
                texture._source === InternalTextureSource.DepthStencil ? TextureUsage.TextureBinding | TextureUsage.RenderAttachment : -1;
        gpuTextureWrapper.textureAdditionalUsages = isStorageTexture ? TextureUsage.StorageBinding : 0;
        const hasMipMaps = texture.generateMipMaps;
        const layerCount = depth || 1;
        if (texture.isCube) {
            const gpuTexture = this.createCubeTexture({ width, height }, texture.generateMipMaps, texture.generateMipMaps, texture.invertY, false, gpuTextureWrapper.format, 1, this._commandEncoderForCreation, gpuTextureWrapper.textureUsages, gpuTextureWrapper.textureAdditionalUsages);
            gpuTextureWrapper.set(gpuTexture);
            gpuTextureWrapper.createView({
                format: gpuTextureWrapper.format,
                dimension: TextureViewDimension.Cube,
                mipLevelCount: hasMipMaps ? WebGPUTextureHelper.ComputeNumMipmapLevels(width, height) : 1,
                baseArrayLayer: 0,
                baseMipLevel: 0,
                arrayLayerCount: 6,
                aspect: TextureAspect.All
            }, isStorageTexture);
        }
        else {
            const gpuTexture = this.createTexture({ width, height, layers: layerCount }, texture.generateMipMaps, texture.generateMipMaps, texture.invertY, false, texture.is3D, gpuTextureWrapper.format, 1, this._commandEncoderForCreation, gpuTextureWrapper.textureUsages, gpuTextureWrapper.textureAdditionalUsages);
            gpuTextureWrapper.set(gpuTexture);
            gpuTextureWrapper.createView({
                format: gpuTextureWrapper.format,
                dimension: texture.is2DArray ? TextureViewDimension.E2dArray : texture.is3D ? TextureDimension.E3d : TextureViewDimension.E2d,
                mipLevelCount: hasMipMaps ? WebGPUTextureHelper.ComputeNumMipmapLevels(width, height) : 1,
                baseArrayLayer: 0,
                baseMipLevel: 0,
                arrayLayerCount: texture.is3D ? 1 : layerCount,
                aspect: TextureAspect.All
            }, isStorageTexture);
        }
        texture.width = texture.baseWidth = width;
        texture.height = texture.baseHeight = height;
        texture.depth = texture.baseDepth = depth;
        this.createMSAATexture(texture, texture.samples);
        return gpuTextureWrapper;
    }
    createMSAATexture(texture, samples) {
        const gpuTextureWrapper = texture._hardwareTexture;
        if (gpuTextureWrapper === null || gpuTextureWrapper === void 0 ? void 0 : gpuTextureWrapper.msaaTexture) {
            this.releaseTexture(gpuTextureWrapper.msaaTexture);
            gpuTextureWrapper.msaaTexture = null;
        }
        if (!gpuTextureWrapper || (samples !== null && samples !== void 0 ? samples : 1) <= 1) {
            return;
        }
        const width = texture.width;
        const height = texture.height;
        const layerCount = texture.depth || 1;
        if (texture.isCube) {
            const gpuMSAATexture = this.createCubeTexture({ width, height }, false, false, texture.invertY, false, gpuTextureWrapper.format, samples, this._commandEncoderForCreation, gpuTextureWrapper.textureUsages, gpuTextureWrapper.textureAdditionalUsages);
            gpuTextureWrapper.setMSAATexture(gpuMSAATexture);
        }
        else {
            const gpuMSAATexture = this.createTexture({ width, height, layers: layerCount }, false, false, texture.invertY, false, texture.is3D, gpuTextureWrapper.format, samples, this._commandEncoderForCreation, gpuTextureWrapper.textureUsages, gpuTextureWrapper.textureAdditionalUsages);
            gpuTextureWrapper.setMSAATexture(gpuMSAATexture);
        }
    }
    //------------------------------------------------------------------------------
    //                                  Update
    //------------------------------------------------------------------------------
    updateCubeTextures(imageBitmaps, gpuTexture, width, height, format, invertY = false, premultiplyAlpha = false, offsetX = 0, offsetY = 0, commandEncoder) {
        const faces = [0, 3, 1, 4, 2, 5];
        for (let f = 0; f < faces.length; ++f) {
            let imageBitmap = imageBitmaps[faces[f]];
            this.updateTexture(imageBitmap, gpuTexture, width, height, 1, format, f, 0, invertY, premultiplyAlpha, offsetX, offsetY, commandEncoder);
        }
    }
    // TODO WEBGPU handle data source not being in the same format than the destination texture?
    updateTexture(imageBitmap, texture, width, height, layers, format, faceIndex = 0, mipLevel = 0, invertY = false, premultiplyAlpha = false, offsetX = 0, offsetY = 0, commandEncoder, allowGPUOptimization) {
        const gpuTexture = WebGPUTextureHelper._IsInternalTexture(texture) ? texture._hardwareTexture.underlyingResource : texture;
        const blockInformation = WebGPUTextureHelper._GetBlockInformationFromFormat(format);
        const gpuOrHdwTexture = WebGPUTextureHelper._IsInternalTexture(texture) ? texture._hardwareTexture : texture;
        const textureCopyView = {
            texture: gpuTexture,
            origin: {
                x: offsetX,
                y: offsetY,
                z: Math.max(faceIndex, 0)
            },
            mipLevel: mipLevel,
            premultipliedAlpha: premultiplyAlpha,
        };
        const textureExtent = {
            width: Math.ceil(width / blockInformation.width) * blockInformation.width,
            height: Math.ceil(height / blockInformation.height) * blockInformation.height,
            depthOrArrayLayers: layers || 1
        };
        if (imageBitmap.byteLength !== undefined) {
            imageBitmap = imageBitmap;
            const bytesPerRow = Math.ceil(width / blockInformation.width) * blockInformation.length;
            const aligned = Math.ceil(bytesPerRow / 256) * 256 === bytesPerRow;
            if (aligned) {
                const useOwnCommandEncoder = commandEncoder === undefined;
                if (useOwnCommandEncoder) {
                    commandEncoder = this._device.createCommandEncoder({});
                }
                const buffer = this._bufferManager.createRawBuffer(imageBitmap.byteLength, BufferUsage.MapWrite | BufferUsage.CopySrc, true);
                const arrayBuffer = buffer.getMappedRange();
                new Uint8Array(arrayBuffer).set(imageBitmap);
                buffer.unmap();
                commandEncoder.copyBufferToTexture({
                    buffer: buffer,
                    offset: 0,
                    bytesPerRow,
                    rowsPerImage: height,
                }, textureCopyView, textureExtent);
                if (useOwnCommandEncoder) {
                    this._device.queue.submit([commandEncoder.finish()]);
                    commandEncoder = null;
                }
                this._bufferManager.releaseBuffer(buffer);
            }
            else {
                this._device.queue.writeTexture(textureCopyView, imageBitmap, {
                    offset: 0,
                    bytesPerRow,
                    rowsPerImage: height,
                }, textureExtent);
            }
            if (invertY || premultiplyAlpha) {
                this.invertYPreMultiplyAlpha(gpuOrHdwTexture, width, height, format, invertY, premultiplyAlpha, faceIndex, mipLevel, layers || 1, commandEncoder, allowGPUOptimization);
            }
        }
        else {
            imageBitmap = imageBitmap;
            if (invertY) {
                textureCopyView.premultipliedAlpha = false; // we are going to handle premultiplyAlpha ourselves
                // we must preprocess the image
                if (WebGPUTextureHelper._IsInternalTexture(texture) && offsetX === 0 && offsetY === 0 && width === texture.width && height === texture.height) {
                    // optimization when the source image is the same size than the destination texture and offsets X/Y == 0:
                    // we simply copy the source to the destination and we apply the preprocessing on the destination
                    this._device.queue.copyExternalImageToTexture({ source: imageBitmap }, textureCopyView, textureExtent);
                    // note that we have to use a new command encoder and submit it just right away so that the copy (see line above) and the preprocessing render pass happens in the right order!
                    // (to do that, we don't pass to invertYPreMultiplyAlpha the command encoder which is passed to updateTexture, meaning invertYPreMultiplyAlpha will create a temporary one and will submit it right away)
                    // if we don't create a new command encoder, we could end up calling copyExternalImageToTexture / invertYPreMultiplyAlpha / copyExternalImageToTexture / invertYPreMultiplyAlpha in the same frame,
                    // in which case it would be executed as copyExternalImageToTexture / copyExternalImageToTexture / invertYPreMultiplyAlpha / invertYPreMultiplyAlpha because the command encoder we are passed in
                    // is submitted at the end of the frame
                    this.invertYPreMultiplyAlpha(gpuOrHdwTexture, width, height, format, invertY, premultiplyAlpha, faceIndex, mipLevel, layers || 1, undefined, allowGPUOptimization);
                }
                else {
                    // we must apply the preprocessing on the source image before copying it into the destination texture
                    // we don't use the command encoder we are passed in because it will be submitted at the end of the frame: see more explanations in the comments above
                    commandEncoder = this._device.createCommandEncoder({});
                    // create a temp texture and copy the image to it
                    const srcTexture = this.createTexture({ width, height, layers: 1 }, false, false, false, false, false, format, 1, commandEncoder, TextureUsage.CopySrc | TextureUsage.TextureBinding);
                    this._deferredReleaseTextures.push([srcTexture, null]);
                    textureExtent.depthOrArrayLayers = 1;
                    this._device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: srcTexture }, textureExtent);
                    textureExtent.depthOrArrayLayers = layers || 1;
                    // apply the preprocessing to this temp texture
                    this.invertYPreMultiplyAlpha(srcTexture, width, height, format, invertY, premultiplyAlpha, faceIndex, mipLevel, layers || 1, commandEncoder, allowGPUOptimization);
                    // copy the temp texture to the destination texture
                    commandEncoder.copyTextureToTexture({ texture: srcTexture }, textureCopyView, textureExtent);
                    this._device.queue.submit([commandEncoder.finish()]);
                    commandEncoder = null;
                }
            }
            else {
                // no preprocessing: direct copy to destination texture
                this._device.queue.copyExternalImageToTexture({ source: imageBitmap }, textureCopyView, textureExtent);
            }
        }
    }
    readPixels(texture, x, y, width, height, format, faceIndex = 0, mipLevel = 0, buffer = null, noDataConversion = false) {
        const blockInformation = WebGPUTextureHelper._GetBlockInformationFromFormat(format);
        const bytesPerRow = Math.ceil(width / blockInformation.width) * blockInformation.length;
        const bytesPerRowAligned = Math.ceil(bytesPerRow / 256) * 256;
        const size = bytesPerRowAligned * height;
        const gpuBuffer = this._bufferManager.createRawBuffer(size, BufferUsage.MapRead | BufferUsage.CopyDst);
        const commandEncoder = this._device.createCommandEncoder({});
        commandEncoder.copyTextureToBuffer({
            texture,
            mipLevel,
            origin: {
                x,
                y,
                z: Math.max(faceIndex, 0)
            }
        }, {
            buffer: gpuBuffer,
            offset: 0,
            bytesPerRow: bytesPerRowAligned
        }, {
            width,
            height,
            depthOrArrayLayers: 1
        });
        this._device.queue.submit([commandEncoder.finish()]);
        return this._bufferManager.readDataFromBuffer(gpuBuffer, size, width, height, bytesPerRow, bytesPerRowAligned, WebGPUTextureHelper._GetTextureTypeFromFormat(format), 0, buffer, true, noDataConversion);
    }
    //------------------------------------------------------------------------------
    //                              Dispose
    //------------------------------------------------------------------------------
    releaseTexture(texture) {
        if (WebGPUTextureHelper._IsInternalTexture(texture)) {
            const hardwareTexture = texture._hardwareTexture;
            const irradianceTexture = texture._irradianceTexture;
            // We can't destroy the objects just now because they could be used in the current frame - we delay the destroying after the end of the frame
            this._deferredReleaseTextures.push([hardwareTexture, irradianceTexture]);
        }
        else {
            this._deferredReleaseTextures.push([texture, null]);
        }
    }
    destroyDeferredTextures() {
        for (let i = 0; i < this._deferredReleaseTextures.length; ++i) {
            const [hardwareTexture, irradianceTexture] = this._deferredReleaseTextures[i];
            if (hardwareTexture) {
                if (WebGPUTextureHelper._IsHardwareTexture(hardwareTexture)) {
                    hardwareTexture.release();
                }
                else {
                    hardwareTexture.destroy();
                }
            }
            irradianceTexture === null || irradianceTexture === void 0 ? void 0 : irradianceTexture.dispose();
        }
        this._deferredReleaseTextures.length = 0;
    }
}

export { WebGPUTextureHelper };
