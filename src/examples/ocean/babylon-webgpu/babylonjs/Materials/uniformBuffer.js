import { Logger } from '../Misc/logger.js';
import { Tools } from '../Misc/tools.js';

/**
 * Uniform buffer objects.
 *
 * Handles blocks of uniform on the GPU.
 *
 * If WebGL 2 is not available, this class falls back on traditional setUniformXXX calls.
 *
 * For more information, please refer to :
 * https://www.khronos.org/opengl/wiki/Uniform_Buffer_Object
 */
class UniformBuffer {
    /**
     * Instantiates a new Uniform buffer objects.
     *
     * Handles blocks of uniform on the GPU.
     *
     * If WebGL 2 is not available, this class falls back on traditional setUniformXXX calls.
     *
     * For more information, please refer to :
     * @see https://www.khronos.org/opengl/wiki/Uniform_Buffer_Object
     * @param engine Define the engine the buffer is associated with
     * @param data Define the data contained in the buffer
     * @param dynamic Define if the buffer is updatable
     * @param name to assign to the buffer (debugging purpose)
     */
    constructor(engine, data, dynamic, name) {
        // Matrix cache
        this._valueCache = {};
        this._engine = engine;
        this._noUBO = !engine.supportsUniformBuffers;
        this._dynamic = dynamic;
        this._name = name !== null && name !== void 0 ? name : "no-name";
        this._data = data || [];
        this._uniformLocations = {};
        this._uniformSizes = {};
        this._uniformArraySizes = {};
        this._uniformLocationPointer = 0;
        this._needSync = false;
        if (this._engine._features.trackUbosInFrame) {
            this._buffers = [];
            this._bufferIndex = -1;
            this._createBufferOnWrite = false;
            this._currentFrameId = 0;
        }
        if (this._noUBO) {
            this.updateMatrix3x3 = this._updateMatrix3x3ForEffect;
            this.updateMatrix2x2 = this._updateMatrix2x2ForEffect;
            this.updateFloat = this._updateFloatForEffect;
            this.updateFloat2 = this._updateFloat2ForEffect;
            this.updateFloat3 = this._updateFloat3ForEffect;
            this.updateFloat4 = this._updateFloat4ForEffect;
            this.updateFloatArray = this._updateFloatArrayForEffect;
            this.updateArray = this._updateArrayForEffect;
            this.updateIntArray = this._updateIntArrayForEffect;
            this.updateMatrix = this._updateMatrixForEffect;
            this.updateMatrices = this._updateMatricesForEffect;
            this.updateVector3 = this._updateVector3ForEffect;
            this.updateVector4 = this._updateVector4ForEffect;
            this.updateColor3 = this._updateColor3ForEffect;
            this.updateColor4 = this._updateColor4ForEffect;
            this.updateDirectColor4 = this._updateDirectColor4ForEffect;
            this.updateInt = this._updateIntForEffect;
            this.updateInt2 = this._updateInt2ForEffect;
            this.updateInt3 = this._updateInt3ForEffect;
            this.updateInt4 = this._updateInt4ForEffect;
        }
        else {
            this._engine._uniformBuffers.push(this);
            this.updateMatrix3x3 = this._updateMatrix3x3ForUniform;
            this.updateMatrix2x2 = this._updateMatrix2x2ForUniform;
            this.updateFloat = this._updateFloatForUniform;
            this.updateFloat2 = this._updateFloat2ForUniform;
            this.updateFloat3 = this._updateFloat3ForUniform;
            this.updateFloat4 = this._updateFloat4ForUniform;
            this.updateFloatArray = this._updateFloatArrayForUniform;
            this.updateArray = this._updateArrayForUniform;
            this.updateIntArray = this._updateIntArrayForUniform;
            this.updateMatrix = this._updateMatrixForUniform;
            this.updateMatrices = this._updateMatricesForUniform;
            this.updateVector3 = this._updateVector3ForUniform;
            this.updateVector4 = this._updateVector4ForUniform;
            this.updateColor3 = this._updateColor3ForUniform;
            this.updateColor4 = this._updateColor4ForUniform;
            this.updateDirectColor4 = this._updateDirectColor4ForUniform;
            this.updateInt = this._updateIntForUniform;
            this.updateInt2 = this._updateInt2ForUniform;
            this.updateInt3 = this._updateInt3ForUniform;
            this.updateInt4 = this._updateInt4ForUniform;
        }
    }
    /**
     * Indicates if the buffer is using the WebGL2 UBO implementation,
     * or just falling back on setUniformXXX calls.
     */
    get useUbo() {
        return !this._noUBO;
    }
    /**
     * Indicates if the WebGL underlying uniform buffer is in sync
     * with the javascript cache data.
     */
    get isSync() {
        return !this._needSync;
    }
    /**
     * Indicates if the WebGL underlying uniform buffer is dynamic.
     * Also, a dynamic UniformBuffer will disable cache verification and always
     * update the underlying WebGL uniform buffer to the GPU.
     * @returns if Dynamic, otherwise false
     */
    isDynamic() {
        return this._dynamic !== undefined;
    }
    /**
     * The data cache on JS side.
     * @returns the underlying data as a float array
     */
    getData() {
        return this._bufferData;
    }
    /**
     * The underlying WebGL Uniform buffer.
     * @returns the webgl buffer
     */
    getBuffer() {
        return this._buffer;
    }
    /**
     * std140 layout specifies how to align data within an UBO structure.
     * See https://khronos.org/registry/OpenGL/specs/gl/glspec45.core.pdf#page=159
     * for specs.
     */
    _fillAlignment(size) {
        // This code has been simplified because we only use floats, vectors of 1, 2, 3, 4 components
        // and 4x4 matrices
        // TODO : change if other types are used
        var alignment;
        if (size <= 2) {
            alignment = size;
        }
        else {
            alignment = 4;
        }
        if ((this._uniformLocationPointer % alignment) !== 0) {
            var oldPointer = this._uniformLocationPointer;
            this._uniformLocationPointer += alignment - (this._uniformLocationPointer % alignment);
            var diff = this._uniformLocationPointer - oldPointer;
            for (var i = 0; i < diff; i++) {
                this._data.push(0);
            }
        }
    }
    /**
     * Adds an uniform in the buffer.
     * Warning : the subsequents calls of this function must be in the same order as declared in the shader
     * for the layout to be correct !
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param size Data size, or data directly.
     * @param arraySize The number of elements in the array, 0 if not an array.
     */
    addUniform(name, size, arraySize = 0) {
        if (this._noUBO) {
            return;
        }
        if (this._uniformLocations[name] !== undefined) {
            // Already existing uniform
            return;
        }
        // This function must be called in the order of the shader layout !
        // size can be the size of the uniform, or data directly
        var data;
        // std140 FTW...
        if (arraySize > 0) {
            if (size instanceof Array) {
                throw "addUniform should not be use with Array in UBO: " + name;
            }
            this._fillAlignment(4);
            this._uniformArraySizes[name] = { strideSize: size, arraySize };
            if (size == 16) {
                size = size * arraySize;
            }
            else {
                const perElementPadding = 4 - size;
                const totalPadding = perElementPadding * arraySize;
                size = size * arraySize + totalPadding;
            }
            data = [];
            // Fill with zeros
            for (var i = 0; i < size; i++) {
                data.push(0);
            }
        }
        else {
            if (size instanceof Array) {
                data = size;
                size = data.length;
            }
            else {
                size = size;
                data = [];
                // Fill with zeros
                for (var i = 0; i < size; i++) {
                    data.push(0);
                }
            }
            this._fillAlignment(size);
        }
        this._uniformSizes[name] = size;
        this._uniformLocations[name] = this._uniformLocationPointer;
        this._uniformLocationPointer += size;
        for (var i = 0; i < size; i++) {
            this._data.push(data[i]);
        }
        this._needSync = true;
    }
    /**
     * Adds a Matrix 4x4 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param mat A 4x4 matrix.
     */
    addMatrix(name, mat) {
        this.addUniform(name, Array.prototype.slice.call(mat.toArray()));
    }
    /**
     * Adds a vec2 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param x Define the x component value of the vec2
     * @param y Define the y component value of the vec2
     */
    addFloat2(name, x, y) {
        var temp = [x, y];
        this.addUniform(name, temp);
    }
    /**
     * Adds a vec3 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param x Define the x component value of the vec3
     * @param y Define the y component value of the vec3
     * @param z Define the z component value of the vec3
     */
    addFloat3(name, x, y, z) {
        var temp = [x, y, z];
        this.addUniform(name, temp);
    }
    /**
     * Adds a vec3 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param color Define the vec3 from a Color
     */
    addColor3(name, color) {
        var temp = [color.r, color.g, color.b];
        this.addUniform(name, temp);
    }
    /**
     * Adds a vec4 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param color Define the rgb components from a Color
     * @param alpha Define the a component of the vec4
     */
    addColor4(name, color, alpha) {
        var temp = [color.r, color.g, color.b, alpha];
        this.addUniform(name, temp);
    }
    /**
     * Adds a vec3 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     * @param vector Define the vec3 components from a Vector
     */
    addVector3(name, vector) {
        var temp = [vector.x, vector.y, vector.z];
        this.addUniform(name, temp);
    }
    /**
     * Adds a Matrix 3x3 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     */
    addMatrix3x3(name) {
        this.addUniform(name, 12);
    }
    /**
     * Adds a Matrix 2x2 to the uniform buffer.
     * @param name Name of the uniform, as used in the uniform block in the shader.
     */
    addMatrix2x2(name) {
        this.addUniform(name, 8);
    }
    /**
     * Effectively creates the WebGL Uniform Buffer, once layout is completed with `addUniform`.
     */
    create() {
        if (this._noUBO) {
            return;
        }
        if (this._buffer) {
            return; // nothing to do
        }
        // See spec, alignment must be filled as a vec4
        this._fillAlignment(4);
        this._bufferData = new Float32Array(this._data);
        this._rebuild();
        this._needSync = true;
    }
    /** @hidden */
    _rebuild() {
        if (this._noUBO || !this._bufferData) {
            return;
        }
        if (this._dynamic) {
            this._buffer = this._engine.createDynamicUniformBuffer(this._bufferData);
        }
        else {
            this._buffer = this._engine.createUniformBuffer(this._bufferData);
        }
        if (this._engine._features.trackUbosInFrame) {
            this._buffers.push([this._buffer, this._engine._features.checkUbosContentBeforeUpload ? this._bufferData.slice() : undefined]);
            this._bufferIndex = this._buffers.length - 1;
            this._createBufferOnWrite = false;
        }
    }
    /** @hidden */
    get _numBuffers() {
        return this._buffers.length;
    }
    /** @hidden */
    get _indexBuffer() {
        return this._bufferIndex;
    }
    /** Gets the name of this buffer */
    get name() {
        return this._name;
    }
    _buffersEqual(buf1, buf2) {
        for (let i = 0; i < buf1.length; ++i) {
            if (buf1[i] !== buf2[i]) {
                return false;
            }
        }
        return true;
    }
    _copyBuffer(src, dst) {
        for (let i = 0; i < src.length; ++i) {
            dst[i] = src[i];
        }
    }
    /**
     * Updates the WebGL Uniform Buffer on the GPU.
     * If the `dynamic` flag is set to true, no cache comparison is done.
     * Otherwise, the buffer will be updated only if the cache differs.
     */
    update() {
        this.bindUniformBuffer();
        if (!this._buffer) {
            this.create();
            return;
        }
        if (!this._dynamic && !this._needSync) {
            this._createBufferOnWrite = this._engine._features.trackUbosInFrame;
            return;
        }
        if (this._buffers && this._buffers.length > 1 && this._buffers[this._bufferIndex][1]) {
            if (this._buffersEqual(this._bufferData, this._buffers[this._bufferIndex][1])) {
                this._needSync = false;
                this._createBufferOnWrite = this._engine._features.trackUbosInFrame;
                return;
            }
            else {
                this._copyBuffer(this._bufferData, this._buffers[this._bufferIndex][1]);
            }
        }
        this._engine.updateUniformBuffer(this._buffer, this._bufferData);
        if (this._engine._features._collectUbosUpdatedInFrame) {
            if (!UniformBuffer._updatedUbosInFrame[this._name]) {
                UniformBuffer._updatedUbosInFrame[this._name] = 0;
            }
            UniformBuffer._updatedUbosInFrame[this._name]++;
        }
        this._needSync = false;
        this._createBufferOnWrite = this._engine._features.trackUbosInFrame;
    }
    _createNewBuffer() {
        if (this._bufferIndex + 1 < this._buffers.length) {
            this._bufferIndex++;
            this._buffer = this._buffers[this._bufferIndex][0];
            this._createBufferOnWrite = false;
            this._needSync = true;
        }
        else {
            this._rebuild();
        }
    }
    _checkNewFrame() {
        if (this._engine._features.trackUbosInFrame && this._currentFrameId !== this._engine.frameId) {
            this._currentFrameId = this._engine.frameId;
            this._createBufferOnWrite = false;
            if (this._buffers && this._buffers.length > 0) {
                this._needSync = this._bufferIndex !== 0;
                this._bufferIndex = 0;
                this._buffer = this._buffers[this._bufferIndex][0];
            }
            else {
                this._bufferIndex = -1;
            }
        }
    }
    /**
     * Updates the value of an uniform. The `update` method must be called afterwards to make it effective in the GPU.
     * @param uniformName Define the name of the uniform, as used in the uniform block in the shader.
     * @param data Define the flattened data
     * @param size Define the size of the data.
     */
    updateUniform(uniformName, data, size) {
        this._checkNewFrame();
        var location = this._uniformLocations[uniformName];
        if (location === undefined) {
            if (this._buffer) {
                // Cannot add an uniform if the buffer is already created
                Logger.Error("Cannot add an uniform after UBO has been created.");
                return;
            }
            this.addUniform(uniformName, size);
            location = this._uniformLocations[uniformName];
        }
        if (!this._buffer) {
            this.create();
        }
        if (!this._dynamic) {
            // Cache for static uniform buffers
            var changed = false;
            for (var i = 0; i < size; i++) {
                // We are checking the matrix cache before calling updateUniform so we do not need to check it here
                // Hence the test for size === 16 to simply commit the matrix values
                if ((size === 16 && !this._engine._features.uniformBufferHardCheckMatrix) || this._bufferData[location + i] !== Tools.FloatRound(data[i])) {
                    changed = true;
                    if (this._createBufferOnWrite) {
                        this._createNewBuffer();
                    }
                    this._bufferData[location + i] = data[i];
                }
            }
            this._needSync = this._needSync || changed;
        }
        else {
            // No cache for dynamic
            for (var i = 0; i < size; i++) {
                this._bufferData[location + i] = data[i];
            }
        }
    }
    /**
     * Updates the value of an uniform. The `update` method must be called afterwards to make it effective in the GPU.
     * @param uniformName Define the name of the uniform, as used in the uniform block in the shader.
     * @param data Define the flattened data
     * @param size Define the size of the data.
     */
    updateUniformArray(uniformName, data, size) {
        this._checkNewFrame();
        var location = this._uniformLocations[uniformName];
        if (location === undefined) {
            Logger.Error("Cannot add an uniform Array dynamically. Please, add it using addUniform.");
            return;
        }
        if (!this._buffer) {
            this.create();
        }
        const arraySizes = this._uniformArraySizes[uniformName];
        if (!this._dynamic) {
            // Cache for static uniform buffers
            var changed = false;
            let countToFour = 0;
            let baseStride = 0;
            for (var i = 0; i < size; i++) {
                if (this._bufferData[location + baseStride * 4 + countToFour] !== Tools.FloatRound(data[i])) {
                    changed = true;
                    if (this._createBufferOnWrite) {
                        this._createNewBuffer();
                    }
                    this._bufferData[location + baseStride * 4 + countToFour] = data[i];
                }
                countToFour++;
                if (countToFour === arraySizes.strideSize) {
                    for (; countToFour < 4; countToFour++) {
                        this._bufferData[location + baseStride * 4 + countToFour] = 0;
                    }
                    countToFour = 0;
                    baseStride++;
                }
            }
            this._needSync = this._needSync || changed;
        }
        else {
            // No cache for dynamic
            for (var i = 0; i < size; i++) {
                this._bufferData[location + i] = data[i];
            }
        }
    }
    _cacheMatrix(name, matrix) {
        this._checkNewFrame();
        const cache = this._valueCache[name];
        const flag = matrix.updateFlag;
        if (cache !== undefined && cache === flag) {
            return false;
        }
        this._valueCache[name] = flag;
        return true;
    }
    // Update methods
    _updateMatrix3x3ForUniform(name, matrix) {
        // To match std140, matrix must be realigned
        for (var i = 0; i < 3; i++) {
            UniformBuffer._tempBuffer[i * 4] = matrix[i * 3];
            UniformBuffer._tempBuffer[i * 4 + 1] = matrix[i * 3 + 1];
            UniformBuffer._tempBuffer[i * 4 + 2] = matrix[i * 3 + 2];
            UniformBuffer._tempBuffer[i * 4 + 3] = 0.0;
        }
        this.updateUniform(name, UniformBuffer._tempBuffer, 12);
    }
    _updateMatrix3x3ForEffect(name, matrix) {
        this._currentEffect.setMatrix3x3(name, matrix);
    }
    _updateMatrix2x2ForEffect(name, matrix) {
        this._currentEffect.setMatrix2x2(name, matrix);
    }
    _updateMatrix2x2ForUniform(name, matrix) {
        // To match std140, matrix must be realigned
        for (var i = 0; i < 2; i++) {
            UniformBuffer._tempBuffer[i * 4] = matrix[i * 2];
            UniformBuffer._tempBuffer[i * 4 + 1] = matrix[i * 2 + 1];
            UniformBuffer._tempBuffer[i * 4 + 2] = 0.0;
            UniformBuffer._tempBuffer[i * 4 + 3] = 0.0;
        }
        this.updateUniform(name, UniformBuffer._tempBuffer, 8);
    }
    _updateFloatForEffect(name, x) {
        this._currentEffect.setFloat(name, x);
    }
    _updateFloatForUniform(name, x) {
        UniformBuffer._tempBuffer[0] = x;
        this.updateUniform(name, UniformBuffer._tempBuffer, 1);
    }
    _updateFloat2ForEffect(name, x, y, suffix = "") {
        this._currentEffect.setFloat2(name + suffix, x, y);
    }
    _updateFloat2ForUniform(name, x, y) {
        UniformBuffer._tempBuffer[0] = x;
        UniformBuffer._tempBuffer[1] = y;
        this.updateUniform(name, UniformBuffer._tempBuffer, 2);
    }
    _updateFloat3ForEffect(name, x, y, z, suffix = "") {
        this._currentEffect.setFloat3(name + suffix, x, y, z);
    }
    _updateFloat3ForUniform(name, x, y, z) {
        UniformBuffer._tempBuffer[0] = x;
        UniformBuffer._tempBuffer[1] = y;
        UniformBuffer._tempBuffer[2] = z;
        this.updateUniform(name, UniformBuffer._tempBuffer, 3);
    }
    _updateFloat4ForEffect(name, x, y, z, w, suffix = "") {
        this._currentEffect.setFloat4(name + suffix, x, y, z, w);
    }
    _updateFloat4ForUniform(name, x, y, z, w) {
        UniformBuffer._tempBuffer[0] = x;
        UniformBuffer._tempBuffer[1] = y;
        UniformBuffer._tempBuffer[2] = z;
        UniformBuffer._tempBuffer[3] = w;
        this.updateUniform(name, UniformBuffer._tempBuffer, 4);
    }
    _updateFloatArrayForEffect(name, array) {
        this._currentEffect.setFloatArray(name, array);
    }
    _updateFloatArrayForUniform(name, array) {
        this.updateUniformArray(name, array, array.length);
    }
    _updateArrayForEffect(name, array) {
        this._currentEffect.setArray(name, array);
    }
    _updateArrayForUniform(name, array) {
        this.updateUniformArray(name, array, array.length);
    }
    _updateIntArrayForEffect(name, array) {
        this._currentEffect.setIntArray(name, array);
    }
    _updateIntArrayForUniform(name, array) {
        UniformBuffer._tempBufferInt32View.set(array);
        this.updateUniformArray(name, UniformBuffer._tempBuffer, array.length);
    }
    _updateMatrixForEffect(name, mat) {
        this._currentEffect.setMatrix(name, mat);
    }
    _updateMatrixForUniform(name, mat) {
        if (this._cacheMatrix(name, mat)) {
            this.updateUniform(name, mat.toArray(), 16);
        }
    }
    _updateMatricesForEffect(name, mat) {
        this._currentEffect.setMatrices(name, mat);
    }
    _updateMatricesForUniform(name, mat) {
        this.updateUniform(name, mat, mat.length);
    }
    _updateVector3ForEffect(name, vector) {
        this._currentEffect.setVector3(name, vector);
    }
    _updateVector3ForUniform(name, vector) {
        UniformBuffer._tempBuffer[0] = vector.x;
        UniformBuffer._tempBuffer[1] = vector.y;
        UniformBuffer._tempBuffer[2] = vector.z;
        this.updateUniform(name, UniformBuffer._tempBuffer, 3);
    }
    _updateVector4ForEffect(name, vector) {
        this._currentEffect.setVector4(name, vector);
    }
    _updateVector4ForUniform(name, vector) {
        UniformBuffer._tempBuffer[0] = vector.x;
        UniformBuffer._tempBuffer[1] = vector.y;
        UniformBuffer._tempBuffer[2] = vector.z;
        UniformBuffer._tempBuffer[3] = vector.w;
        this.updateUniform(name, UniformBuffer._tempBuffer, 4);
    }
    _updateColor3ForEffect(name, color, suffix = "") {
        this._currentEffect.setColor3(name + suffix, color);
    }
    _updateColor3ForUniform(name, color) {
        UniformBuffer._tempBuffer[0] = color.r;
        UniformBuffer._tempBuffer[1] = color.g;
        UniformBuffer._tempBuffer[2] = color.b;
        this.updateUniform(name, UniformBuffer._tempBuffer, 3);
    }
    _updateColor4ForEffect(name, color, alpha, suffix = "") {
        this._currentEffect.setColor4(name + suffix, color, alpha);
    }
    _updateDirectColor4ForEffect(name, color, suffix = "") {
        this._currentEffect.setDirectColor4(name + suffix, color);
    }
    _updateColor4ForUniform(name, color, alpha) {
        UniformBuffer._tempBuffer[0] = color.r;
        UniformBuffer._tempBuffer[1] = color.g;
        UniformBuffer._tempBuffer[2] = color.b;
        UniformBuffer._tempBuffer[3] = alpha;
        this.updateUniform(name, UniformBuffer._tempBuffer, 4);
    }
    _updateDirectColor4ForUniform(name, color) {
        UniformBuffer._tempBuffer[0] = color.r;
        UniformBuffer._tempBuffer[1] = color.g;
        UniformBuffer._tempBuffer[2] = color.b;
        UniformBuffer._tempBuffer[3] = color.a;
        this.updateUniform(name, UniformBuffer._tempBuffer, 4);
    }
    _updateIntForEffect(name, x, suffix = "") {
        this._currentEffect.setInt(name + suffix, x);
    }
    _updateIntForUniform(name, x) {
        UniformBuffer._tempBufferInt32View[0] = x;
        this.updateUniform(name, UniformBuffer._tempBuffer, 1);
    }
    _updateInt2ForEffect(name, x, y, suffix = "") {
        this._currentEffect.setInt2(name + suffix, x, y);
    }
    _updateInt2ForUniform(name, x, y) {
        UniformBuffer._tempBufferInt32View[0] = x;
        UniformBuffer._tempBufferInt32View[1] = y;
        this.updateUniform(name, UniformBuffer._tempBuffer, 2);
    }
    _updateInt3ForEffect(name, x, y, z, suffix = "") {
        this._currentEffect.setInt3(name + suffix, x, y, z);
    }
    _updateInt3ForUniform(name, x, y, z) {
        UniformBuffer._tempBufferInt32View[0] = x;
        UniformBuffer._tempBufferInt32View[1] = y;
        UniformBuffer._tempBufferInt32View[2] = z;
        this.updateUniform(name, UniformBuffer._tempBuffer, 3);
    }
    _updateInt4ForEffect(name, x, y, z, w, suffix = "") {
        this._currentEffect.setInt4(name + suffix, x, y, z, w);
    }
    _updateInt4ForUniform(name, x, y, z, w) {
        UniformBuffer._tempBufferInt32View[0] = x;
        UniformBuffer._tempBufferInt32View[1] = y;
        UniformBuffer._tempBufferInt32View[2] = z;
        UniformBuffer._tempBufferInt32View[3] = w;
        this.updateUniform(name, UniformBuffer._tempBuffer, 4);
    }
    /**
     * Sets a sampler uniform on the effect.
     * @param name Define the name of the sampler.
     * @param texture Define the texture to set in the sampler
     */
    setTexture(name, texture) {
        this._currentEffect.setTexture(name, texture);
    }
    /**
     * Directly updates the value of the uniform in the cache AND on the GPU.
     * @param uniformName Define the name of the uniform, as used in the uniform block in the shader.
     * @param data Define the flattened data
     */
    updateUniformDirectly(uniformName, data) {
        this.updateUniform(uniformName, data, data.length);
        this.update();
    }
    /**
     * Associates an effect to this uniform buffer
     * @param effect Define the effect to associate the buffer to
     * @param name Name of the uniform block in the shader.
     */
    bindToEffect(effect, name) {
        this._currentEffect = effect;
        this._currentEffectName = name;
    }
    /**
     * Binds the current (GPU) buffer to the effect
     */
    bindUniformBuffer() {
        if (!this._noUBO && this._buffer && this._currentEffect) {
            this._currentEffect.bindUniformBuffer(this._buffer, this._currentEffectName);
        }
    }
    /**
     * Dissociates the current effect from this uniform buffer
     */
    unbindEffect() {
        this._currentEffect = undefined;
        this._currentEffectName = undefined;
    }
    /**
     * Disposes the uniform buffer.
     */
    dispose() {
        if (this._noUBO) {
            return;
        }
        const uniformBuffers = this._engine._uniformBuffers;
        let index = uniformBuffers.indexOf(this);
        if (index !== -1) {
            uniformBuffers[index] = uniformBuffers[uniformBuffers.length - 1];
            uniformBuffers.pop();
        }
        if (this._engine._features.trackUbosInFrame && this._buffers) {
            for (let i = 0; i < this._buffers.length; ++i) {
                const buffer = this._buffers[i][0];
                this._engine._releaseBuffer(buffer);
            }
        }
        else if (this._buffer && this._engine._releaseBuffer(this._buffer)) {
            this._buffer = null;
        }
    }
}
/** @hidden */
UniformBuffer._updatedUbosInFrame = {};
// Pool for avoiding memory leaks
UniformBuffer._MAX_UNIFORM_SIZE = 256;
UniformBuffer._tempBuffer = new Float32Array(UniformBuffer._MAX_UNIFORM_SIZE);
UniformBuffer._tempBufferInt32View = new Uint32Array(UniformBuffer._tempBuffer.buffer);

export { UniformBuffer };