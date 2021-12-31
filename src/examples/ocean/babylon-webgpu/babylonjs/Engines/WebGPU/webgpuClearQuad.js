import { Constants } from '../constants.js';
import { WebGPUCacheRenderPipelineTree } from './webgpuCacheRenderPipelineTree.js';
import { WebGPUShaderProcessingContext } from './webgpuShaderProcessingContext.js';

/** @hidden */
class WebGPUClearQuad {
    constructor(device, engine, emptyVertexBuffer) {
        this._bindGroups = {};
        this._bundleCache = {};
        this._device = device;
        this._engine = engine;
        this._cacheRenderPipeline = new WebGPUCacheRenderPipelineTree(this._device, emptyVertexBuffer, !engine._caps.textureFloatLinearFiltering);
        this._cacheRenderPipeline.setDepthTestEnabled(false);
        this._cacheRenderPipeline.setStencilReadMask(0xFF);
        this._effect = engine.createEffect("clearQuad", [], ["color", "depthValue"]);
    }
    setDepthStencilFormat(format) {
        this._depthTextureFormat = format;
        this._cacheRenderPipeline.setDepthStencilFormat(format);
    }
    setColorFormat(format) {
        this._cacheRenderPipeline.setColorFormat(format);
    }
    setMRTAttachments(attachments, textureArray) {
        this._cacheRenderPipeline.setMRTAttachments(attachments, textureArray);
    }
    clear(renderPass, clearColor, clearDepth, clearStencil, sampleCount = 1) {
        let renderPass2;
        let bundle = null;
        let bundleKey = 0;
        const isRTTPass = !!this._engine._currentRenderTarget;
        if (renderPass) {
            renderPass2 = renderPass;
        }
        else {
            bundleKey = (clearColor ? clearColor.r + clearColor.g * 256 + clearColor.b * 256 * 256 + clearColor.a * 256 * 256 * 256 : 0) +
                (clearDepth ? 2 ** 32 : 0) +
                (clearStencil ? 2 ** 33 : 0) +
                (this._engine.useReverseDepthBuffer ? 2 ** 34 : 0) +
                (isRTTPass ? 2 ** 35 : 0) +
                sampleCount * (2 ** 36);
            bundle = this._bundleCache[bundleKey];
            if (bundle) {
                return bundle;
            }
            renderPass2 = this._device.createRenderBundleEncoder({
                colorFormats: this._cacheRenderPipeline.colorFormats,
                depthStencilFormat: this._depthTextureFormat,
                sampleCount,
            });
        }
        this._cacheRenderPipeline.setDepthWriteEnabled(!!clearDepth);
        this._cacheRenderPipeline.setStencilEnabled(!!clearStencil);
        this._cacheRenderPipeline.setStencilWriteMask(clearStencil ? 0xFF : 0);
        this._cacheRenderPipeline.setStencilCompare(clearStencil ? Constants.ALWAYS : Constants.NEVER);
        this._cacheRenderPipeline.setStencilPassOp(clearStencil ? Constants.REPLACE : Constants.KEEP);
        this._cacheRenderPipeline.setWriteMask(clearColor ? 0xF : 0);
        const pipeline = this._cacheRenderPipeline.getRenderPipeline(Constants.MATERIAL_TriangleStripDrawMode, this._effect, sampleCount);
        const webgpuPipelineContext = this._effect._pipelineContext;
        if (clearColor) {
            this._effect.setDirectColor4("color", clearColor);
        }
        this._effect.setFloat("depthValue", this._engine.useReverseDepthBuffer ? this._engine._clearReverseDepthValue : this._engine._clearDepthValue);
        webgpuPipelineContext.uniformBuffer.update();
        const bufferInternals = isRTTPass ? this._engine._ubInvertY : this._engine._ubDontInvertY;
        const bufferLeftOver = webgpuPipelineContext.uniformBuffer.getBuffer();
        const key = bufferLeftOver.uniqueId + "-" + bufferInternals.uniqueId;
        let bindGroups = this._bindGroups[key];
        if (!bindGroups) {
            const bindGroupLayouts = webgpuPipelineContext.bindGroupLayouts;
            bindGroups = this._bindGroups[key] = [];
            bindGroups.push(this._device.createBindGroup({
                layout: bindGroupLayouts[0],
                entries: []
            }));
            if (!WebGPUShaderProcessingContext._SimplifiedKnownBindings) {
                bindGroups.push(this._device.createBindGroup({
                    layout: bindGroupLayouts[1],
                    entries: []
                }));
            }
            bindGroups.push(this._device.createBindGroup({
                layout: bindGroupLayouts[WebGPUShaderProcessingContext._SimplifiedKnownBindings ? 1 : 2],
                entries: [{
                        binding: 0,
                        resource: {
                            buffer: bufferInternals.underlyingResource,
                            size: bufferInternals.capacity
                        },
                    }, {
                        binding: 1,
                        resource: {
                            buffer: bufferLeftOver.underlyingResource,
                            size: bufferLeftOver.capacity
                        },
                    }],
            }));
        }
        renderPass2.setPipeline(pipeline);
        for (let i = 0; i < bindGroups.length; ++i) {
            renderPass2.setBindGroup(i, bindGroups[i]);
        }
        renderPass2.draw(4, 1, 0, 0);
        if (!renderPass) {
            bundle = renderPass2.finish();
            this._bundleCache[bundleKey] = bundle;
        }
        return bundle;
    }
}

export { WebGPUClearQuad };
