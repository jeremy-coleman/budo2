/**
 * The engine store class is responsible to hold all the instances of Engine and Scene created
 * during the life time of the application.
 */
class EngineStore {
    /**
     * Gets the latest created engine
     */
    static get LastCreatedEngine() {
        if (this.Instances.length === 0) {
            return null;
        }
        return this.Instances[this.Instances.length - 1];
    }
    /**
     * Gets the latest created scene
     */
    static get LastCreatedScene() {
        return this._LastCreatedScene;
    }
}
/** Gets the list of created engines */
EngineStore.Instances = new Array();
/** @hidden */
EngineStore._LastCreatedScene = null;
/**
 * Gets or sets a global variable indicating if fallback texture must be used when a texture cannot be loaded
 * @ignorenaming
 */
EngineStore.UseFallbackTexture = true;
/**
 * Texture content used if a texture cannot loaded
 * @ignorenaming
 */
EngineStore.FallbackTexture = "";

export { EngineStore };
