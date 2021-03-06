// We hook into needsUpdate so it will lazily check
// shader updates every frame of rendering.

var isDevelopment = process.env.NODE_ENV !== "production"

class LiveShaderMaterial extends THREE.RawShaderMaterial {
  constructor(shader, parameters = {}) {
    super(parameters)
    //parameters = parameters || {}
    this.shader = shader
    if (this.shader) {
      this.vertexShader = this.shader.vertex
      this.fragmentShader = this.shader.fragment
    }
    this.shaderVersion = this.shader ? this.shader.version : undefined
    this._needsUpdate = true
  }

  copy(source) {
    super.copy(source)
    this.shader = source.shader
    this.shaderVersion = this.shader.version
    this.vertexShader = this.shader.vertex
    this.fragmentShader = this.shader.fragment
    return this
  }

  isShaderUpdate() {
    var shader = this.shader

    var dirty = false
    if (isDevelopment) {
      // If source has changed, recompile.
      // We could also do a string equals check, but since this is
      // done per frame across potentially thousands of objects,
      // it's probably better to just use the integer version check.
      dirty = this.shaderVersion !== shader.version
      if (dirty) {
        this.shaderVersion = shader.version
        this.vertexShader = shader.vertex
        this.fragmentShader = shader.fragment
        this.needsUpdate = true
      }
    }

    return dirty
  }

  get needsUpdate() {
    return this.isShaderUpdate() || this._needsUpdate
  }
  set needsUpdate(v) {
    this._needsUpdate = v
  }
}

// Handle material.clone() and material.copy() functions properly
// LiveShaderMaterial.prototype.copy = function (source) {
//   THREE.RawShaderMaterial.prototype.copy.call(this, source)
//   this.shader = source.shader
//   this.shaderVersion = this.shader.version
//   this.vertexShader = this.shader.vertex
//   this.fragmentShader = this.shader.fragment
//   return this
// }

// // Check if shader is out of date, if so we should mark this as dirty
// LiveShaderMaterial.prototype.isShaderUpdate = function () {
//   var shader = this.shader

//   var dirty = false
//   if (isDevelopment) {
//     // If source has changed, recompile.
//     // We could also do a string equals check, but since this is
//     // done per frame across potentially thousands of objects,
//     // it's probably better to just use the integer version check.
//     dirty = this.shaderVersion !== shader.version
//     if (dirty) {
//       this.shaderVersion = shader.version
//       this.vertexShader = shader.vertex
//       this.fragmentShader = shader.fragment
//       this.needsUpdate = true
//     }
//   }

//   return dirty
// }

// // Hook into needsUpdate so we can check shader version per frame
// Object.defineProperty(LiveShaderMaterial.prototype, "needsUpdate", {
//   get: function () {
//     return this.isShaderUpdate() || this._needsUpdate
//   },
//   set: function (v) {
//     this._needsUpdate = v
//   }
// })

module.exports = LiveShaderMaterial
