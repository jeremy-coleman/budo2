import { IsWindowObjectExist } from '../../Misc/domManagement.js';
import { Tools } from '../../Misc/tools.js';

/** @hidden */
class WebGPUTintWASM {
    constructor() {
        this._twgsl = null;
    }
    async initTwgsl(twgslOptions) {
        twgslOptions = twgslOptions || {};
        twgslOptions = {
            ...WebGPUTintWASM._twgslDefaultOptions,
            ...twgslOptions
        };
        if (twgslOptions.twgsl) {
            this._twgsl = twgslOptions.twgsl;
            return Promise.resolve();
        }
        if (twgslOptions.jsPath && twgslOptions.wasmPath) {
            if (IsWindowObjectExist()) {
                await Tools.LoadScriptAsync(twgslOptions.jsPath);
            }
            else {
                importScripts(twgslOptions.jsPath);
            }
        }
        if (self.twgsl) {
            this._twgsl = await self.twgsl(twgslOptions.wasmPath);
            return Promise.resolve();
        }
        return Promise.reject("twgsl is not available.");
    }
    convertSpirV2WGSL(code) {
        return this._twgsl.convertSpirV2WGSL(code);
    }
}
// Default twgsl options.
WebGPUTintWASM._twgslDefaultOptions = {
    jsPath: "https://preview.babylonjs.com/twgsl/twgsl.js",
    wasmPath: "https://preview.babylonjs.com/twgsl/twgsl.wasm",
};

export { WebGPUTintWASM };
