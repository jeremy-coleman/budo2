import { ShaderLanguage } from '../../Materials/shaderLanguage.js';
import { BufferBindingType, StorageTextureAccess, ShaderStage, TextureViewDimension } from './webgpuConstants.js';

/** @hidden */
class WebGPUShaderProcessor {
    constructor() {
        this.shaderLanguage = ShaderLanguage.GLSL;
    }
    _addUniformToLeftOverUBO(name, uniformType, preProcessors) {
        let length = 0;
        [name, uniformType, length] = this._getArraySize(name, uniformType, preProcessors);
        for (let i = 0; i < this.webgpuProcessingContext.leftOverUniforms.length; i++) {
            if (this.webgpuProcessingContext.leftOverUniforms[i].name === name) {
                return;
            }
        }
        this.webgpuProcessingContext.leftOverUniforms.push({
            name,
            type: uniformType,
            length
        });
    }
    _buildLeftOverUBO() {
        if (!this.webgpuProcessingContext.leftOverUniforms.length) {
            return "";
        }
        const name = WebGPUShaderProcessor.LeftOvertUBOName;
        let availableUBO = this.webgpuProcessingContext.availableBuffers[name];
        if (!availableUBO) {
            availableUBO = {
                binding: this.webgpuProcessingContext.getNextFreeUBOBinding(),
            };
            this.webgpuProcessingContext.availableBuffers[name] = availableUBO;
            this._addBufferBindingDescription(name, availableUBO, BufferBindingType.Uniform, true);
            this._addBufferBindingDescription(name, availableUBO, BufferBindingType.Uniform, false);
        }
        return this._generateLeftOverUBOCode(name, availableUBO);
    }
    _collectBindingNames() {
        // collect all the binding names for faster processing in WebGPUCacheBindGroup
        for (let i = 0; i < this.webgpuProcessingContext.bindGroupLayoutEntries.length; i++) {
            const setDefinition = this.webgpuProcessingContext.bindGroupLayoutEntries[i];
            if (setDefinition === undefined) {
                this.webgpuProcessingContext.bindGroupLayoutEntries[i] = [];
                continue;
            }
            for (let j = 0; j < setDefinition.length; j++) {
                const entry = this.webgpuProcessingContext.bindGroupLayoutEntries[i][j];
                const name = this.webgpuProcessingContext.bindGroupLayoutEntryInfo[i][entry.binding].name;
                const nameInArrayOfTexture = this.webgpuProcessingContext.bindGroupLayoutEntryInfo[i][entry.binding].nameInArrayOfTexture;
                if (entry) {
                    if (entry.texture || entry.externalTexture || entry.storageTexture) {
                        this.webgpuProcessingContext.textureNames.push(nameInArrayOfTexture);
                    }
                    else if (entry.sampler) {
                        this.webgpuProcessingContext.samplerNames.push(name);
                    }
                    else if (entry.buffer) {
                        this.webgpuProcessingContext.bufferNames.push(name);
                    }
                }
            }
        }
    }
    _preCreateBindGroupEntries() {
        const bindGroupEntries = this.webgpuProcessingContext.bindGroupEntries;
        for (let i = 0; i < this.webgpuProcessingContext.bindGroupLayoutEntries.length; i++) {
            const setDefinition = this.webgpuProcessingContext.bindGroupLayoutEntries[i];
            const entries = [];
            for (let j = 0; j < setDefinition.length; j++) {
                const entry = this.webgpuProcessingContext.bindGroupLayoutEntries[i][j];
                if (entry.sampler || entry.texture || entry.storageTexture || entry.externalTexture) {
                    entries.push({
                        binding: entry.binding,
                        resource: undefined,
                    });
                }
                else if (entry.buffer) {
                    entries.push({
                        binding: entry.binding,
                        resource: {
                            buffer: undefined,
                            offset: 0,
                            size: 0,
                        },
                    });
                }
            }
            bindGroupEntries[i] = entries;
        }
    }
    _addTextureBindingDescription(name, textureInfo, textureIndex, dimension, format, isVertex) {
        let { groupIndex, bindingIndex } = textureInfo.textures[textureIndex];
        if (!this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex]) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex] = [];
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex] = [];
        }
        if (!this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex]) {
            let len;
            if (dimension === null) {
                len = this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex].push({
                    binding: bindingIndex,
                    visibility: 0,
                    externalTexture: {},
                });
            }
            else if (format) {
                len = this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex].push({
                    binding: bindingIndex,
                    visibility: 0,
                    storageTexture: {
                        access: StorageTextureAccess.WriteOnly,
                        format,
                        viewDimension: dimension,
                    },
                });
            }
            else {
                len = this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex].push({
                    binding: bindingIndex,
                    visibility: 0,
                    texture: {
                        sampleType: textureInfo.sampleType,
                        viewDimension: dimension,
                        multisampled: false,
                    },
                });
            }
            const textureName = textureInfo.isTextureArray ? name + textureIndex : name;
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex] = { name, index: len - 1, nameInArrayOfTexture: textureName };
        }
        bindingIndex = this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex].index;
        if (isVertex) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Vertex;
        }
        else {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Fragment;
        }
    }
    _addSamplerBindingDescription(name, samplerInfo, isVertex) {
        let { groupIndex, bindingIndex } = samplerInfo.binding;
        if (!this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex]) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex] = [];
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex] = [];
        }
        if (!this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex]) {
            const len = this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex].push({
                binding: bindingIndex,
                visibility: 0,
                sampler: {
                    type: samplerInfo.type,
                },
            });
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex] = { name, index: len - 1 };
        }
        bindingIndex = this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex].index;
        if (isVertex) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Vertex;
        }
        else {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Fragment;
        }
    }
    _addBufferBindingDescription(name, uniformBufferInfo, bufferType, isVertex) {
        let { groupIndex, bindingIndex } = uniformBufferInfo.binding;
        if (!this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex]) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex] = [];
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex] = [];
        }
        if (!this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex]) {
            const len = this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex].push({
                binding: bindingIndex,
                visibility: 0,
                buffer: {
                    type: bufferType,
                },
            });
            this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex] = { name, index: len - 1 };
        }
        bindingIndex = this.webgpuProcessingContext.bindGroupLayoutEntryInfo[groupIndex][bindingIndex].index;
        if (isVertex) {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Vertex;
        }
        else {
            this.webgpuProcessingContext.bindGroupLayoutEntries[groupIndex][bindingIndex].visibility |= ShaderStage.Fragment;
        }
    }
    _injectStartingAndEndingCode(code, mainFuncDecl, startingCode, endingCode) {
        if (startingCode) {
            let idx = code.indexOf(mainFuncDecl);
            if (idx >= 0) {
                while (idx++ < code.length && code.charAt(idx) != '{') { }
                if (idx < code.length) {
                    while (idx++ < code.length && code.charAt(idx) != '\n') { }
                    if (idx < code.length) {
                        const part1 = code.substring(0, idx + 1);
                        const part2 = code.substring(idx + 1);
                        code = part1 + startingCode + part2;
                    }
                }
            }
        }
        if (endingCode) {
            const lastClosingCurly = code.lastIndexOf("}");
            code = code.substring(0, lastClosingCurly);
            code += endingCode + "\n}";
        }
        return code;
    }
}
WebGPUShaderProcessor.AutoSamplerSuffix = "Sampler";
WebGPUShaderProcessor.LeftOvertUBOName = "LeftOver";
WebGPUShaderProcessor.InternalsUBOName = "Internals";
WebGPUShaderProcessor.UniformSizes = {
    // GLSL types
    "bool": 1,
    "int": 1,
    "float": 1,
    "vec2": 2,
    "ivec2": 2,
    "vec3": 3,
    "ivec3": 3,
    "vec4": 4,
    "ivec4": 4,
    "mat2": 4,
    "mat3": 12,
    "mat4": 16,
    // WGSL types
    "i32": 1,
    "u32": 1,
    "f32": 1,
    "mat2x2": 4,
    "mat3x3": 12,
    "mat4x4": 16
};
WebGPUShaderProcessor._SamplerFunctionByWebGLSamplerType = {
    "sampler2D": "sampler2D",
    "sampler2DArray": "sampler2DArray",
    "sampler2DShadow": "sampler2DShadow",
    "sampler2DArrayShadow": "sampler2DArrayShadow",
    "samplerCube": "samplerCube",
    "sampler3D": "sampler3D",
};
WebGPUShaderProcessor._TextureTypeByWebGLSamplerType = {
    "sampler2D": "texture2D",
    "sampler2DArray": "texture2DArray",
    "sampler2DShadow": "texture2D",
    "sampler2DArrayShadow": "texture2DArray",
    "samplerCube": "textureCube",
    "samplerCubeArray": "textureCubeArray",
    "sampler3D": "texture3D",
};
WebGPUShaderProcessor._GpuTextureViewDimensionByWebGPUTextureType = {
    "textureCube": TextureViewDimension.Cube,
    "textureCubeArray": TextureViewDimension.CubeArray,
    "texture2D": TextureViewDimension.E2d,
    "texture2DArray": TextureViewDimension.E2dArray,
    "texture3D": TextureViewDimension.E3d,
};
// if the webgl sampler type is not listed in this array, "sampler" is taken by default
WebGPUShaderProcessor._SamplerTypeByWebGLSamplerType = {
    "sampler2DShadow": "samplerShadow",
    "sampler2DArrayShadow": "samplerShadow",
};
WebGPUShaderProcessor._IsComparisonSamplerByWebGPUSamplerType = {
    "samplerShadow": true,
    "samplerArrayShadow": true,
    "sampler": false,
};

export { WebGPUShaderProcessor };
