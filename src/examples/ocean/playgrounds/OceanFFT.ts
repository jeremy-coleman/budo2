import * as BABYLON from 'babylonjs'
//https://playground.babylonjs.com/#YX6IB8#31
/**
 * Based on the great Unity project https://github.com/gasgiant/FFT-Ocean by Ivan Pensionerov (https://github.com/gasgiant)
 */

 async function createEngine() {
    const webGPUSupported = await (BABYLON.WebGPUEngine as any).IsSupportedAsync;
    if (webGPUSupported) {
        const engine = new BABYLON.WebGPUEngine(document.getElementById("renderCanvas") as HTMLCanvasElement, {
            //forceCopyForInvertYFinalFramebuffer : true,
            deviceDescriptor: {
                requiredFeatures: [
                    "depth-clip-control",
                    "depth24unorm-stencil8",
                    "depth32float-stencil8",
                    "texture-compression-bc",
                    "texture-compression-etc2",
                    "texture-compression-astc",
                    "timestamp-query",
                    "indirect-first-instance",
                ],
            },
        });
        await engine.initAsync();
        return engine;
    }
    return new BABYLON.Engine(document.getElementById("renderCanvas") as HTMLCanvasElement, true);
}

class Playground {
    public static CreateScene(engine: BABYLON.Engine, canvas: HTMLCanvasElement): Promise<BABYLON.Scene> {
        const oceanDemo = new Ocean();
        return oceanDemo.createScene(engine, canvas);
    }
}

class Ocean {

    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.TargetCamera;
    private _rttDebug: RTTDebug;
    private _light: BABYLON.DirectionalLight;
    private _depthRenderer: BABYLON.DepthRenderer;
    private _buoyancy: Buoyancy;
    private _wavesSettings: WavesSettings;
    private _fxaa: BABYLON.Nullable<BABYLON.FxaaPostProcess>;
    private _size: number;
    private _gui: OceanGUI;
    private _skybox: SkyBox;
    private _oceanMaterial: OceanMaterial;
    private _oceanGeometry: OceanGeometry;
    private _wavesGenerator: BABYLON.Nullable<WavesGenerator>;
    private _useZQSD: boolean;
    private _useProceduralSky: boolean
    private _lightDirection: BABYLON.Vector3;
    private _shadowGenerator: BABYLON.ShadowGenerator;
    private _lightBuoy: BABYLON.PointLight;
    private _shadowGeneratorBuoy: BABYLON.ShadowGenerator;
    private _glowLayer: BABYLON.GlowLayer;
    private _forceUpdateGlowIntensity: boolean;

    constructor() {
        this._engine = null as any;
        this._scene = null as any;
        this._camera = null as any;
        this._rttDebug = null as any;
        this._light = null as any;
        this._depthRenderer = null as any;
        this._buoyancy = null as any;
        this._fxaa = null;
        this._gui = null as any;
        this._skybox = null as any;
        this._oceanMaterial = null as any;
        this._oceanGeometry = null as any;
        this._wavesGenerator = null;
        this._useZQSD = false;
        this._useProceduralSky = true;
        this._lightDirection = new BABYLON.Vector3(0, -1, -0.25);
        this._shadowGenerator = null as any;
        this._lightBuoy = null as any;
        this._shadowGeneratorBuoy = null as any;
        this._glowLayer = null as any;
        this._forceUpdateGlowIntensity = true;

        this._size = 0;
        this._wavesSettings = new WavesSettings();
    }

    public async createScene(
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement
    ): Promise<BABYLON.Scene> {
        (window as any).convf = function(l: number): number { const a = new Uint8Array([l & 0xff, (l & 0xff00) >> 8, (l & 0xff0000) >> 16, (l & 0xff000000) >> 24]); return new Float32Array(a.buffer)[0]; };
        (window as any).numbg = function(): void { console.log("NumBindGroupsCreatedTotal=", BABYLON.WebGPUCacheBindGroups.NumBindGroupsCreatedTotal, " - NumBindGroupsCreatedLastFrame=", BABYLON.WebGPUCacheBindGroups.NumBindGroupsCreatedLastFrame); };

        const scene = new BABYLON.Scene(engine);

        scene.useRightHandedSystem = true;

        this._engine = engine;
        this._scene = scene;

        this._camera = new BABYLON.FreeCamera("mainCamera", new BABYLON.Vector3(-17.3, 5, -9), scene);
        this._camera.rotation.set(0.21402315044176745, 1.5974857677541419, 0);
        this._camera.minZ = 1;
        this._camera.maxZ = 100000;

        if (!this._checkSupport()) {
            return scene;
        }

        this._setCameraKeys();

        await OceanGUI.LoadDAT();

        this._rttDebug = new RTTDebug(scene, engine, 32);
        this._rttDebug.show(false);

        scene.environmentIntensity = 1;

        scene.activeCameras = [this._camera, this._rttDebug.camera];

        this._camera.attachControl(canvas, true);

        const cameraUpdate = this._camera.update.bind(this._camera);
        this._camera.update = function() {
            cameraUpdate();
            if (this.position.y < 1.5) {
                this.position.y = 1.5;
            }
        };

        this._depthRenderer = this._scene.enableDepthRenderer(this._camera, false);
        this._depthRenderer.getDepthMap().renderList = [];
        
        this._light = new BABYLON.DirectionalLight("light", this._lightDirection, scene);
        this._light.intensity = 1;
        this._light.diffuse = new BABYLON.Color3(1, 1, 1);
        this._light.shadowMinZ = 0;
        this._light.shadowMaxZ = 40;
        this._light.shadowOrthoScale = 0.5;

        this._shadowGenerator = new BABYLON.ShadowGenerator(4096, this._light);
        this._shadowGenerator.usePercentageCloserFiltering = true;
        this._shadowGenerator.bias = 0.005;

        this._skybox = new SkyBox(this._useProceduralSky, scene);
        this._buoyancy = new Buoyancy(this._size, 3, 0.2);
        this._oceanMaterial = new OceanMaterial(this._depthRenderer, this._scene);
        this._oceanGeometry = new OceanGeometry(this._oceanMaterial, this._camera, this._scene);

        this._fxaa = new BABYLON.FxaaPostProcess("fxaa", 1, this._camera);
        this._fxaa.samples = engine.getCaps().maxMSAASamples;

        await this._loadMeshes();

        //scene.stopAllAnimations();

        await this._updateSize(256);
        this._oceanGeometry.initializeMeshes();

        this._gui = new OceanGUI(this._useProceduralSky, scene, engine, this._parameterRead.bind(this), this._parameterChanged.bind(this));

        if (location.href.indexOf("hidegui") !== -1) {
            this._gui.visible = false;
        }

        this._scene.onKeyboardObservable.add((kbInfo) => {
            switch (kbInfo.type) {
                case BABYLON.KeyboardEventTypes.KEYDOWN:
                    if (kbInfo.event.key === "Shift") {
                        this._camera.speed = 10;
                    }
                    break;
                case BABYLON.KeyboardEventTypes.KEYUP:
                    if (kbInfo.event.key === "Shift") {
                        this._camera.speed = 2;
                    }
                    break;
            }
        });

        scene.onBeforeRenderObservable.add(() => {
            if (this._skybox.update(this._light) || this._forceUpdateGlowIntensity) {
                if (this._glowLayer) {
                    const minIntensity = 0.6;
                    const maxIntensity = 3;
                    const sunPos = this._light.position.clone().normalize();
                    const sunProj = sunPos.clone().normalize();

                    sunProj.y = 0;

                    const dot = BABYLON.Vector3.Dot(sunPos, sunProj);
                    
                    let intensity = BABYLON.Scalar.Lerp(minIntensity, maxIntensity, BABYLON.Scalar.Clamp(dot, 0, 1));

                    this._glowLayer.intensity = sunPos.y < 0 ? maxIntensity : intensity;
                    this._forceUpdateGlowIntensity = false;
                }
                this._light.position = this._light.position.clone().normalize().scaleInPlace(30);
            }
            this._oceanGeometry.update();
            this._wavesGenerator!.update();
            this._buoyancy.setWaterHeightMap(this._wavesGenerator!.waterHeightMap, this._wavesGenerator!.waterHeightMapScale);
            this._buoyancy.update();
        });

        return new Promise((resolve) => {
            scene.executeWhenReady(() => resolve(scene));
        });
    }

    private _setCameraKeys(): void {
        const kbInputs = this._camera.inputs.attached.keyboard as BABYLON.FreeCameraKeyboardMoveInput;
        if (this._useZQSD) {
            kbInputs.keysDown = [40, 83];
            kbInputs.keysLeft = [37, 81];
            kbInputs.keysRight = [39, 68];
            kbInputs.keysUp = [38, 90];
        } else {
            kbInputs.keysDown = [40, 83];
            kbInputs.keysLeft = [37, 65];
            kbInputs.keysRight = [39, 68];
            kbInputs.keysUp = [38, 87];
        }
        kbInputs.keysDownward = [34, 32];
        kbInputs.keysUpward = [33, 69];
    }

    private _checkSupport(): boolean {
        if (this._engine.getCaps().supportComputeShaders) {
            return true;
        }

        const panel = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

        const textNOk = "**Use WebGPU to watch this demo which requires compute shaders support. To enable WebGPU please use Chrome Canary or Edge canary. Also select the WebGPU engine from the top right drop down menu.**";
    
        var info = new BABYLON.GUI.TextBlock();
        info.text = textNOk;
        info.width = "100%";
        info.paddingLeft = "5px";
        info.paddingRight = "5px";
        info.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        info.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        info.color = "red";
        info.fontSize = "24px";
        info.fontStyle = "bold";
        info.textWrapping = true;
        panel.addControl(info); 

        return false;
    }

    private async _loadMeshes() {
        await BABYLON.SceneLoader.AppendAsync("", 'https://assets.babylonjs.com/meshes/babylonBuoy.glb', this._scene, undefined, ".glb");

        const babylonBuoyMeshes = [this._scene.getMeshByName("buoyMesh_low") as BABYLON.Mesh];
        const babylonBuoyRoot = babylonBuoyMeshes[0].parent as BABYLON.TransformNode;
        const scale = 14;

        babylonBuoyRoot.position.z = -8;
        babylonBuoyRoot.scaling.setAll(scale);

        babylonBuoyMeshes.forEach((mesh) => {
            mesh.material!.backFaceCulling = false;

            this._shadowGenerator.addShadowCaster(mesh);
            mesh.receiveShadows = true;
            this._depthRenderer.getDepthMap().renderList!.push(mesh);
        });

        babylonBuoyRoot.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, Math.PI / 3, 0);
        this._buoyancy.addMesh(babylonBuoyRoot, { v1: new BABYLON.Vector3(0.7 / scale, 1 / scale, -1.5 / scale), v2: new BABYLON.Vector3(0.7 / scale, 1 / scale, 1.5 / scale), v3: new BABYLON.Vector3(-1.5 / scale, 1 / scale, -1.5 / scale) }, 0.0, 2);

        const slight = BABYLON.MeshBuilder.CreateSphere("slight", { segments: 6, diameter: 0.5 / scale }, this._scene);
        slight.position.set(-0.6 / scale, 6.58 / scale, 0.3 / scale);
        slight.visibility = 0;
        slight.parent = babylonBuoyRoot;

        this._lightBuoy = new BABYLON.PointLight("point", new BABYLON.Vector3(0, 0, 0), this._scene);
        this._lightBuoy.intensity = 30;
        this._lightBuoy.diffuse = new BABYLON.Color3(0.96, 0.70, 0.15).toLinearSpace();
        this._lightBuoy.shadowMinZ = 0.01;
        this._lightBuoy.shadowMaxZ = 15;
        this._lightBuoy.parent = slight;

        this._shadowGeneratorBuoy = new BABYLON.ShadowGenerator(2048, this._lightBuoy);
        this._shadowGeneratorBuoy.usePoissonSampling = true;
        this._shadowGeneratorBuoy.addShadowCaster(babylonBuoyMeshes[0]);
        this._shadowGeneratorBuoy.bias = 0.01;
    }

    private _createGlowLayer(): void {
        this._glowLayer = new BABYLON.GlowLayer("glow", this._scene);

        this._glowLayer.addIncludedOnlyMesh(this._scene.getMeshByName("glassCovers_low") as BABYLON.Mesh);

        this._glowLayer.customEmissiveColorSelector = (mesh, subMesh, material, result) => {
            result.set(this._lightBuoy.diffuse.r, this._lightBuoy.diffuse.g, this._lightBuoy.diffuse.b, 1);
        };

        this._forceUpdateGlowIntensity = true;
    }

    private async _updateSize(size: number) {
        this._size = size;

        this._buoyancy.size = size;

        const noise = await (await fetch('https://assets.babylonjs.com/environments/noise.exr')).arrayBuffer();

        this._wavesGenerator?.dispose();
        this._wavesGenerator = new WavesGenerator(this._size, this._wavesSettings, this._scene, this._rttDebug, noise);

        this._oceanMaterial.setWavesGenerator(this._wavesGenerator);

        await this._oceanGeometry.initializeMaterials();
    }

    private _readValue(obj: any, name: string): any {
        const parts: string[] = name.split("_");

        for (let i = 0; i < parts.length; ++i) {
            obj = obj[parts[i]];
        }

        return obj;
    }

    private _setValue(obj: any, name: string, value: any): void {
        const parts: string[] = name.split("_");

        for (let i = 0; i < parts.length - 1; ++i) {
            obj = obj[parts[i]];
        }

        obj[parts[parts.length - 1]] = value;
    }

    private _parameterRead(name: string): any {
        switch (name) {
            case "size":
                return this._size;
            case "showDebugRTT":
                return this._rttDebug.isVisible;
            case "envIntensity":
                return this._scene.environmentIntensity;
            case "lightIntensity":
                return this._light.intensity;
            case "proceduralSky":
                return this._useProceduralSky;
            case "enableShadows":
                return this._light.shadowEnabled;
            case "enableFXAA":
                return this._fxaa !== null;
            case "enableGlow":
                return this._glowLayer !== null;
            case "useZQSD":
                return this._useZQSD;
            case "buoy_enabled":
                return this._buoyancy.enabled;
            case "buoy_attenuation":
                return this._buoyancy.attenuation;
            case "buoy_numSteps":
                return this._buoyancy.numSteps;
            case "skybox_lightColor":
                return this._light.diffuse.toHexString();
            case "skybox_directionX":
                return this._lightDirection.x;
            case "skybox_directionY":
                return this._lightDirection.y;
            case "skybox_directionZ":
                return this._lightDirection.z;
        }

        if (name.startsWith("procSky_")) {
            name = name.substring(8);
            return (this._skybox.skyMaterial as any)[name];
        }

        if (name.startsWith("waves_")) {
            name = name.substring(6);
            return this._readValue(this._wavesSettings, name);
        }

        if (name.startsWith("oceangeom_")) {
            name = name.substring(10);
            return this._readValue(this._oceanGeometry, name);
        }

        if (name.startsWith("oceanshader_")) {
            name = name.substring(12);
            return this._oceanMaterial.readMaterialParameter(this._oceanGeometry.getMaterial(0) as BABYLON.PBRCustomMaterial, name);
        }
    }

    private _parameterChanged(name: string, value: any): void {
        //console.log(name, "=", value);
        switch (name) {
            case "size":
                const newSize = value | 0;
                if (newSize !== this._size) {
                    this._updateSize(newSize);
                }
                break;
            case "showDebugRTT":
                this._rttDebug.show(!!value);
                break;
            case "envIntensity":
                this._scene.environmentIntensity = parseFloat(value);
                break;
            case "lightIntensity":
                this._light.intensity = parseFloat(value);
                break;
            case "enableShadows":
                this._light.shadowEnabled = !!value;
                if (this._lightBuoy) {
                    this._lightBuoy.shadowEnabled = !!value;
                }
                break;
            case "enableFXAA":
                if (!!value) {
                    if (!this._fxaa) {
                        this._fxaa = new BABYLON.FxaaPostProcess("fxaa", 1, this._camera);
                        this._fxaa.samples = this._engine.getCaps().maxMSAASamples;
                    }
                } else if (this._fxaa) {
                    this._fxaa.dispose();
                    this._fxaa = null;
                }
                break;
            case "enableGlow":
                if (this._glowLayer) {
                    this._glowLayer.dispose();
                    this._glowLayer = null as any;
                } else {
                    this._createGlowLayer();
                }
                break;
            case "proceduralSky":
                value = !!value;
                if (this._useProceduralSky !== value) {
                    this._gui.dispose();
                    this._skybox.dispose();
                    this._useProceduralSky = value;
                    this._skybox = new SkyBox(this._useProceduralSky, this._scene);
                    this._gui = new OceanGUI(this._useProceduralSky, this._scene, this._engine, this._parameterRead.bind(this), this._parameterChanged.bind(this));
                }
                break;
            case "useZQSD":
                this._useZQSD = !!value;
                this._setCameraKeys();
                break;
            case "buoy_enabled":
                this._buoyancy.enabled = !!value;
                break;
            case "buoy_attenuation":
                this._buoyancy.attenuation = parseFloat(value);
                break;
            case "buoy_numSteps":
                this._buoyancy.numSteps = value | 0;
                break;
            case "skybox_lightColor":
                this._light.diffuse.copyFrom(BABYLON.Color3.FromHexString(value));
                break;
            case "skybox_directionX":
                this._lightDirection.x = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
            case "skybox_directionY":
                this._lightDirection.y = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
            case "skybox_directionZ":
                this._lightDirection.z = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
        }

        if (name.startsWith("procSky_")) {
            name = name.substring(8);
            this._setValue(this._skybox.skyMaterial, name, value === false ? false : value === true ? true : parseFloat(value));
            this._skybox.setAsDirty();
        }

        if (name.startsWith("waves_")) {
            name = name.substring(6);
            this._setValue(this._wavesSettings, name, value === false ? false : value === true ? true : parseFloat(value));
            this._wavesGenerator!.initializeCascades();
        }

        if (name.startsWith("oceangeom_")) {
            name = name.substring(10);
            this._setValue(this._oceanGeometry, name, value === false ? false : value === true ? true : parseFloat(value));
            if (name !== "oceangeom_noMaterialLod") {
                this._oceanGeometry.initializeMeshes();
            }
        }

        if (name.startsWith("oceanshader_")) {
            name = name.substring(12);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(0) as BABYLON.PBRCustomMaterial, name, value);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(1) as BABYLON.PBRCustomMaterial, name, value);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(2) as BABYLON.PBRCustomMaterial, name, value);
        }
    }
}




declare var dat: any;

class OceanGUI {

    private _gui: any;
    private _visible: boolean;
    private _scene: BABYLON.Scene;
    private _paramRead: (name: string) => any;
    private _paramChanged: (name: string, value: any) => void;
    private _onKeyObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.KeyboardInfo>>;

    public static LoadDAT(): Promise<void> {
        return BABYLON.Tools.LoadScriptAsync("https://cdnjs.cloudflare.com/ajax/libs/dat-gui/0.6.2/dat.gui.min.js");
    }

    public set visible(v: boolean) {
        if (v === this._visible) {
            return;
        }
        this._visible = v;
        this._gui.domElement.style.display = v ? "" : "none";
    }

    constructor(hasProceduralSky: boolean, scene: BABYLON.Scene, engine: BABYLON.Engine, paramRead: (name: string) => any, paramChanged: (name: string, value: any) => void) {
        this._scene = scene;
        this._visible = true;
        this._onKeyObserver = null;
        this._paramRead = paramRead;
        this._paramChanged = paramChanged;

        const oldgui = document.getElementById("datGUI");
        if (oldgui !== null) {
            oldgui.remove();
        }
    
        this._gui = new dat.GUI();
        this._gui.domElement.style.marginTop = "60px";
        this._gui.domElement.id = "datGUI";

        this._setupKeyboard();
        this._initialize(hasProceduralSky);
    }

    public dispose() {
        const oldgui = document.getElementById("datGUI");
        if (oldgui !== null) {
            oldgui.remove();
        }
        this._scene.onKeyboardObservable.remove(this._onKeyObserver);
    }

    private _setupKeyboard(): void {
        this._onKeyObserver = this._scene.onKeyboardObservable.add((kbInfo) => {
            switch (kbInfo.type) {
                case BABYLON.KeyboardEventTypes.KEYDOWN:
                    //console.log("KEY DOWN: ", kbInfo.event.key);
                    break;
                case BABYLON.KeyboardEventTypes.KEYUP:
                    switch (kbInfo.event.key) {
                        case "F8": {
                            this.visible = !this._visible;
                            break;
                        }
                    }
                    //console.log("KEY UP: ", kbInfo.event.key, kbInfo.event.keyCode);
                    break;
            }
        });
    }

    private _initialize(hasProceduralSky: boolean): void {
        this._makeMenuGeneral();

        if (hasProceduralSky) {
            this._makeMenuProceduralSky();
        } else {
            this._makeMenuSkybox();
        }
 
        this._makeMenuWavesGenerator();
        this._makeMenuOceanGeometry()
        this._makeMenuOceanShader();

        this._makeMenuBuoyancy();
    }

    private _addList(menu: any, params: any, name: string, friendlyName: string, list: any[]): void {
        menu.add(params, name, list)
            .name(friendlyName)
            .onChange((value: any) => {
                this._paramChanged(name, value);
            });
    }

    private _addCheckbox(menu: any, params: any, name: string, friendlyName: string): void {
        menu.add(params, name)
            .name(friendlyName)
            .onChange((value: any) => {
                this._paramChanged(name, value);
            });
    }

    private _addSlider(menu: any, params: any, name: string, friendlyName: string, min: number, max: number, step: number): void {
        menu.add(params, name, min, max, step)
            .name(friendlyName)
            .onChange((value: any) => {
                this._paramChanged(name, value);
            });
    }

    private _addColor(menu: any, params: any, name: string, friendlyName: string): void {
        menu.addColor(params, name)
            .name(friendlyName)
            .onChange((value: any) => {
                this._paramChanged(name, value);
            });
    }

    private _makeMenuGeneral(): void {
        const params = {
            size: this._paramRead("size"),
            envIntensity: this._paramRead("envIntensity"),
            lightIntensity: this._paramRead("lightIntensity"),
            //proceduralSky: this._paramRead("proceduralSky"),
            enableShadows: this._paramRead("enableShadows"),
            //enableFXAA: this._paramRead("enableFXAA"),
            enableGlow: this._paramRead("enableGlow"),
            useZQSD: this._paramRead("useZQSD"),
            showDebugRTT: this._paramRead("showDebugRTT"),
        };
        
        const general = this._gui.addFolder("General");

        this._addList(general, params, "size", "Resolution", [256, 128, 64, 32]);
        this._addSlider(general, params, "envIntensity", "Env intensity", 0, 4, 0.05);
        this._addSlider(general, params, "lightIntensity", "Light intensity", 0, 5, 0.05);
        //this._addCheckbox(general, params, "proceduralSky", "Procedural sky");
        this._addCheckbox(general, params, "enableShadows", "Enable shadows");
        //this._addCheckbox(general, params, "enableFXAA", "Enable FXAA");
        this._addCheckbox(general, params, "enableGlow", "Enable Glow layer");
        this._addCheckbox(general, params, "useZQSD", "Use ZQSD");
        this._addCheckbox(general, params, "showDebugRTT", "Show debug RTT");

        general.open();
    }

    private _makeMenuProceduralSky(): void {
        const params = {
            procSky_inclination: this._paramRead("procSky_inclination"),
            procSky_azimuth: this._paramRead("procSky_azimuth"),
            procSky_luminance: this._paramRead("procSky_luminance"),
            procSky_turbidity: this._paramRead("procSky_turbidity"),
            procSky_rayleigh: this._paramRead("procSky_rayleigh"),
            procSky_mieCoefficient: this._paramRead("procSky_mieCoefficient"),
            procSky_mieDirectionalG: this._paramRead("procSky_mieDirectionalG"),
        };
        
        const proceduralSky = this._gui.addFolder("Sky");

        this._addSlider(proceduralSky, params, "procSky_inclination", "Inclination", -0.5, 0.5, 0.001);
        this._addSlider(proceduralSky, params, "procSky_azimuth", "Azimuth", 0.0, 1, 0.001);
        this._addSlider(proceduralSky, params, "procSky_luminance", "Luminance", 0.001, 1, 0.001);
        this._addSlider(proceduralSky, params, "procSky_turbidity", "Turbidity", 0.1, 100, 0.1);
        this._addSlider(proceduralSky, params, "procSky_rayleigh", "Rayleigh", 0.1, 10, 0.1);
        this._addSlider(proceduralSky, params, "procSky_mieCoefficient", "Mie Coefficient", 0.0, 0.1, 0.0001);
        this._addSlider(proceduralSky, params, "procSky_mieDirectionalG", "Mie DirectionalG", 0.0, 1, 0.01);

        proceduralSky.open();
    }

    private _makeMenuSkybox(): void {
        const params = {
            skybox_lightColor: this._paramRead("skybox_lightColor"),
            skybox_directionX: this._paramRead("skybox_directionX"),
            skybox_directionY: this._paramRead("skybox_directionY"),
            skybox_directionZ: this._paramRead("skybox_directionZ"),
        };
        
        const skybox = this._gui.addFolder("Sky");

        this._addColor(skybox, params, "skybox_lightColor", "Light color");
        this._addSlider(skybox, params, "skybox_directionX", "Light dir X", -10, 10, 0.001);
        this._addSlider(skybox, params, "skybox_directionY", "Light dir Y", -10, -0.01, 0.001);
        this._addSlider(skybox, params, "skybox_directionZ", "Light dir Z", -10, 10, 0.001);
    }

    private _makeMenuWavesGenerator(): void {
        const params = {
            waves_g: this._paramRead("waves_g"),
            waves_depth: this._paramRead("waves_depth"),
            waves_lambda: this._paramRead("waves_lambda"),

            waves_local_scale: this._paramRead("waves_local_scale"),
            waves_local_windSpeed: this._paramRead("waves_local_windSpeed"),
            waves_local_windDirection: this._paramRead("waves_local_windDirection"),
            waves_local_fetch: this._paramRead("waves_local_fetch"),
            waves_local_spreadBlend: this._paramRead("waves_local_spreadBlend"),
            waves_local_swell: this._paramRead("waves_local_swell"),
            waves_local_peakEnhancement: this._paramRead("waves_local_peakEnhancement"),
            waves_local_shortWavesFade: this._paramRead("waves_local_shortWavesFade"),

            waves_swell_scale: this._paramRead("waves_swell_scale"),
            waves_swell_windSpeed: this._paramRead("waves_swell_windSpeed"),
            waves_swell_windDirection: this._paramRead("waves_swell_windDirection"),
            waves_swell_fetch: this._paramRead("waves_swell_fetch"),
            waves_swell_spreadBlend: this._paramRead("waves_swell_spreadBlend"),
            waves_swell_swell: this._paramRead("waves_swell_swell"),
            waves_swell_peakEnhancement: this._paramRead("waves_swell_peakEnhancement"),
            waves_swell_shortWavesFade: this._paramRead("waves_swell_shortWavesFade"),
        };
        
        const wavesGenerator = this._gui.addFolder("Waves Generator");

        this._addSlider(wavesGenerator, params, "waves_g", "Gravity", 0.01, 30, 0.01);
        this._addSlider(wavesGenerator, params, "waves_depth", "Ocean depth", 0.001, 3, 0.001);
        this._addSlider(wavesGenerator, params, "waves_lambda", "Lambda", 0.0, 1, 0.001);

        const local = wavesGenerator.addFolder("Local");

        this._addSlider(local, params, "waves_local_scale", "Scale", 0.0, 1, 0.001);
        this._addSlider(local, params, "waves_local_windSpeed", "Wind speed", 0.001, 100, 0.001);
        this._addSlider(local, params, "waves_local_windDirection", "Wind direction", -100.0, 100, 0.1);
        this._addSlider(local, params, "waves_local_fetch", "Fetch", 100, 1000000, 100);
        this._addSlider(local, params, "waves_local_spreadBlend", "Spread blend", 0, 1, 0.01);
        this._addSlider(local, params, "waves_local_swell", "Swell", 0, 1, 0.01);
        this._addSlider(local, params, "waves_local_peakEnhancement", "Peak enhanc.", 0.01, 100, 0.01);
        this._addSlider(local, params, "waves_local_shortWavesFade", "Short waves fade", 0.001, 1, 0.001);

        local.open();

        const swell = wavesGenerator.addFolder("Swell");

        this._addSlider(swell, params, "waves_swell_scale", "Scale", 0.0, 1, 0.001);
        this._addSlider(swell, params, "waves_swell_windSpeed", "Wind speed", 0.001, 100, 0.001);
        this._addSlider(swell, params, "waves_swell_windDirection", "Wind direction", -100.0, 100, 0.1);
        this._addSlider(swell, params, "waves_swell_fetch", "Fetch", 100, 1000000, 100);
        this._addSlider(swell, params, "waves_swell_spreadBlend", "Spread blend", 0, 1, 0.01);
        this._addSlider(swell, params, "waves_swell_swell", "Swell", 0, 1, 0.01);
        this._addSlider(swell, params, "waves_swell_peakEnhancement", "Peak enhanc.", 0.01, 100, 0.01);
        this._addSlider(swell, params, "waves_swell_shortWavesFade", "Short waves fade", 0.001, 1, 0.001);

        swell.open();

        wavesGenerator.open();
    }

    private _makeMenuOceanGeometry(): void {
        const params = {
            oceangeom_lengthScale: this._paramRead("oceangeom_lengthScale"),
            oceangeom_vertexDensity: this._paramRead("oceangeom_vertexDensity"),
            oceangeom_clipLevels: this._paramRead("oceangeom_clipLevels"),
            oceangeom_skirtSize: this._paramRead("oceangeom_skirtSize"),
            oceangeom_wireframe: this._paramRead("oceangeom_wireframe"),
            oceangeom_noMaterialLod: this._paramRead("oceangeom_noMaterialLod"),
        };
        
        const oceanGeometry = this._gui.addFolder("Ocean Geometry");

        this._addSlider(oceanGeometry, params, "oceangeom_lengthScale", "Length scale", 1, 100, 0.1);
        this._addSlider(oceanGeometry, params, "oceangeom_vertexDensity", "Vertex density", 1, 40, 1);
        this._addSlider(oceanGeometry, params, "oceangeom_clipLevels", "Clip levels", 1, 8, 1);
        this._addSlider(oceanGeometry, params, "oceangeom_skirtSize", "Skirt size", 0, 100, 0.1);
        this._addCheckbox(oceanGeometry, params, "oceangeom_wireframe", "Wireframe");
        this._addCheckbox(oceanGeometry, params, "oceangeom_noMaterialLod", "No material LOD");
    }

    private _makeMenuOceanShader(): void {
        const params = {
            oceanshader__Color: this._paramRead("oceanshader__Color"),
            oceanshader__MaxGloss: this._paramRead("oceanshader__MaxGloss"),
            oceanshader__RoughnessScale: this._paramRead("oceanshader__RoughnessScale"),
            oceanshader__LOD_scale: this._paramRead("oceanshader__LOD_scale"),
            oceanshader__FoamColor: this._paramRead("oceanshader__FoamColor"),
            oceanshader__FoamScale: this._paramRead("oceanshader__FoamScale"),
            oceanshader__ContactFoam: this._paramRead("oceanshader__ContactFoam"),
            oceanshader__FoamBiasLOD2: this._paramRead("oceanshader__FoamBiasLOD2"),
            oceanshader__SSSColor: this._paramRead("oceanshader__SSSColor"),
            oceanshader__SSSStrength: this._paramRead("oceanshader__SSSStrength"),
            oceanshader__SSSBase: this._paramRead("oceanshader__SSSBase"),
            oceanshader__SSSScale: this._paramRead("oceanshader__SSSScale"),
        };
        
        const oceanShader = this._gui.addFolder("Ocean Shader");

        this._addColor(oceanShader, params, "oceanshader__Color", "Color");
        this._addSlider(oceanShader, params, "oceanshader__MaxGloss", "Max gloss", 0.0, 1, 0.01);
        this._addSlider(oceanShader, params, "oceanshader__RoughnessScale", "Roughness scale", 0.0, 1, 0.0001);
        this._addSlider(oceanShader, params, "oceanshader__LOD_scale", "LOD scale", 0.01, 20, 0.01);
        this._addColor(oceanShader, params, "oceanshader__FoamColor", "Foam color");
        this._addSlider(oceanShader, params, "oceanshader__FoamScale", "Foam scale", 0.001, 8, 0.001);
        this._addSlider(oceanShader, params, "oceanshader__ContactFoam", "Foam contact", 0.001, 3, 0.001);
        this._addSlider(oceanShader, params, "oceanshader__FoamBiasLOD2", "Foam bias", 0.001, 4, 0.001);
        this._addColor(oceanShader, params, "oceanshader__SSSColor", "SSS color");
        this._addSlider(oceanShader, params, "oceanshader__SSSStrength", "SSS strength", 0.001, 2, 0.001);
        this._addSlider(oceanShader, params, "oceanshader__SSSBase", "SSS base", -2, 1, 0.001);
        this._addSlider(oceanShader, params, "oceanshader__SSSScale", "SSS scale", 0.001, 10, 0.001);
    }

    private _makeMenuBuoyancy(): void {
        const params = {
            buoy_enabled: this._paramRead("buoy_enabled"),
            buoy_attenuation: this._paramRead("buoy_attenuation"),
            buoy_numSteps: this._paramRead("buoy_numSteps"),
        };
        
        const buoyancy = this._gui.addFolder("Buoyancy");

        this._addCheckbox(buoyancy, params, "buoy_enabled", "Enabled");
        this._addSlider(buoyancy, params, "buoy_attenuation", "Damping factor", 0, 1, 0.001);
        this._addSlider(buoyancy, params, "buoy_numSteps", "Num steps", 1, 20, 1);
    }
}



enum Seams {
    None = 0,
    Left = 1,
    Right = 2,
    Top = 4,
    Bottom = 8,
    All = Left | Right | Top | Bottom
}

class OceanGeometry {

    public lengthScale = 15; // float
    public vertexDensity = 30; // 1-40 int
    public clipLevels = 8; // 0-8 int
    public skirtSize = 10; // 0-100 float
    public noMaterialLod = true;
    public useSkirt = true;

    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;
    private _root: BABYLON.TransformNode;
    private _oceanMaterial: OceanMaterial;
    private _materials: BABYLON.Material[];
    private _trimRotations: BABYLON.Quaternion[];
    private _center: BABYLON.Mesh;
    private _skirt: BABYLON.Mesh;
    private _rings: BABYLON.Mesh[];
    private _trims: BABYLON.Mesh[];

    constructor(oceanMaterial: OceanMaterial, camera: BABYLON.Camera, scene: BABYLON.Scene) {
        this._oceanMaterial = oceanMaterial;
        this._camera = camera;
        this._scene = scene;
        this._materials = [];
        this._root = new BABYLON.TransformNode("Ocean", scene);
        this._center = null as any;
        this._skirt = null as any;
        this._rings = [];
        this._trims = [];

        this._trimRotations = [
            BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.UpReadOnly, BABYLON.Angle.FromDegrees(180).radians()),
            BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.UpReadOnly, BABYLON.Angle.FromDegrees(90).radians()),
            BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.UpReadOnly, BABYLON.Angle.FromDegrees(270).radians()),
            BABYLON.Quaternion.Identity(),
        ];
    }

    public get wireframe() {
        return this._center.material!.wireframe;
    }

    public set wireframe(w: boolean) {
        this._center.material!.wireframe = w;
        if (this._skirt) {
            this._skirt.material!.wireframe = w;
        }
        this._rings.forEach((m) => m.material!.wireframe = w);
        this._trims.forEach((m) => m.material!.wireframe = w);
    }

    public async initializeMaterials(): Promise<void> {
        this._materials[0]?.dispose();
        this._materials[1]?.dispose();
        this._materials[2]?.dispose();

        this._materials = [
            await this._oceanMaterial.getMaterial(true, true),
            await this._oceanMaterial.getMaterial(true, false),
            await this._oceanMaterial.getMaterial(false, false),
        ];
    }

    public initializeMeshes(): void {
        this._center?.dispose();
        this._skirt?.dispose();
        this._rings?.forEach((m) => m.dispose());
        this._trims?.forEach((m) => m.dispose());

        this._skirt = null as any;

        this._rings = [];
        this._trims = [];

        this._instantiateMeshes();
    }

    public update(): void {
        this._updatePositions();
        this._updateMaterials();
    }

    public getMaterial(index: number): BABYLON.Material {
        return this._materials[index];
    }

    private _updateMaterials(): void {
        const activeLevels = this._activeLodLevels;

        this._center.material = this._getMaterial(this.noMaterialLod ? 0 : this.clipLevels - activeLevels - 1);

        for (let i = 0; i < this._rings.length; i++) {
            this._rings[i].material = this._getMaterial(this.noMaterialLod ? 0 : this.clipLevels - activeLevels - i);
            this._trims[i].material = this._getMaterial(this.noMaterialLod ? 0 : this.clipLevels - activeLevels - i);
        }

        if (this.useSkirt) {
            this._skirt.material = this.noMaterialLod ? this._materials[0] : this._materials[2];
        }
    }

    private _updatePositions(): void {
        const k = this._gridSize;
        const activeLevels = this._activeLodLevels;

        let previousSnappedPosition = BABYLON.TmpVectors.Vector3[0];
        const centerOffset = BABYLON.TmpVectors.Vector3[1];
        const snappedPosition = BABYLON.TmpVectors.Vector3[2];
        const trimPosition = BABYLON.TmpVectors.Vector3[3];

        let scale = this._clipLevelScale(-1, activeLevels);

        previousSnappedPosition.copyFrom(this._camera.position);

        this._snap(previousSnappedPosition, scale * 2);
        this._offsetFromCenter(-1, activeLevels, centerOffset);

        this._center.position.copyFrom(previousSnappedPosition).addInPlace(centerOffset);
        this._center.scaling.set(scale, 1, scale);

        for (let i = 0; i < this.clipLevels; i++) {
            this._rings[i].setEnabled(i < activeLevels);
            this._trims[i].setEnabled(i < activeLevels);
            if (i >= activeLevels) {
                continue;
            }

            scale = this._clipLevelScale(i, activeLevels);

            snappedPosition.copyFrom(this._camera.position);

            this._snap(snappedPosition, scale * 2);
            this._offsetFromCenter(i, activeLevels, centerOffset);
    
            trimPosition.copyFrom(snappedPosition).addInPlace(centerOffset).addInPlaceFromFloats(scale * (k - 1) / 2, 0, scale * (k - 1) / 2);

            const shiftX = (previousSnappedPosition.x - snappedPosition.x) <= 0 ? 1 : 0;
            const shiftZ = (previousSnappedPosition.z - snappedPosition.z) <= 0 ? 1 : 0;
            
            trimPosition.x += shiftX * (k + 1) * scale;
            trimPosition.z += shiftZ * (k + 1) * scale;

            this._trims[i].position.copyFrom(trimPosition);
            this._trims[i].rotationQuaternion!.copyFrom(this._trimRotations[shiftX + 2 * shiftZ]);
            this._trims[i].scaling.set(scale, 1, scale);

            this._rings[i].position.copyFrom(snappedPosition).addInPlace(centerOffset);
            this._rings[i].scaling.set(scale, 1, scale);

            previousSnappedPosition.copyFrom(snappedPosition);
        }

        if (this.useSkirt) {
            scale = this.lengthScale * 2 * Math.pow(2, this.clipLevels);
            this._skirt.position.copyFrom(previousSnappedPosition).addInPlaceFromFloats(-scale * (this.skirtSize + 0.5 - 0.5 / k), 0, -scale * (this.skirtSize + 0.5 - 0.5 / k));
            this._skirt.scaling.set(scale, 1, scale);
        }
    }

    private get _activeLodLevels(): number {
        return this.clipLevels - BABYLON.Scalar.Clamp(Math.floor(Math.log2((1.7 * Math.abs(this._camera.position.y) + 1) / this.lengthScale)), 0, this.clipLevels);
    }

    private _clipLevelScale(level: number, activeLevels: number): number {
        return this.lengthScale / this._gridSize * Math.pow(2, this.clipLevels - activeLevels + level + 1);
    }

    private _offsetFromCenter(level: number, activeLevels: number, result: BABYLON.Vector3): void {
        const k = this._gridSize;
        const v = ((1 << this.clipLevels) + OceanGeometry._GeometricProgressionSum(2, 2, this.clipLevels - activeLevels + level + 1, this.clipLevels - 1)) * this.lengthScale / k * (k - 1) / 2;

        result.copyFromFloats(-v, 0, -v);
    }

    private static _GeometricProgressionSum(b0: number, q: number, n1: number, n2: number): number {
        return b0 / (1 - q) * (Math.pow(q, n2) - Math.pow(q, n1));
    }

    private _snap(coords: BABYLON.Vector3, scale: number): void {
        if (coords.x >= 0) {
            coords.x = Math.floor(coords.x / scale) * scale;
        } else {
            coords.x = Math.ceil((coords.x - scale + 1) / scale) * scale;
        }

        if (coords.z < 0) {
            coords.z = Math.floor(coords.z / scale) * scale;
        } else {
            coords.z = Math.ceil((coords.z - scale + 1) / scale) * scale;
        }

        coords.y = 0;
    }

    private _getMaterial(lodLevel: number): BABYLON.Material {
        if (lodLevel - 2 <= 0) {
            return this._materials[0];
        }

        if (lodLevel - 2 <= 2) {
            return this._materials[1];
        }

        return this._materials[2];
    }

    private get _gridSize() {
        return 4 * this.vertexDensity + 1;
    }

    private _instantiateMeshes(): void {
        const k = this._gridSize;

        this._center = this._instantiateElement("Center", this._createPlaneMesh(2 * k, 2 * k, 1, Seams.All), this._materials[this._materials.length - 1]);

        const ring = this._createRingMesh(k, 1);
        const trim = this._createTrimMesh(k, 1);

        for (let i = 0; i < this.clipLevels; ++i) {
            this._rings.push(this._instantiateElement("Ring " + i, ring, this._materials[this._materials.length - 1], i > 0));
            this._trims.push(this._instantiateElement("Trim " + i, trim, this._materials[this._materials.length - 1], i > 0));
        }

        if (this.useSkirt) {
            this._skirt = this._instantiateElement("Skirt", this._createSkirtMesh(k, this.skirtSize), this._materials[this._materials.length - 1]);
        }
    }

    private _instantiateElement(name: string, mesh: BABYLON.Mesh, mat: BABYLON.Material, clone = false): BABYLON.Mesh {
        if (clone) {
            mesh = mesh.clone("");
        }

        mesh.name = name;
        mesh.material = mat;
        mesh.parent = this._root;
        mesh.receiveShadows = true;

        return mesh;
    }

    private _createSkirtMesh(k: number, outerBorderScale: number): BABYLON.Mesh {
        const quad = this._createPlaneMesh(1, 1, 1);
        const hStrip = this._createPlaneMesh(k, 1, 1);
        const vStrip = this._createPlaneMesh(1, k, 1);


        const cornerQuadScale = new BABYLON.Vector3(outerBorderScale, 1, outerBorderScale);
        const midQuadScaleVert = new BABYLON.Vector3(1 / k, 1, outerBorderScale);
        const midQuadScaleHor = new BABYLON.Vector3(outerBorderScale, 1, 1 / k);

        const m1 = quad.clone();
        m1.scaling.copyFrom(cornerQuadScale);

        const m2 = hStrip.clone();
        m2.scaling.copyFrom(midQuadScaleVert);
        m2.position.x = outerBorderScale;

        const m3 = quad.clone();
        m3.scaling.copyFrom(cornerQuadScale);
        m3.position.x = outerBorderScale + 1;

        const m4 = vStrip.clone();
        m4.scaling.copyFrom(midQuadScaleHor);
        m4.position.z = outerBorderScale;

        const m5 = vStrip.clone();
        m5.scaling.copyFrom(midQuadScaleHor);
        m5.position.x = outerBorderScale + 1;
        m5.position.z = outerBorderScale;

        const m6 = quad.clone();
        m6.scaling.copyFrom(cornerQuadScale);
        m6.position.z = outerBorderScale + 1;

        const m7 = hStrip.clone();
        m7.scaling.copyFrom(midQuadScaleVert);
        m7.position.x = outerBorderScale;
        m7.position.z = outerBorderScale + 1;

        const m8 = quad.clone();
        m8.scaling.copyFrom(cornerQuadScale);
        m8.position.x = outerBorderScale + 1;
        m8.position.z = outerBorderScale + 1;

        quad.dispose(true, false);
        hStrip.dispose(true, false);
        vStrip.dispose(true, false);

        return BABYLON.Mesh.MergeMeshes([m1, m2, m3, m4, m5, m6, m7, m8], true, true)!;
    }

    private _createTrimMesh(k: number, lengthScale: number): BABYLON.Mesh {
        const m1 = this._createPlaneMesh(k + 1, 1, lengthScale, Seams.None, 1);
        m1.position.set((-k - 1) * lengthScale, 0, -1 * lengthScale);

        const m2 = this._createPlaneMesh(1, k, lengthScale, Seams.None, 1);
        m2.position.set(-1 * lengthScale, 0, (-k - 1) * lengthScale);

        const mesh = BABYLON.Mesh.MergeMeshes([m1, m2], true, true)!;
        mesh.rotationQuaternion = new BABYLON.Quaternion();

        return mesh;
    }

    private _createRingMesh(k: number, lengthScale: number): BABYLON.Mesh {
        const m1 = this._createPlaneMesh(2 * k, (k - 1) >> 1, lengthScale, Seams.Bottom | Seams.Right | Seams.Left);

        const m2 = this._createPlaneMesh(2 * k, (k - 1) >> 1, lengthScale, Seams.Top | Seams.Right | Seams.Left);
        m2.position.set(0, 0, (k + 1 + ((k - 1) >> 1)) * lengthScale);

        const m3 = this._createPlaneMesh((k - 1) >> 1, k + 1, lengthScale, Seams.Left);
        m3.position.set(0, 0, ((k - 1) >> 1) * lengthScale);

        const m4 = this._createPlaneMesh((k - 1) >> 1, k + 1, lengthScale, Seams.Right);
        m4.position.set((k + 1 + ((k - 1) >> 1)) * lengthScale, 0, ((k - 1) >> 1) * lengthScale);

        return BABYLON.Mesh.MergeMeshes([m1, m2, m3, m4], true, true)!;
    }

    private _createPlaneMesh(width: number, height: number, lengthScale: number, seams: Seams = Seams.None, trianglesShift = 0): BABYLON.Mesh {
        const vertices: number[] = [];
        const triangles: number[] = [];
        const normals: number[] = [];
        
        const vdata = new BABYLON.VertexData();

        vdata.positions = vertices;
        vdata.indices = triangles;
        vdata.normals = normals;

        for (let i = 0; i < height + 1; ++i) {
            for (let j = 0; j < width + 1; ++j) {
                let x = j, z = i;
                
                if (i === 0 && (seams & Seams.Bottom) || i === height && (seams & Seams.Top)) {
                    x = x & ~1;
                }
                if (j === 0 && (seams & Seams.Left) || j === width && (seams & Seams.Right)) {
                    z = z & ~1;
                }

                vertices[0 + j * 3 + i * (width + 1) * 3] = x * lengthScale;
                vertices[1 + j * 3 + i * (width + 1) * 3] = 0 * lengthScale;
                vertices[2 + j * 3 + i * (width + 1) * 3] = z * lengthScale;

                normals[0 + j * 3 + i * (width + 1) * 3] = 0;
                normals[1 + j * 3 + i * (width + 1) * 3] = 1;
                normals[2 + j * 3 + i * (width + 1) * 3] = 0;
            }
        }

        let tris = 0;
        for (let i = 0; i < height; ++i) {
            for (let j = 0; j < width; ++j) {
                const k = j + i * (width + 1);
                if ((i + j + trianglesShift) % 2 === 0) {
                    triangles[tris++] = k;
                    triangles[tris++] = k + width + 2;
                    triangles[tris++] = k + width + 1;

                    triangles[tris++] = k;
                    triangles[tris++] = k + 1;
                    triangles[tris++] = k + width + 2;
                } else {
                    triangles[tris++] = k;
                    triangles[tris++] = k + 1;
                    triangles[tris++] = k + width + 1;

                    triangles[tris++] = k + 1;
                    triangles[tris++] = k + width + 2;
                    triangles[tris++] = k + width + 1;
                }                
            }
        }

        const mesh = new BABYLON.Mesh("Clipmap plane", this._scene);

        vdata.applyToMesh(mesh, true);

        return mesh;
    }
}



const foamPicture = "https://assets.babylonjs.com/environments/waterFoam_circular_mask.png";

class OceanMaterial {

    private _wavesGenerator: WavesGenerator;
    private _depthRenderer: BABYLON.DepthRenderer;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;
    private _foamTexture: BABYLON.Texture;
    private _startTime: number;

    constructor(depthRenderer: BABYLON.DepthRenderer, scene: BABYLON.Scene) {
        this._wavesGenerator = null as any;
        this._depthRenderer = depthRenderer;
        this._scene = scene;
        this._camera = scene.activeCameras?.[0] ?? scene.activeCamera!;
        this._foamTexture = new BABYLON.Texture(foamPicture, this._scene);
        this._startTime = new Date().getTime() / 1000;
    }

    public setWavesGenerator(wavesGenerator: WavesGenerator): void {
        this._wavesGenerator = wavesGenerator;
    }

    public readMaterialParameter(mat: BABYLON.PBRCustomMaterial, name: string): any {
        const tmp = new BABYLON.Color3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split('-');
            let val = mat._newUniformInstances[param];
            if (pname === name) {
                if (ptype === "vec3") {
                    // all vec3 types are color in the shader
                    val = val as BABYLON.Vector3;
                    tmp.copyFromFloats(val.x, val.y, val.z);
                    tmp.toGammaSpaceToRef(tmp);
                    val = tmp.toHexString();
                }
                return val;
            }
        }
        return null;
    }

    public updateMaterialParameter(mat: BABYLON.PBRCustomMaterial, name: string, value: any): void {
        const tmp = new BABYLON.Vector3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split('-');
            if (pname === name) {
                if (ptype === "vec3") {
                    // all vec3 types are color in the shader
                    value = BABYLON.Color3.FromHexString(value);
                    value = value.toLinearSpaceToRef(value);
                    tmp.copyFromFloats(value.r, value.g, value.b);
                    value = tmp;
                }
                mat._newUniformInstances[param] = value;
                return;
            }
        }
    }

    public async getMaterial(useMid: boolean, useClose: boolean, useNodeMaterial = false): Promise<BABYLON.Material> {
        let mat: BABYLON.NodeMaterial | BABYLON.PBRCustomMaterial;

        if (!useNodeMaterial) {

            mat = new BABYLON.PBRCustomMaterial("oceanMat" + (useMid ? "1" : "0") + (useClose ? "1" : "0"), this._scene);

            mat.metallic = 0;
            mat.roughness = 0.311;
            mat.forceIrradianceInFragment = true;
            //mat.realTimeFiltering = true;
            //mat.realTimeFilteringQuality = BABYLON.Constants.TEXTURE_FILTERING_QUALITY_HIGH;
            //mat.wireframe = true;

            const color = new BABYLON.Vector3(0.011126082368383245, 0.05637409755197975, 0.09868919754109445);

            mat.AddUniform("_Color", "vec3", color);
            mat.AddUniform("_MaxGloss", "float", 0.91);
            mat.AddUniform("_RoughnessScale", "float", 0.0044);
            mat.AddUniform("_LOD_scale", "float", 7.13);

            mat.AddUniform("_FoamColor", "vec3", new BABYLON.Vector3(1, 1, 1));
            mat.AddUniform("_FoamScale", "float", 2.4);
            mat.AddUniform("_ContactFoam", "float", 1);
            mat.AddUniform("_FoamBiasLOD0", "float", 0.84);
            mat.AddUniform("_FoamBiasLOD1", "float", 1.83);
            mat.AddUniform("_FoamBiasLOD2", "float", 2.72);

            mat.AddUniform("_SSSColor", "vec3", new BABYLON.Vector3(0.1541919, 0.8857628, 0.990566));
            mat.AddUniform("_SSSStrength", "float", 0.15);
            mat.AddUniform("_SSSBase", "float", -0.261);
            mat.AddUniform("_SSSScale", "float", 4.7);

            mat.AddUniform("lightDirection", "vec3", "");
            mat.AddUniform("_WorldSpaceCameraPos", "vec3", "");
            mat.AddUniform("LengthScale0", "float", this._wavesGenerator.lengthScale[0]);
            mat.AddUniform("LengthScale1", "float", this._wavesGenerator.lengthScale[1]);
            mat.AddUniform("LengthScale2", "float", this._wavesGenerator.lengthScale[2]);
            mat.AddUniform("_Displacement_c0", "sampler2D", this._wavesGenerator.getCascade(0).displacement);
            mat.AddUniform("_Derivatives_c0", "sampler2D", this._wavesGenerator.getCascade(0).derivatives);
            mat.AddUniform("_Turbulence_c0", "sampler2D", this._wavesGenerator.getCascade(0).turbulence);
            mat.AddUniform("_Displacement_c1", "sampler2D", this._wavesGenerator.getCascade(1).displacement);
            mat.AddUniform("_Derivatives_c1", "sampler2D", this._wavesGenerator.getCascade(1).derivatives);
            mat.AddUniform("_Turbulence_c1", "sampler2D", this._wavesGenerator.getCascade(1).turbulence);
            mat.AddUniform("_Displacement_c2", "sampler2D", this._wavesGenerator.getCascade(2).displacement);
            mat.AddUniform("_Derivatives_c2", "sampler2D", this._wavesGenerator.getCascade(2).derivatives);
            mat.AddUniform("_Turbulence_c2", "sampler2D", this._wavesGenerator.getCascade(2).turbulence);
            mat.AddUniform("_Time", "float", 0);
            mat.AddUniform("_CameraDepthTexture", "sampler2D", this._depthRenderer.getDepthMap());
            mat.AddUniform("_CameraData", "vec4", new BABYLON.Vector4(this._camera.minZ, this._camera.maxZ, this._camera.maxZ - this._camera.minZ, 0));
            mat.AddUniform("_FoamTexture", "sampler2D", this._foamTexture);

            const cascades = [];
            if (useMid) {
                cascades.push("#define MID");
            }
            if (useClose) {
                cascades.push("#define CLOSE");
            }

            mat.Vertex_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
            `);

            mat.Fragment_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
            `);

            mat.Vertex_After_WorldPosComputed(`
                vWorldUV = worldPos.xz;
            
                vViewVector = _WorldSpaceCameraPos - worldPos.xyz;
                float viewDist = length(vViewVector);
            
                float lod_c0 = min(_LOD_scale * LengthScale0 / viewDist, 1.0);
                float lod_c1 = min(_LOD_scale * LengthScale1 / viewDist, 1.0);
                float lod_c2 = min(_LOD_scale * LengthScale2 / viewDist, 1.0);
                    
                vec3 displacement = vec3(0.);
                float largeWavesBias = 0.;
            
                vUVCoords_c0 = vWorldUV / LengthScale0;
                vUVCoords_c1 = vWorldUV / LengthScale1;
                vUVCoords_c2 = vWorldUV / LengthScale2;
            
                displacement += texture2D(_Displacement_c0, vUVCoords_c0).xyz * lod_c0;
                largeWavesBias = displacement.y;
            
                #if defined(MID) || defined(CLOSE)
                    displacement += texture2D(_Displacement_c1, vUVCoords_c1).xyz * lod_c1;
                #endif
                #if defined(CLOSE)
                    displacement += texture2D(_Displacement_c2, vUVCoords_c2).xyz * lod_c2;
                #endif
    
                worldPos.xyz += displacement;

                vLodScales = vec4(lod_c0, lod_c1, lod_c2, max(displacement.y - largeWavesBias * 0.8 - _SSSBase, 0) / _SSSScale);
            `);

            mat.Vertex_MainEnd(`
                vClipCoords = gl_Position;
                vMetric = gl_Position.z;
            `);

            mat.Fragment_Before_Lights(`
                vec4 derivatives = texture2D(_Derivatives_c0, vUVCoords_c0);
                #if defined(MID) || defined(CLOSE)
                    derivatives += texture2D(_Derivatives_c1, vUVCoords_c1) * vLodScales.y;
                #endif
                #if defined(CLOSE)
                    derivatives += texture2D(_Derivatives_c2, vUVCoords_c2) * vLodScales.z;
                #endif

                vec2 slope = vec2(derivatives.x / (1.0 + derivatives.z), derivatives.y / (1.0 + derivatives.w));
                normalW = normalize(vec3(-slope.x, 1.0, -slope.y));

                #if defined(CLOSE)
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x + texture2D(_Turbulence_c1, vUVCoords_c1).x + texture2D(_Turbulence_c2, vUVCoords_c2).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD2) * _FoamScale));
                #elif defined(MID)
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x + texture2D(_Turbulence_c1, vUVCoords_c1).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD1) * _FoamScale));
                #else
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD0) * _FoamScale));
                #endif

                vec2 screenUV = vClipCoords.xy / vClipCoords.w;
                screenUV = screenUV * 0.5 + 0.5;
                float backgroundDepth = texture2D(_CameraDepthTexture, screenUV).r * _CameraData.y;
                float surfaceDepth = vMetric;
                float depthDifference = max(0.0, (backgroundDepth - surfaceDepth) - 0.5);
                float foam = texture2D(_FoamTexture, vWorldUV * 0.5 + _Time * 2.).r;
                jacobian += _ContactFoam * saturate(max(0.0, foam - depthDifference) * 5.0) * 0.9;
    
                surfaceAlbedo = mix(vec3(0.0), _FoamColor, jacobian);

                vec3 viewDir = normalize(vViewVector);
                vec3 H = normalize(-normalW + lightDirection);
                float ViewDotH = pow5(saturate(dot(viewDir, -H))) * 30.0 * _SSSStrength;
                vec3 color = mix(_Color, saturate(_Color + _SSSColor.rgb * ViewDotH * vLodScales.w), vLodScales.z);
    
                float fresnel = dot(normalW, viewDir);
                fresnel = saturate(1.0 - fresnel);
                fresnel = pow5(fresnel);
            `);

            mat.Fragment_Custom_MetallicRoughness(`
                float distanceGloss = mix(1.0 - metallicRoughness.g, _MaxGloss, 1.0 / (1.0 + length(vViewVector) * _RoughnessScale));
                metallicRoughness.g = 1.0 - mix(distanceGloss, 0.0, jacobian);
            `);

            mat.Fragment_Before_FinalColorComposition(`
                finalEmissive = mix(color * (1.0 - fresnel), vec3(0.0), jacobian);
            `);

            mat.Fragment_Before_FragColor(`
                //finalColor = vec4(toGammaSpace((normalW + vec3(1.)) / vec3(2.)), 1.);
                //finalColor = vec4(vec3(surfaceDepth), 1.);
            `);

            mat.onBindObservable.add(() => {
                const time = ((new Date().getTime() / 1000) - this._startTime) / 10;

                mat.getEffect()?.setVector3("_WorldSpaceCameraPos", this._camera.position);
                mat.getEffect()?.setTexture("_Turbulence_c0", this._wavesGenerator.getCascade(0).turbulence);
                mat.getEffect()?.setTexture("_Turbulence_c1", this._wavesGenerator.getCascade(1).turbulence);
                mat.getEffect()?.setTexture("_Turbulence_c2", this._wavesGenerator.getCascade(2).turbulence);
                mat.getEffect()?.setFloat("_Time", time);
                mat.getEffect()?.setVector3("lightDirection", (this._scene.lights[0] as BABYLON.DirectionalLight).direction);
            });

            return new Promise((resolve) => {
                if (this._foamTexture.isReady()) {
                    resolve(mat);
                } else {
                    this._foamTexture.onLoadObservable.addOnce(() => {
                        resolve(mat);
                    });
                }
            });
        } else {
            mat = await BABYLON.NodeMaterial.ParseFromSnippetAsync("R4152I#24", this._scene);

            mat.getInputBlockByPredicate((b) => b.name === "LOD_scale")!.value = 7.13;
            mat.getInputBlockByPredicate((b) => b.name === "LengthScale0")!.value = this._wavesGenerator.lengthScale[0];
            mat.getInputBlockByPredicate((b) => b.name === "Roughness")!.value = 0.311;
            mat.getInputBlockByPredicate((b) => b.name === "metallic")!.value = 0;
            (mat.getBlockByName("Displacement_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).displacement as BABYLON.Texture;
            (mat.getBlockByName("Derivatives_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).derivatives as BABYLON.Texture;

            //(mat.getBlockByName("PBRMetallicRoughness") as BABYLON.PBRMetallicRoughnessBlock).realTimeFiltering = true;

            mat.build();
        }

        return mat;
    }
}





class SkyBox {

    private _procedural: boolean;
    private _scene: BABYLON.Scene;
    private _skybox: BABYLON.Mesh;
    private _skyMaterial: BABYLON.SkyMaterial;
    private _probe: BABYLON.ReflectionProbe;
    private _oldSunPosition: BABYLON.Vector3;
    private _skyboxObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;
    private _dirty: boolean;
    private _dirtyCount: number;
    private _needPolynomialsRegen: boolean;

    public get probe(): BABYLON.Nullable<BABYLON.ReflectionProbe> {
        return this._probe;
    }

    public get skyMaterial() {
        return this._skyMaterial;
    }

    public setAsDirty(): void {
        this._dirty = true;
        this._dirtyCount = 2;
        this._probe.cubeTexture.refreshRate = 1;
        this._needPolynomialsRegen = true;
    }

    constructor(useProcedural: boolean, scene: BABYLON.Scene) {
        this._procedural = useProcedural;
        this._scene = scene;
        this._oldSunPosition = new BABYLON.Vector3();
        this._skyMaterial = null as any;
        this._probe = null as any;
        this._dirty = false;
        this._dirtyCount = 0;
        this._needPolynomialsRegen = false;

        this._skybox = BABYLON.MeshBuilder.CreateBox("skyBox", {size: 1000.0, sideOrientation: BABYLON.Mesh.BACKSIDE}, this._scene);

        // put the skybox first in the list
        scene.meshes.splice(scene.meshes.indexOf(this._skybox), 1);
        scene.meshes.splice(0, 0, this._skybox);

        this._skyboxObserver = scene.onBeforeRenderObservable.add(() => {
            this._skybox.position = scene.activeCameras?.[0].position ?? scene.activeCamera!.position;
        });

        if (useProcedural) {
            this._initProceduralSkybox();
        } else {
            this._initSkybox();
        }

        this.setAsDirty();
    }

    public update(light: BABYLON.ShadowLight): boolean {
        if (!this._procedural) {
            return false;
        }

        let ret = false;

        const texture = this._probe.cubeTexture.getInternalTexture()!;

        if (!this._oldSunPosition.equals(this._skyMaterial.sunPosition) || this._dirty) {
            this._oldSunPosition.copyFrom(this._skyMaterial.sunPosition);
            light.position = this._skyMaterial.sunPosition.clone();
            light.direction = this._skyMaterial.sunPosition.negate().normalize();
            light.diffuse = (this._skyMaterial as any).getSunColor().toLinearSpace();
            if (this._dirtyCount-- === 0) {
                this._dirty = false;
                this._probe.cubeTexture.refreshRate = 0;
            }
            ret = true;
        }
        if (!this._dirty && this._needPolynomialsRegen && texture._sphericalPolynomialComputed) {
            this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
            this._needPolynomialsRegen = false;
        }

        return ret;
    }

    public dispose(): void {
        this._scene.onBeforeRenderObservable.remove(this._skyboxObserver);
        this._scene.customRenderTargets = [];

        if (this._procedural) {
            this._probe.dispose();
        } else {
            this._scene.environmentTexture?.dispose();
            (this._skybox.material as BABYLON.StandardMaterial).reflectionTexture?.dispose();
        }

        this._skybox.material!.dispose();
        this._skybox.dispose();
        this._scene.environmentTexture = null;
    }

    private _initProceduralSkybox(): void {
        this._skyMaterial = new BABYLON.SkyMaterial('sky', this._scene);
        this._skybox.material = this._skyMaterial;
        this._skybox.material.disableDepthWrite = true;

        this._skyMaterial.azimuth = 0.307;
        this._skyMaterial.inclination = 0.0;
    
        // Reflection probe
        this._probe = new BABYLON.ReflectionProbe('skyProbe', 128, this._scene, true, true, true);
        this._probe.renderList!.push(this._skybox);

        this._probe.attachToMesh(this._skybox);
        this._probe.cubeTexture.activeCamera = this._scene.activeCameras?.[0] ?? this._scene.activeCamera!;
        this._probe.cubeTexture.refreshRate = 0;

        this._probe.cubeTexture.onAfterUnbindObservable.add(() => {
            const texture = this._probe.cubeTexture.getInternalTexture()!;
            if (texture._sphericalPolynomialComputed) {
                // the previous computation is finished, we can start a new one
                this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
                this._needPolynomialsRegen = false;
            } else {
                this._needPolynomialsRegen = true;
            }
        });

        this._scene.environmentTexture = this._probe.cubeTexture;
        this._scene.customRenderTargets.push(this._probe.cubeTexture);
    }

    private _initSkybox(): void {
        //const reflectionTexture = BABYLON.CubeTexture.CreateFromPrefilteredData("https://assets.babylonjs.com/environments/environmentSpecular.env", scene);
        const reflectionTexture = new BABYLON.HDRCubeTexture('https://popov72.github.io/BabylonDev/resources/webgpu/oceanDemo/0c03bd6e3c9d04da0cf428bbf487bf68.hdr', this._scene, 256, false, true, false, true);

        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this._scene);
        skyboxMaterial.disableDepthWrite = true;
        skyboxMaterial.reflectionTexture = reflectionTexture.clone();
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

        this._skybox.material = skyboxMaterial;

        this._scene.environmentTexture = reflectionTexture;
    }
}


interface BuoyancyFrame {
    v1: BABYLON.Vector3;
    v2?: BABYLON.Vector3;
    v3?: BABYLON.Vector3;
}

interface MeshBuoyancy {
    mesh: BABYLON.TransformNode;
    frame: BuoyancyFrame;
    yOffset: number;
    spaceCoordinates: number;
    initQuaternion: BABYLON.Quaternion;
    curQuaternion:  BABYLON.Quaternion;
    stepQuaternion:  BABYLON.Quaternion;
    curStep: number;
}

class Buoyancy {

    private _size: number;
    private _displacementMap: BABYLON.Nullable<Uint16Array>;
    private _lengthScale: number;
    private _meshes: MeshBuoyancy[];
    private _numSteps: number;
    private _attenuation: number;

    public enabled = true;

    constructor(size: number, numSteps: number = 5, attenuation: number = 1) {
        this._size = size;
        this._displacementMap = null;
        this._lengthScale = 0;
        this._numSteps = numSteps;
        this._attenuation = attenuation;
        this._meshes = [];
    }

    public setWaterHeightMap(map: BABYLON.Nullable<Uint16Array>, lengthScale: number): void {
        this._displacementMap = map;
        this._lengthScale = lengthScale;
    }

    public addMesh(mesh: BABYLON.TransformNode, frame: BuoyancyFrame, yOffset = 0, spaceCoordinates = 0): void {
        this._meshes.push({ mesh, frame, yOffset, spaceCoordinates, initQuaternion: mesh.rotationQuaternion!.clone(), curStep: 0, curQuaternion: new BABYLON.Quaternion(), stepQuaternion: new BABYLON.Quaternion() });
    }

    public set size(size: number) {
        this._size = size;
    }

    public get attenuation() {
        return this._attenuation;
    }

    public set attenuation(val: number) {
        this._attenuation = val;
    }

    public get numSteps() {
        return this._numSteps;
    }

    public set numSteps(val: number) {
        this._numSteps = val;
    }

    public update(): void {
        if (!this.enabled) {
            return;
        }

        for (let i = 0; i < this._meshes.length; ++i) {
            this._updateMesh(this._meshes[i]);
        }
    }

    public getWaterHeight(position: BABYLON.Vector3): number {
        const tmp = BABYLON.TmpVectors.Vector3[0];

        this._getWaterDisplacement(position, tmp);
        position.subtractToRef(tmp, tmp);
        this._getWaterDisplacement(position, tmp);
        position.subtractToRef(tmp, tmp);
        this._getWaterDisplacement(position, tmp);
        position.subtractToRef(tmp, tmp);
        this._getWaterDisplacement(position, tmp);

        return tmp.y;
    }

    private _updateMesh(meshBuoyancy: MeshBuoyancy): void {
        const tmp = BABYLON.TmpVectors.Vector3[5];
        const tmp2 = BABYLON.TmpVectors.Vector3[6];
        const tmp3 = BABYLON.TmpVectors.Vector3[7];
        const forward = BABYLON.TmpVectors.Vector3[8];
        const right = BABYLON.TmpVectors.Vector3[9];
        const normal = BABYLON.TmpVectors.Vector3[10];
        const forwardU = BABYLON.TmpVectors.Vector3[11];
        const rightU = BABYLON.TmpVectors.Vector3[12];

        const { mesh, frame, yOffset, spaceCoordinates, initQuaternion, curQuaternion, stepQuaternion, curStep } = meshBuoyancy;

        BABYLON.Vector3.TransformCoordinatesToRef(frame.v1, mesh.getWorldMatrix(), tmp);

        const y = this.getWaterHeight(tmp);

        mesh.position.y = y + yOffset;

        if (frame.v2 && frame.v3) {
            if (curStep < this._numSteps) {
                meshBuoyancy.curStep++;
                curQuaternion.multiplyToRef(stepQuaternion, curQuaternion);
                initQuaternion.multiplyToRef(curQuaternion, mesh.rotationQuaternion!);
                return;
            }

            BABYLON.Vector3.TransformCoordinatesToRef(frame.v2, mesh.getWorldMatrix(), tmp2);
            tmp2.subtractToRef(tmp, forwardU);
            forwardU.normalize();

            BABYLON.Vector3.TransformCoordinatesToRef(frame.v3, mesh.getWorldMatrix(), tmp3);
            tmp3.subtractToRef(tmp, rightU);
            rightU.normalize();

            tmp.y = y;

            forward.copyFrom(tmp2);
            forward.y = this.getWaterHeight(tmp2);
            forward.subtractToRef(tmp, forward);
            forward.normalize();

            right.copyFrom(tmp3);
            right.y = this.getWaterHeight(tmp3);
            right.subtractToRef(tmp, right);
            right.normalize();

            BABYLON.Vector3.CrossToRef(right, forward, normal);
            BABYLON.Vector3.CrossToRef(forward, normal, right);

            right.normalize();

            let xa = Math.acos(BABYLON.Scalar.Clamp(BABYLON.Vector3.Dot(forwardU, forward), 0, 1)) * this._attenuation;

            let za = Math.acos(BABYLON.Scalar.Clamp(BABYLON.Vector3.Dot(rightU, right), 0, 1)) * this._attenuation;

            switch (spaceCoordinates) {
                case 0:
                    if (forward.y > forwardU.y) xa = -xa;
                    if (right.y > rightU.y) za = -za;
                    BABYLON.Quaternion.FromEulerAnglesToRef(xa / this._numSteps, za / this._numSteps, 0, meshBuoyancy.stepQuaternion);
                    break;
                case 1:
                    if (forward.y > forwardU.y) xa = -xa;
                    if (right.y < rightU.y) za = -za;
                    BABYLON.Quaternion.FromEulerAnglesToRef(xa / this._numSteps, 0, za / this._numSteps, meshBuoyancy.stepQuaternion);
                    break;
                case 2:
                    if (forward.y > forwardU.y) xa = -xa;
                    if (right.y > rightU.y) za = -za;
                    BABYLON.Quaternion.FromEulerAnglesToRef(xa / this._numSteps, 0, za / this._numSteps, meshBuoyancy.stepQuaternion);
                    break;
            }

            meshBuoyancy.curStep = 0;
        }
    }

    private _getWaterDisplacement(position: BABYLON.Vector3, result: BABYLON.Vector3): void {
        if (!this._displacementMap) {
            result.set(position.x, position.y, position.z);
            return;
        }

        // Sample the displacement map bilinearly
        const mask = this._size - 1;

        const x = (position.x / this._lengthScale) * this._size;
        const z = (position.z / this._lengthScale) * this._size;

        const v0 = BABYLON.TmpVectors.Vector3[1];
        const v1 = BABYLON.TmpVectors.Vector3[2];
        const vA = BABYLON.TmpVectors.Vector3[3];
        const vB = BABYLON.TmpVectors.Vector3[4];

        let v0x = Math.floor(x);
        let v0z = Math.floor(z);

        const xRatio = x - v0x;
        const zRatio = z - v0z;

        v0x = v0x & mask;
        v0z = v0z & mask;

        this._getDisplacement(v0x, v0z, v0);
        this._getDisplacement((v0x + 1) & mask, v0z, v1);

        v1.subtractToRef(v0, vA).scaleToRef(xRatio, vA).addToRef(v0, vA);

        this._getDisplacement(v0x, (v0z + 1) & mask, v0);
        this._getDisplacement((v0x + 1) & mask, (v0z + 1) & mask, v1);

        v1.subtractToRef(v0, vB).scaleToRef(xRatio, vB).addToRef(v0, vB);

        vB.subtractToRef(vA, result).scaleToRef(zRatio, result).addToRef(vA, result);
    }

    private _getDisplacement(x: number, z: number, result: BABYLON.Vector3): void {
        if (this._displacementMap) {
            result.x = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 0]);
            result.y = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 1]);
            result.z = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 2]);
        }
    }

}



interface DisplaySpectrumSettings {
    //[Range(0, 1)]
    scale: number;
    windSpeed: number;
    windDirection: number;
    fetch: number;
    //[Range(0, 1)]
    spreadBlend: number;
    //[Range(0, 1)]
    swell: number;
    peakEnhancement: number;
    shortWavesFade: number;
}

interface SpectrumSettings {
    scale: number;
    angle: number;
    spreadBlend: number;
    swell: number;
    alpha: number;
    peakOmega: number;
    gamma: number;
    shortWavesFade: number;
}

class WavesSettings {

    public g = 9.81;
    public depth = 3;

    //[Range(0, 1)]
    public lambda = 1;
    public local: DisplaySpectrumSettings = {
        scale: 0.5,
        windSpeed: 1.5,
        windDirection: -29.81,
        fetch: 100000,
        spreadBlend: 1,
        swell: 0.198,
        peakEnhancement: 3.3,
        shortWavesFade: 0.01,
    };
    public swell: DisplaySpectrumSettings = {
        scale: 0.5,
        windSpeed: 1.5,
        windDirection: 90,
        fetch: 300000,
        spreadBlend: 1,
        swell: 1,
        peakEnhancement: 3.3,
        shortWavesFade: 0.01,
    };

    private spectrums: SpectrumSettings[] = [{
        scale: 0,
        angle: 0,
        spreadBlend: 0,
        swell: 0,
        alpha: 0,
        peakOmega: 0,
        gamma: 0,
        shortWavesFade: 0,
    }, {
        scale: 0,
        angle: 0,
        spreadBlend: 0,
        swell: 0,
        alpha: 0,
        peakOmega: 0,
        gamma: 0,
        shortWavesFade: 0,
    }];

    public setParametersToShader(params: BABYLON.UniformBuffer, spectrumParameters: BABYLON.StorageBuffer): void {
        params.updateFloat("GravityAcceleration", this.g);
        params.updateFloat("Depth", this.depth);

        this._fillSettingsStruct(this.local, this.spectrums[0]);
        this._fillSettingsStruct(this.swell, this.spectrums[1]);

        const buffer: number[] = [];
        this._linearizeSpectrumSetting(this.spectrums[0], buffer);
        this._linearizeSpectrumSetting(this.spectrums[1], buffer);
        
        spectrumParameters.update(buffer);
    }

    private _linearizeSpectrumSetting(spectrum: SpectrumSettings, buffer: number[]): void {
        buffer.push(
            spectrum.scale,
            spectrum.angle,
            spectrum.spreadBlend,
            spectrum.swell,
            spectrum.alpha,
            spectrum.peakOmega,
            spectrum.gamma,
            spectrum.shortWavesFade,
        );
    }

    private _fillSettingsStruct(display: DisplaySpectrumSettings, settings: SpectrumSettings): void {
        settings.scale = display.scale;
        settings.angle = display.windDirection / 180 * Math.PI;
        settings.spreadBlend = display.spreadBlend;
        settings.swell = BABYLON.Scalar.Clamp(display.swell, 0.01, 1);
        settings.alpha = this._JonswapAlpha(this.g, display.fetch, display.windSpeed);
        settings.peakOmega = this._JonswapPeakFrequency(this.g, display.fetch, display.windSpeed);
        settings.gamma = display.peakEnhancement;
        settings.shortWavesFade = display.shortWavesFade;
    }

    private _JonswapAlpha(g: number, fetch: number, windSpeed: number): number {
        return 0.076 * Math.pow(g * fetch / windSpeed / windSpeed, -0.22);
    }

    private _JonswapPeakFrequency(g: number, fetch: number, windSpeed: number): number {
        return 22 * Math.pow(windSpeed * fetch / g / g, -0.33);
    }    
}



class WavesGenerator {
    public lengthScale: number[];

    private _engine: BABYLON.Engine;
    private _startTime: number;
    private _rttDebug: RTTDebug;
    private _fft: FFT;
    private _noise: BABYLON.Texture;
    private _cascades: WavesCascade[];
    private _displacementMap: BABYLON.Nullable<Uint16Array>;
    private _wavesSettings: WavesSettings;

    public getCascade(num: number) {
        return this._cascades[num];
    }

    public get waterHeightMap() {
        return this._displacementMap;
    }

    public get waterHeightMapScale() {
        return this.lengthScale[0];
    }

    constructor(size: number, wavesSettings: WavesSettings, scene: BABYLON.Scene, rttDebug: RTTDebug, noise: BABYLON.Nullable<ArrayBuffer>) {
        this._engine = scene.getEngine();
        this._rttDebug = rttDebug;
        this._startTime = new Date().getTime() / 1000;
        this._displacementMap = null;
        this._wavesSettings = wavesSettings;

        this._fft = new FFT(scene.getEngine(), scene, this._rttDebug, 1, size);
        this._noise = this._generateNoiseTexture(size, noise);

        this._rttDebug.setTexture(0, "noise", this._noise);

        this.lengthScale = [250, 17, 5];

        this._cascades = [
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 2, this._engine),
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 12, this._engine),
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 22, this._engine),
        ];

        this.initializeCascades();
    }

    public initializeCascades(): void {
        let boundary1 = 0.0001;
        for (let i = 0; i < this.lengthScale.length; ++i) {
            let boundary2 = i < this.lengthScale.length - 1 ?  2 * Math.PI / this.lengthScale[i + 1] * 6 : 9999;
            this._cascades[i].calculateInitials(this._wavesSettings, this.lengthScale[i], boundary1, boundary2);
            boundary1 = boundary2;
        }
    }

    public update(): void {
        const time = (new Date().getTime() / 1000) - this._startTime;
        for (let i = 0; i < this._cascades.length; ++i) {
            this._cascades[i].calculateWavesAtTime(time);
        }
        this._getDisplacementMap();
    }

    public dispose(): void {
        for (let i = 0; i < this._cascades.length; ++i) {
            this._cascades[i].dispose();
        }
        this._noise.dispose();
        this._fft.dispose();
    }

    private _getDisplacementMap(): void {
        this._cascades[0].displacement.readPixels(undefined, undefined, undefined, undefined, true)?.then((buffer: ArrayBufferView) => {
            this._displacementMap = new Uint16Array(buffer.buffer);
        });
    }

    private _normalRandom(): number {
        return Math.cos(2 * Math.PI * Math.random()) * Math.sqrt(-2 * Math.log(Math.random()));
    }

    private _generateNoiseTexture(size: number, noiseBuffer: BABYLON.Nullable<ArrayBuffer>): BABYLON.Texture {
        const numChannels = noiseBuffer ? 4 : 2;
        const data = new Float32Array(size * size * numChannels);

        if (noiseBuffer) {
            const buf = new Uint8Array(noiseBuffer);
            const tmpUint8 = new Uint8Array(4);
            const tmpFloat = new Float32Array(tmpUint8.buffer, 0, 1);

            let offset = 0x094b;
            let dataOffset = 0;
            for (let j = 0; j < 256; ++j) {
                offset += 8;
                offset += 256 * 4; // A channel
                offset += 256 * 4; // B channel
                for (let i = 0; i < 256; ++i) { // G channel
                    tmpUint8[0] = buf[offset++];
                    tmpUint8[1] = buf[offset++];
                    tmpUint8[2] = buf[offset++];
                    tmpUint8[3] = buf[offset++];
                    data[dataOffset + 1 + i * 4] = tmpFloat[0];
                }
                for (let i = 0; i < 256; ++i) { // R channel
                    tmpUint8[0] = buf[offset++];
                    tmpUint8[1] = buf[offset++];
                    tmpUint8[2] = buf[offset++];
                    tmpUint8[3] = buf[offset++];
                    data[dataOffset + 0 + i * 4] = tmpFloat[0];
                }
                for (let i = 0; i < 256; ++i) { // A channel
                    data[dataOffset + 3 + i * 4] = 1;
                }
                dataOffset += 256 * 4;
            }
        } else {
            for (let i = 0; i < size; ++i) {
                for (let j = 0; j < size; ++j) {
                    data[j * size * 2 + i * 2 + 0] = this._normalRandom();
                    data[j * size * 2 + i * 2 + 1] = this._normalRandom();
                }
            }
        }

        const noise = new BABYLON.RawTexture(data, size, size, numChannels === 2 ? BABYLON.Constants.TEXTUREFORMAT_RG : BABYLON.Constants.TEXTUREFORMAT_RGBA, this._engine, false, false, BABYLON.Constants.TEXTURE_NEAREST_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_FLOAT);
        noise.name = "noise";

        return noise;
    }
}



class WavesCascade {

    private _engine: BABYLON.Engine;
    private _size: number;
    private _fft: FFT;
    private _initialSpectrum: InitialSpectrum;
    private _lambda: number;

    private _timeDependentSpectrum: BABYLON.ComputeShader;
    private _timeDependentSpectrumParams: BABYLON.UniformBuffer;
    private _buffer: BABYLON.BaseTexture;
    private _DxDz: BABYLON.BaseTexture;
    private _DyDxz: BABYLON.BaseTexture;
    private _DyxDyz: BABYLON.BaseTexture;
    private _DxxDzz: BABYLON.BaseTexture;

    private _texturesMerger: BABYLON.ComputeShader;
    private _texturesMergerParams: BABYLON.UniformBuffer;
    private _displacement: BABYLON.BaseTexture;
    private _derivatives: BABYLON.BaseTexture;
    private _turbulence: BABYLON.BaseTexture;
    private _turbulence2: BABYLON.BaseTexture;
    private _pingPongTurbulence: boolean;

    public get displacement() {
        return this._displacement;
    }

    public get derivatives() {
        return this._derivatives;
    }

    public get turbulence() {
        return this._pingPongTurbulence ? this._turbulence2 : this._turbulence;
    }

    constructor(size: number, gaussianNoise: BABYLON.BaseTexture, fft: FFT, rttDebug: RTTDebug, debugFirstIndex: number, engine: BABYLON.Engine) {
        this._engine = engine;
        this._size = size;
        this._fft = fft;
        this._lambda = 0;
        this._pingPongTurbulence = false;

        this._initialSpectrum = new InitialSpectrum(engine, rttDebug, debugFirstIndex, size, gaussianNoise);

        this._timeDependentSpectrum = new BABYLON.ComputeShader("timeDependentSpectrumCS", this._engine, { computeSource: timeDependentSpectrumCS }, {
            bindingsMapping: {
                "H0": { group: 0, binding: 1 },
                "WavesData": { group: 0, binding: 3 },
                "params": { group: 0, binding: 4 },
                "DxDz": { group: 0, binding: 5 },
                "DyDxz": { group: 0, binding: 6 },
                "DyxDyz": { group: 0, binding: 7 },
                "DxxDzz": { group: 0, binding: 8 },
            },
            entryPoint: "calculateAmplitudes"
        });

        this._buffer = ComputeHelper.CreateStorageTexture("buffer", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RG);

        this._DxDz = ComputeHelper.CreateStorageTexture("DxDz", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RG);
        this._DyDxz = ComputeHelper.CreateStorageTexture("DyDxz", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RG);
        this._DyxDyz = ComputeHelper.CreateStorageTexture("DyxDyz", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RG);
        this._DxxDzz = ComputeHelper.CreateStorageTexture("DxxDzz", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RG);

        this._timeDependentSpectrumParams = new BABYLON.UniformBuffer(this._engine);

        this._timeDependentSpectrumParams.addUniform("Time", 1);

        this._timeDependentSpectrum.setTexture("H0", this._initialSpectrum.initialSpectrum, false);
        this._timeDependentSpectrum.setTexture("WavesData", this._initialSpectrum.wavesData, false);
        this._timeDependentSpectrum.setUniformBuffer("params", this._timeDependentSpectrumParams);
        this._timeDependentSpectrum.setStorageTexture("DxDz", this._DxDz);
        this._timeDependentSpectrum.setStorageTexture("DyDxz", this._DyDxz);
        this._timeDependentSpectrum.setStorageTexture("DyxDyz", this._DyxDyz);
        this._timeDependentSpectrum.setStorageTexture("DxxDzz", this._DxxDzz);

        rttDebug.setTexture(debugFirstIndex + 3, "DxDz", this._DxDz, 2);
        rttDebug.setTexture(debugFirstIndex + 4, "DyDxz", this._DyDxz, 2);
        rttDebug.setTexture(debugFirstIndex + 5, "DyxDyz", this._DyxDyz, 2);
        rttDebug.setTexture(debugFirstIndex + 6, "DxxDzz", this._DxxDzz, 2);
        //rttDebug.setTexture(debugFirstIndex + 7, "buffer", this._buffer, 2);

        this._texturesMerger = new BABYLON.ComputeShader("texturesMerger", this._engine, { computeSource: wavesTexturesMergerCS }, {
            bindingsMapping: {
                "params": { group: 0, binding: 0 },
                "Displacement": { group: 0, binding: 1 },
                "Derivatives": { group: 0, binding: 2 },
                "TurbulenceRead": { group: 0, binding: 3 },
                "TurbulenceWrite": { group: 0, binding: 4 },
                "DxDz": { group: 0, binding: 5 },
                "DyDxz": { group: 0, binding: 6 },
                "DyxDyz": { group: 0, binding: 7 },
                "DxxDzz": { group: 0, binding: 8 },
            },
            entryPoint: "fillResultTextures"
        });

        this._displacement = ComputeHelper.CreateStorageTexture("displacement", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RGBA, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT, BABYLON.Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
        this._derivatives = ComputeHelper.CreateStorageTexture("derivatives", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RGBA, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT, BABYLON.Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, true);
        this._turbulence = ComputeHelper.CreateStorageTexture("turbulence", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RGBA, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT, BABYLON.Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, true);
        this._turbulence2 = ComputeHelper.CreateStorageTexture("turbulence", this._engine, this._size, this._size, BABYLON.Constants.TEXTUREFORMAT_RGBA, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT, BABYLON.Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, true);

        this._texturesMergerParams = new BABYLON.UniformBuffer(this._engine);

        this._texturesMergerParams.addUniform("Lambda", 1);
        this._texturesMergerParams.addUniform("DeltaTime", 1);

        this._texturesMerger.setUniformBuffer("params", this._texturesMergerParams);
        this._texturesMerger.setStorageTexture("Displacement", this._displacement);
        this._texturesMerger.setStorageTexture("Derivatives", this._derivatives);
        this._texturesMerger.setTexture("DxDz", this._DxDz, false);
        this._texturesMerger.setTexture("DyDxz", this._DyDxz, false);
        this._texturesMerger.setTexture("DyxDyz", this._DyxDyz, false);
        this._texturesMerger.setTexture("DxxDzz", this._DxxDzz, false);

        rttDebug.setTexture(debugFirstIndex + 7, "displacement", this._displacement, 2);
        rttDebug.setTexture(debugFirstIndex + 8, "derivatives", this._derivatives, 2);
        rttDebug.setTexture(debugFirstIndex + 9, "turbulence", this._turbulence, 1);
    }

    public calculateInitials(wavesSettings: WavesSettings, lengthScale: number, cutoffLow: number, cutoffHigh: number): void {
        this._lambda = wavesSettings.lambda;
        this._initialSpectrum.generate(wavesSettings, lengthScale, cutoffLow, cutoffHigh);
    }

    public calculateWavesAtTime(time: number): void {
        // Calculating complex amplitudes
        this._timeDependentSpectrumParams.updateFloat("Time", time);
        this._timeDependentSpectrumParams.update();

        ComputeHelper.Dispatch(this._timeDependentSpectrum, this._size, this._size, 1);

        // Calculating IFFTs of complex amplitudes
        this._fft.IFFT2D(this._DxDz, this._buffer);
        this._fft.IFFT2D(this._DyDxz, this._buffer);
        this._fft.IFFT2D(this._DyxDyz, this._buffer);
        this._fft.IFFT2D(this._DxxDzz, this._buffer);

        // Filling displacement and normals textures
        let deltaTime = this._engine.getDeltaTime() / 1000;
        if (deltaTime > 0.5) {
            // avoid too big delta time
            deltaTime = 0.5;
        }
        this._texturesMergerParams.updateFloat("Lambda", this._lambda);
        this._texturesMergerParams.updateFloat("DeltaTime", deltaTime);
        this._texturesMergerParams.update();

        this._pingPongTurbulence = !this._pingPongTurbulence;

        this._texturesMerger.setTexture("TurbulenceRead", this._pingPongTurbulence ?  this._turbulence : this._turbulence2, false);
        this._texturesMerger.setStorageTexture("TurbulenceWrite", this._pingPongTurbulence ?  this._turbulence2 : this._turbulence);

        ComputeHelper.Dispatch(this._texturesMerger, this._size, this._size, 1);

        this._engine.generateMipmaps(this._derivatives.getInternalTexture()!);
        this._engine.generateMipmaps(this._pingPongTurbulence ?  this._turbulence2.getInternalTexture()! : this._turbulence.getInternalTexture()!);
    }

    public dispose(): void {
        this._initialSpectrum.dispose();
        this._timeDependentSpectrumParams.dispose();
        this._buffer.dispose();
        this._DxDz.dispose();
        this._DyDxz.dispose();
        this._DyxDyz.dispose();
        this._DxxDzz.dispose();
        this._texturesMergerParams.dispose();
    }
}



class InitialSpectrum {

    private _engine: BABYLON.Engine;
    private _rttDebug: RTTDebug;
    private _debugFirstIndex: number;
    private _textureSize: number;

    private _phase1: BABYLON.ComputeShader;
    private _spectrumParameters: BABYLON.StorageBuffer;
    private _params: BABYLON.UniformBuffer;
    private _precomputedData: BABYLON.BaseTexture;
    private _buffer: BABYLON.BaseTexture;

    private _phase2: BABYLON.ComputeShader;
    private _initialSpectrum: BABYLON.BaseTexture;

    public get initialSpectrum() {
        return this._initialSpectrum;
    }

    public get wavesData() {
        return this._precomputedData;
    }

    constructor(engine: BABYLON.Engine, rttDebug: RTTDebug, debugFirstIndex: number, textureSize: number, noise: BABYLON.BaseTexture) {
        this._engine = engine;
        this._rttDebug = rttDebug;
        this._debugFirstIndex = debugFirstIndex;
        this._textureSize = textureSize;

        this._phase1 = new BABYLON.ComputeShader("initialSpectrum", this._engine, { computeSource: initialSpectrumCS }, {
            bindingsMapping: {
                "WavesData": { group: 0, binding: 1 },
                "H0K": { group: 0, binding: 2 },
                "Noise": { group: 0, binding: 4 },
                "params": { group: 0, binding: 5 },
                "spectrumParameters": { group: 0, binding: 6 },
            },
            entryPoint: "calculateInitialSpectrum"
        });

        this._initialSpectrum = ComputeHelper.CreateStorageTexture("h0", engine, textureSize, textureSize, BABYLON.Constants.TEXTUREFORMAT_RGBA);
        this._precomputedData = ComputeHelper.CreateStorageTexture("wavesData", engine, textureSize, textureSize, BABYLON.Constants.TEXTUREFORMAT_RGBA);
        this._buffer = ComputeHelper.CreateStorageTexture("h0k", engine, textureSize, textureSize, BABYLON.Constants.TEXTUREFORMAT_RG);

        this._spectrumParameters = new BABYLON.StorageBuffer(this._engine, 8 * 2 * 4, BABYLON.Constants.BUFFER_CREATIONFLAG_READWRITE);

        this._params = new BABYLON.UniformBuffer(this._engine);

        this._params.addUniform("Size", 1);
        this._params.addUniform("LengthScale", 1);
        this._params.addUniform("CutoffHigh", 1);
        this._params.addUniform("CutoffLow", 1);
        this._params.addUniform("GravityAcceleration", 1);
        this._params.addUniform("Depth", 1);

        this._phase1.setStorageTexture("WavesData", this._precomputedData);
        this._phase1.setStorageTexture("H0K", this._buffer);
        this._phase1.setTexture("Noise", noise, false);
        this._phase1.setStorageBuffer("spectrumParameters", this._spectrumParameters);
        this._phase1.setUniformBuffer("params", this._params);

        this._phase2 = new BABYLON.ComputeShader("initialSpectrum2", this._engine, { computeSource: initialSpectrum2CS }, {
            bindingsMapping: {
                "H0": { group: 0, binding: 0 },
                "params": { group: 0, binding: 5 },
                "H0K": { group: 0, binding: 8 },
            },
            entryPoint: "calculateConjugatedSpectrum"
        });

        this._phase2.setStorageTexture("H0", this._initialSpectrum);
        this._phase2.setUniformBuffer("params", this._params);
        this._phase2.setTexture("H0K", this._buffer, false);

        this._rttDebug.setTexture(this._debugFirstIndex + 0, "waves precompute", this._precomputedData);
        this._rttDebug.setTexture(this._debugFirstIndex + 1, "H0K", this._buffer, 1000);
        this._rttDebug.setTexture(this._debugFirstIndex + 2, "H0", this._initialSpectrum, 1000);
    }

    public generate(wavesSettings: WavesSettings, lengthScale: number, cutoffLow: number, cutoffHigh: number): void {
        this._params.updateInt("Size", this._textureSize);
        this._params.updateFloat("LengthScale", lengthScale);
        this._params.updateFloat("CutoffHigh", cutoffHigh);
        this._params.updateFloat("CutoffLow", cutoffLow);

        wavesSettings.setParametersToShader(this._params, this._spectrumParameters);

        this._params.update();

        ComputeHelper.Dispatch(this._phase1, this._textureSize, this._textureSize, 1);
        ComputeHelper.Dispatch(this._phase2, this._textureSize, this._textureSize, 1);
    }

    public dispose(): void {
        this._spectrumParameters.dispose();
        this._params.dispose();
        this._precomputedData.dispose();
        this._buffer.dispose();
        this._initialSpectrum.dispose();
        this._phase1 = null as any;
        this._phase2 = null as any;
    }
}



class FFT {
    private _engine: BABYLON.Engine;
    private _rttDebug: RTTDebug;
    private _debugFirstIndex: number;
    private _size: number;

    private _precomputedData: BABYLON.BaseTexture;
    private _params: BABYLON.UniformBuffer;
    private _horizontalStepIFFT: BABYLON.ComputeShader[];
    private _verticalStepIFFT: BABYLON.ComputeShader[];
    private _permute: BABYLON.ComputeShader;

    constructor(engine: BABYLON.Engine, scene: BABYLON.Scene, rttDebug: RTTDebug, debugFirstIndex: number, size: number) {
        this._engine = engine;
        this._rttDebug = rttDebug;
        this._debugFirstIndex = debugFirstIndex;
        this._size = size;
        this._horizontalStepIFFT = [];
        this._verticalStepIFFT = [];
        this._permute = null as any;

        const cs = new BABYLON.ComputeShader("computeTwiddleFactors", this._engine, { computeSource: fftPrecomputeCS }, {
            bindingsMapping: {
                "PrecomputeBuffer": { group: 0, binding: 0 },
                "params": { group: 0, binding: 1 },
            },
            entryPoint: "precomputeTwiddleFactorsAndInputIndices"
        });

        const logSize = Math.log2(size) | 0;

        this._precomputedData = ComputeHelper.CreateStorageTexture("precomputeTwiddle", this._engine, logSize, this._size, BABYLON.Constants.TEXTUREFORMAT_RGBA);

        this._rttDebug.setTexture(this._debugFirstIndex, "precomputeTwiddle", this._precomputedData);

        this._params = new BABYLON.UniformBuffer(this._engine);

        this._params.addUniform("Step", 1);
        this._params.addUniform("Size", 1);

        cs.setStorageTexture("PrecomputeBuffer", this._precomputedData);
        cs.setUniformBuffer("params", this._params);

        this._params.updateInt("Size", this._size);
        this._params.update();

        ComputeHelper.Dispatch(cs, logSize, size / 2, 1);

        this._createComputeShaders();
    }

    public IFFT2D(input: BABYLON.BaseTexture, buffer: BABYLON.BaseTexture): void {
        const logSize = Math.log2(this._size) | 0;

        // TODO: optimize recreation of binding groups by not ping/ponging the textures
        /*this._horizontalStepIFFT[0].setTexture("InputBuffer", input, false);
        this._horizontalStepIFFT[0].setStorageTexture("OutputBuffer", buffer);
        this._horizontalStepIFFT[1].setTexture("InputBuffer", buffer, false);
        this._horizontalStepIFFT[1].setStorageTexture("OutputBuffer", input);*/

        let pingPong = false;
        for (let i = 0; i < logSize; ++i) {
            pingPong = !pingPong;

            this._params.updateInt("Step", i);
            this._params.update();

            this._horizontalStepIFFT[0].setTexture("InputBuffer", pingPong ? input : buffer, false);
            this._horizontalStepIFFT[0].setStorageTexture("OutputBuffer", pingPong ? buffer : input);

            ComputeHelper.Dispatch(this._horizontalStepIFFT[0], this._size, this._size, 1);

            //ComputeHelper.Dispatch(pingPong ? this._horizontalStepIFFT[0] : this._horizontalStepIFFT[1], this._size, this._size, 1);
        }

        /*this._verticalStepIFFT[0].setTexture("InputBuffer", pingPong ? buffer : input, false);
        this._verticalStepIFFT[0].setStorageTexture("OutputBuffer", pingPong ? input : buffer);
        this._verticalStepIFFT[1].setTexture("InputBuffer", pingPong ? input : buffer, false);
        this._verticalStepIFFT[1].setStorageTexture("OutputBuffer", pingPong ? buffer : input);*/

        for (let i = 0; i < logSize; ++i) {
            pingPong = !pingPong;

            this._params.updateInt("Step", i);
            this._params.update();

            this._verticalStepIFFT[0].setTexture("InputBuffer", pingPong ? input : buffer, false);
            this._verticalStepIFFT[0].setStorageTexture("OutputBuffer", pingPong ? buffer : input);

            ComputeHelper.Dispatch(this._verticalStepIFFT[0], this._size, this._size, 1);

            //ComputeHelper.Dispatch(pingPong ? this._verticalStepIFFT[0] : this._verticalStepIFFT[1], this._size, this._size, 1);
        }

        if (pingPong) {
            ComputeHelper.CopyTexture(buffer, input, this._engine);
        }

        this._permute.setTexture("InputBuffer", input, false);
        this._permute.setStorageTexture("OutputBuffer", buffer);

        ComputeHelper.Dispatch(this._permute, this._size, this._size, 1);

        ComputeHelper.CopyTexture(buffer, input, this._engine);
    }

    public dispose(): void {
        this._precomputedData.dispose();
        this._params.dispose();
    }

    private _createComputeShaders(): void {
        for (let i = 0; i < 2; ++i) {
            this._horizontalStepIFFT[i] = new BABYLON.ComputeShader("horizontalStepIFFT", this._engine, { computeSource: fftInverseFFTCS }, {
                bindingsMapping: {
                    "params": { group: 0, binding: 1 },
                    "PrecomputedData": { group: 0, binding: 3 },
                    "InputBuffer": { group: 0, binding: 5 },
                    "OutputBuffer": { group: 0, binding: 6 },
                },
                entryPoint: "horizontalStepInverseFFT"
            });

            this._horizontalStepIFFT[i].setUniformBuffer("params", this._params);
            this._horizontalStepIFFT[i].setTexture("PrecomputedData", this._precomputedData, false);

            this._verticalStepIFFT[i] = new BABYLON.ComputeShader("verticalStepIFFT", this._engine, { computeSource: fftInverseFFT2CS }, {
                bindingsMapping: {
                    "params": { group: 0, binding: 1 },
                    "PrecomputedData": { group: 0, binding: 3 },
                    "InputBuffer": { group: 0, binding: 5 },
                    "OutputBuffer": { group: 0, binding: 6 },
                },
                entryPoint: "verticalStepInverseFFT"
            });

            this._verticalStepIFFT[i].setUniformBuffer("params", this._params);
            this._verticalStepIFFT[i].setTexture("PrecomputedData", this._precomputedData, false);
        }

        this._permute = new BABYLON.ComputeShader("permute", this._engine, { computeSource: fftInverseFFT3CS }, {
            bindingsMapping: {
                "InputBuffer": { group: 0, binding: 5 },
                "OutputBuffer": { group: 0, binding: 6 },
            },
            entryPoint: "permute"
        });
    }
}



class ComputeHelper {

    private static _copyTexture4CS: BABYLON.ComputeShader;
    private static _copyTexture2CS: BABYLON.ComputeShader;
    private static _copyTexture4Params: BABYLON.UniformBuffer;
    private static _copyTexture2Params: BABYLON.UniformBuffer;
    private static _copyBufferTextureCS: BABYLON.ComputeShader;
    private static _copyBufferTextureParams: BABYLON.UniformBuffer;
    private static _copyTextureBufferCS: BABYLON.ComputeShader;
    private static _copyTextureBufferParams: BABYLON.UniformBuffer;
    private static _clearTextureCS: BABYLON.ComputeShader;
    private static _clearTextureParams: BABYLON.UniformBuffer;

    private static _clearTextureComputeShader = `
        [[group(0), binding(0)]] var tbuf : texture_storage_2d<rgba32float, write>;

        [[block]] struct Params {
            color : vec4<f32>;
            width : u32;
            height : u32;
        };
        [[group(0), binding(1)]] var<uniform> params : Params;

        [[stage(compute), workgroup_size(8, 8, 1)]]
        fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
            if (global_id.x >= params.width || global_id.y >= params.height) {
                return;
            }
            textureStore(tbuf, vec2<i32>(global_id.xy), params.color);
        }
    `;

    private static _copyTexture4ComputeShader = `
        [[group(0), binding(0)]] var dest : texture_storage_2d<rgba32float, write>;
        [[group(0), binding(1)]] var src : texture_2d<f32>;

        [[block]] struct Params {
            width : u32;
            height : u32;
        };
        [[group(0), binding(2)]] var<uniform> params : Params;

        [[stage(compute), workgroup_size(8, 8, 1)]]
        fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
            if (global_id.x >= params.width || global_id.y >= params.height) {
                return;
            }
            let pix : vec4<f32> = textureLoad(src, vec2<i32>(global_id.xy), 0);
            textureStore(dest, vec2<i32>(global_id.xy), pix);
        }
    `;

    private static _copyTexture2ComputeShader = `
        [[group(0), binding(0)]] var dest : texture_storage_2d<rg32float, write>;
        [[group(0), binding(1)]] var src : texture_2d<f32>;

        [[block]] struct Params {
            width : u32;
            height : u32;
        };
        [[group(0), binding(2)]] var<uniform> params : Params;

        [[stage(compute), workgroup_size(8, 8, 1)]]
        fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
            if (global_id.x >= params.width || global_id.y >= params.height) {
                return;
            }
            let pix : vec4<f32> = textureLoad(src, vec2<i32>(global_id.xy), 0);
            textureStore(dest, vec2<i32>(global_id.xy), pix);
        }
    `;

    private static _copyBufferTextureComputeShader = `
        [[block]] struct FloatArray {
            elements : array<f32>;
        };

        [[group(0), binding(0)]] var dest : texture_storage_2d<rgba32float, write>;
        [[group(0), binding(1)]] var<storage, read> src : FloatArray;

        [[block]] struct Params {
            width : u32;
            height : u32;
        };
        [[group(0), binding(2)]] var<uniform> params : Params;

        [[stage(compute), workgroup_size(8, 8, 1)]]
        fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
            if (global_id.x >= params.width || global_id.y >= params.height) {
                return;
            }
            let offset : u32 = global_id.y * params.width * 4u + global_id.x * 4u;
            let pix : vec4<f32> = vec4<f32>(src.elements[offset], src.elements[offset + 1u], src.elements[offset + 2u], src.elements[offset + 3u]);
            textureStore(dest, vec2<i32>(global_id.xy), pix);
        }
    `;

    private static _copyTextureBufferComputeShader = `
        [[block]] struct FloatArray {
            elements : array<f32>;
        };

        [[group(0), binding(0)]] var src : texture_2d<f32>;
        [[group(0), binding(1)]] var<storage, write> dest : FloatArray;

        [[block]] struct Params {
            width : u32;
            height : u32;
        };
        [[group(0), binding(2)]] var<uniform> params : Params;

        [[stage(compute), workgroup_size(8, 8, 1)]]
        fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
            if (global_id.x >= params.width || global_id.y >= params.height) {
                return;
            }
            let offset : u32 = global_id.y * params.width * 4u + global_id.x * 4u;
            let pix : vec4<f32> = textureLoad(src, vec2<i32>(global_id.xy), 0);
            dest.elements[offset] = pix.r;
            dest.elements[offset + 1u] = pix.g;
            dest.elements[offset + 2u] = pix.b;
            dest.elements[offset + 3u] = pix.a;
        }
    `;

    static GetThreadGroupSizes(source: string, entryPoint: string): BABYLON.Vector3 {
        const rx = new RegExp(`workgroup_size\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)]]\\s*fn\\s+${entryPoint}\\s*\\(`, "g");
        const res = rx.exec(source);
        return res ? new BABYLON.Vector3(parseInt(res[1]), parseInt(res[2]), parseInt(res[3])) : new BABYLON.Vector3(1, 1, 1);
    }

    static CreateStorageTexture(name: string, sceneOrEngine: BABYLON.Scene | BABYLON.ThinEngine, nwidth: number, nheight: number, textureFormat = BABYLON.Constants.TEXTUREFORMAT_RGBA, textureType = BABYLON.Constants.TEXTURETYPE_FLOAT,
            filterMode = BABYLON.Constants.TEXTURE_NEAREST_SAMPLINGMODE, generateMipMaps = false, wrapMode = BABYLON.Constants.TEXTURE_WRAP_ADDRESSMODE, texture: BABYLON.Nullable<BABYLON.Texture> = null): BABYLON.Texture
    {
        const { width, height } = texture ? texture.getSize() : { width: 0, height: 0 };
        let type = texture ? (texture.getInternalTexture()!.type ?? -1) : -2;
        let format = texture ? (texture.getInternalTexture()!.format ?? -1) : -2;
        if (type === -1) {
            type = BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE;
        }
        if (format === -1) {
            format = BABYLON.Constants.TEXTUREFORMAT_RGBA;
        }
        if (!texture || width !== nwidth || height !== nheight || textureType !== type || textureFormat !== format) {
            /*texture = new BABYLON.RenderTargetTexture(name, { width: nwidth, height: nheight }, scene, false, undefined, textureType, false, filterMode, false, false, false,
                textureFormat, false, undefined, BABYLON.Constants.TEXTURE_CREATIONFLAG_STORAGE);*/
            texture = new BABYLON.RawTexture(null, nwidth, nheight, textureFormat, sceneOrEngine, generateMipMaps, false, filterMode, textureType, BABYLON.Constants.TEXTURE_CREATIONFLAG_STORAGE);
            texture.name = name;
        }
        texture.wrapU = wrapMode;
        texture.wrapV = wrapMode;
        texture.updateSamplingMode(filterMode);

        return texture;
    }

    static CopyTexture(source: BABYLON.BaseTexture, dest: BABYLON.BaseTexture, engine_?: BABYLON.Engine): void {
        const numChannels = source.getInternalTexture()!.format === BABYLON.Constants.TEXTUREFORMAT_RG ? 2 : 4;
        if (!ComputeHelper._copyTexture4CS && numChannels === 4 || !ComputeHelper._copyTexture2CS && numChannels === 2) {
            const engine = source.getScene()?.getEngine() ?? engine_!;
            const cs1 = new BABYLON.ComputeShader(`copyTexture${numChannels}Compute`, engine, { computeSource: numChannels === 4 ? ComputeHelper._copyTexture4ComputeShader : ComputeHelper._copyTexture2ComputeShader }, { bindingsMapping:
                {
                    "dest": { group: 0, binding: 0 },
                    "src": { group: 0, binding: 1 },
                    "params": { group: 0, binding: 2 },
                }
            });

            const uBuffer0 = new BABYLON.UniformBuffer(engine);

            uBuffer0.addUniform("width", 1);
            uBuffer0.addUniform("height", 1);
            
            cs1.setUniformBuffer("params", uBuffer0);

            if (numChannels === 4) {
                ComputeHelper._copyTexture4CS = cs1;
                ComputeHelper._copyTexture4Params = uBuffer0;
            } else {
                ComputeHelper._copyTexture2CS = cs1;
                ComputeHelper._copyTexture2Params = uBuffer0;
            }
        }

        const cs = numChannels === 4 ? ComputeHelper._copyTexture4CS : ComputeHelper._copyTexture2CS;
        const params = numChannels === 4 ? ComputeHelper._copyTexture4Params : ComputeHelper._copyTexture2Params;

        cs.setTexture("src", source, false);
        cs.setStorageTexture("dest", dest);

        const { width, height } = source.getSize();

        params.updateInt("width", width);
        params.updateInt("height", height);
        params.update();

        ComputeHelper.Dispatch(cs, width, height, 1);
    }

    static CopyBufferToTexture(source: BABYLON.StorageBuffer, dest: BABYLON.BaseTexture): void {
        if (!ComputeHelper._copyBufferTextureCS) {
            const engine = dest.getScene()!.getEngine();
            const cs1 = new BABYLON.ComputeShader("copyBufferTextureCompute", engine, { computeSource: ComputeHelper._copyBufferTextureComputeShader }, { bindingsMapping:
                {
                    "dest": { group: 0, binding: 0 },
                    "src": { group: 0, binding: 1 },
                    "params": { group: 0, binding: 2 },
                }
            });

            const uBuffer0 = new BABYLON.UniformBuffer(engine);

            uBuffer0.addUniform("width", 1);
            uBuffer0.addUniform("height", 1);
            
            cs1.setUniformBuffer("params", uBuffer0);

            ComputeHelper._copyBufferTextureCS = cs1;
            ComputeHelper._copyBufferTextureParams = uBuffer0;
        }

        ComputeHelper._copyBufferTextureCS.setStorageBuffer("src", source);
        ComputeHelper._copyBufferTextureCS.setStorageTexture("dest", dest);

        const { width, height } = dest.getSize();

        ComputeHelper._copyBufferTextureParams.updateInt("width", width);
        ComputeHelper._copyBufferTextureParams.updateInt("height", height);
        ComputeHelper._copyBufferTextureParams.update();

        ComputeHelper.Dispatch(ComputeHelper._copyBufferTextureCS, width, height, 1);
    }

    static CopyTextureToBuffer(source: BABYLON.BaseTexture, dest: BABYLON.StorageBuffer): void {
        if (!ComputeHelper._copyTextureBufferCS) {
            const engine = source.getScene()!.getEngine();
            const cs1 = new BABYLON.ComputeShader("copyTextureBufferCompute", engine, { computeSource: ComputeHelper._copyTextureBufferComputeShader }, { bindingsMapping:
                {
                    "src": { group: 0, binding: 0 },
                    "dest": { group: 0, binding: 1 },
                    "params": { group: 0, binding: 2 },
                }
            });

            const uBuffer0 = new BABYLON.UniformBuffer(engine);

            uBuffer0.addUniform("width", 1);
            uBuffer0.addUniform("height", 1);
            
            cs1.setUniformBuffer("params", uBuffer0);

            ComputeHelper._copyTextureBufferCS = cs1;
            ComputeHelper._copyTextureBufferParams = uBuffer0;
        }

        ComputeHelper._copyTextureBufferCS.setTexture("src", source, false);
        ComputeHelper._copyTextureBufferCS.setStorageBuffer("dest", dest);

        const { width, height } = source.getSize();

        ComputeHelper._copyTextureBufferParams.updateInt("width", width);
        ComputeHelper._copyTextureBufferParams.updateInt("height", height);
        ComputeHelper._copyTextureBufferParams.update();

        ComputeHelper.Dispatch(ComputeHelper._copyTextureBufferCS, width, height, 1);
    }

    static ClearTexture(source: BABYLON.BaseTexture, color: BABYLON.Color4): void {
        if (!ComputeHelper._clearTextureCS) {
            const engine = source.getScene()!.getEngine();
            const cs1 = new BABYLON.ComputeShader("clearTextureCompute", engine, { computeSource: ComputeHelper._clearTextureComputeShader }, { bindingsMapping:
                {
                    "tbuf": { group: 0, binding: 0 },
                    "params": { group: 0, binding: 1 },
                }
            });

            const uBuffer0 = new BABYLON.UniformBuffer(engine);

            uBuffer0.addUniform("color", 4);
            uBuffer0.addUniform("width", 1);
            uBuffer0.addUniform("height", 1);
            
            cs1.setUniformBuffer("params", uBuffer0);

            ComputeHelper._clearTextureCS = cs1;
            ComputeHelper._clearTextureParams = uBuffer0;
        }

        ComputeHelper._clearTextureCS.setStorageTexture("tbuf", source);

        const { width, height } = source.getSize();

        ComputeHelper._clearTextureParams.updateDirectColor4("color", color);
        ComputeHelper._clearTextureParams.updateInt("width", width);
        ComputeHelper._clearTextureParams.updateInt("height", height);
        ComputeHelper._clearTextureParams.update();

        ComputeHelper.Dispatch(ComputeHelper._clearTextureCS, width, height, 1);
    }

    static Dispatch(cs: BABYLON.ComputeShader, numIterationsX: number, numIterationsY = 1, numIterationsZ = 1): void {
        if (!(cs as any).threadGroupSizes) {
            (cs as any).threadGroupSizes = ComputeHelper.GetThreadGroupSizes(cs.shaderPath.computeSource, cs.options.entryPoint ?? "main");
        }

        const threadGroupSizes: BABYLON.Vector3 = (cs as any).threadGroupSizes;
        const numGroupsX = Math.ceil(numIterationsX / threadGroupSizes.x);
        const numGroupsY = Math.ceil(numIterationsY / threadGroupSizes.y);
        const numGroupsZ = Math.ceil(numIterationsZ / threadGroupSizes.z);
        
        cs.dispatch(numGroupsX, numGroupsY, numGroupsZ);
    }    
}



enum PixelType {
    UINT = 0,
    HALF = 1,
    FLOAT = 2,
}

enum CompressionType {
    NO_COMPRESSION = 0,
    RLE_COMPRESSION = 1,
    ZIPS_COMPRESSION = 2,
    ZIP_COMPRESSION = 3,
    PIZ_COMPRESSION = 4,
    PXR24_COMPRESSION = 5,
    B44_COMPRESSION = 6,
    B44A_COMPRESSION = 7,
}

enum LineOrder {
    INCREASING_Y = 0,
    DECREASING_Y = 1,
    RANDOM_Y = 2,
}

interface IChannelLayout {
    name: string;
    pixelType: PixelType;
}

class EXRSerializer {

    private _buffer: Uint8Array;
    private _dataLength: number;
    private _view: DataView;
    private _growSize: number;

    public get buffer() {
        return this._buffer;
    }

    constructor() {
        this._buffer = new Uint8Array(0);
        this._dataLength = 0;
        this._view = new DataView(this._buffer.buffer);
        this._growSize = 2000;
    }

    public serialize(width: number, height: number, data: Float32Array | number[], channels: string[] = ["R", "G", "B", "A"]): void {
        this._dataLength = 0;

        const numChannels = channels.length;

        this._capacity(width * height * numChannels * 4);

        const channelsLayout: IChannelLayout[] = [];
        const allChannels = ["A", "B", "G", "R"];

        let channelsMask = 0;
        for (let i = 0; i < allChannels.length; ++i) {
            if (channels.indexOf(allChannels[i]) >= 0) {
                channelsLayout.push({ name: allChannels[i], pixelType: PixelType.FLOAT });
                channelsMask = channelsMask | (1 << ( 3 - i));
            }
        }

        this._add([0x76, 0x2f, 0x31, 0x01]); // magic
        this._addInt32(0x00000002); // version
        this._addHeaderAttribute_chlist("channels", channelsLayout);
        this._addHeaderAttribute_compression("compression", CompressionType.NO_COMPRESSION);
        this._addHeaderAttribute_box2i("dataWindow", 0, 0, width - 1, height - 1);
        this._addHeaderAttribute_box2i("displayWindow", 0, 0, width - 1, height - 1);
        this._addHeaderAttribute_lineOrder("lineOrder", LineOrder.INCREASING_Y);
        this._addHeaderAttribute_float("pixelAspectRatio", 1);
        this._addHeaderAttribute_v2f("screenWindowCenter", 0, 0);
        this._addHeaderAttribute_float("screenWindowWidth", width);
        this._addNull();

        const offsetTable: BigInt[] = [];
        const offsetTableSize = height * 8;
        const pixelDataSize = width * numChannels * 4;

        let scanlineOffset = this._dataLength + offsetTableSize;
        for (let y = 0; y < height; ++y) {
            offsetTable.push(BigInt(scanlineOffset));
            scanlineOffset += pixelDataSize + 8;
        }

        this._addUint64(offsetTable);

        for (let y = 0; y < height; ++y) {
            this._addUint32(y);
            this._addUint32(pixelDataSize);
            for (let channel = 3; channel >= 0; --channel) {
                if (channelsMask & (1 << channel)) {
                    for (let x = 0; x < width; ++x) {
                        const v = data[y * width * numChannels + x * numChannels + channel];
                        this._addFloat(v);
                    }
                }
            }
        }

        this._buffer = this._buffer.slice(0, this._dataLength);
        this._view = new DataView(this._buffer.buffer);
    }

    public download(fileName: string): void {
        BABYLON.Tools.Download(new Blob([this._buffer.buffer], { type: "application/octet-stream" }), fileName);
    }

    private _addHeaderAttribute_chlist(name: string, channels: IChannelLayout[]): void {
        this._addString(name);
        this._addNull();
        this._addString("chlist");
        this._addNull();

        let headerSize = 1;
        for (let i = 0; i < channels.length; ++i) {
            headerSize += channels[i].name.length + 1;
            headerSize += 4 // pixelType
                        + 1 // pLinear
                        + 3 // filling
                        + 4 * 2; // xSampling & ySampling
        }
        this._addUint32(headerSize);
        for (let i = 0; i < channels.length; ++i) {
            const channel = channels[i];

            this._addString(channel.name);
            this._addNull();
            this._addInt32(channel.pixelType);
            this._addUint8(0); // pLinear
            this._addNull(3); // filling
            this._addInt32([1, 1]); // xSampling & ySampling
        }
        this._addNull();
    }

    private _addHeaderAttribute_compression(name: string, compression: CompressionType): void {
        this._addString(name);
        this._addNull();
        this._addString("compression");
        this._addNull();
        this._addUint32(1);
        this._addUint8(compression);
    }

    private _addHeaderAttribute_box2i(name: string, xMin: number, yMin: number, xMax: number, yMax: number): void {
        this._addString(name);
        this._addNull();
        this._addString("box2i");
        this._addNull();
        this._addUint32(4 * 4);
        this._addInt32([xMin, yMin, xMax, yMax]);
    }

    private _addHeaderAttribute_lineOrder(name: string, lineOrder: LineOrder): void {
        this._addString(name);
        this._addNull();
        this._addString("lineOrder");
        this._addNull();
        this._addUint32(1);
        this._addUint8(lineOrder);
    }

    private _addHeaderAttribute_float(name: string, value: number): void {
        this._addString(name);
        this._addNull();
        this._addString("float");
        this._addNull();
        this._addUint32(4);
        this._addFloat(value);
    }

    private _addHeaderAttribute_v2f(name: string, value1: number, value2: number): void {
        this._addString(name);
        this._addNull();
        this._addString("v2f");
        this._addNull();
        this._addUint32(4 * 2);
        this._addFloat([value1, value2]);
    }

    private _addString(s: string): void {
        this._capacity(s.length);
        for (let i = 0; i < s.length; ++i) {
            this._view.setUint8(this._dataLength++, s.charCodeAt(i));
        }
    }

    private _addInt8(v: number | number[]): void {
        if (Array.isArray(v)) {
            this._capacity(v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setInt8(this._dataLength++, v[i]);
            }
        } else {
            this._capacity(1);
            this._view.setInt8(this._dataLength, v);
            this._dataLength += 1;
        }
    }

    private _addUint8(v: number): void {
        this._capacity(1);
        this._view.setUint8(this._dataLength, v);
        this._dataLength += 1;
    }

    private _addInt16(v: number | number[]): void {
        if (Array.isArray(v)) {
            this._capacity(2 * v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setInt16(this._dataLength, v[i], true);
                this._dataLength += 2;
            }
        } else {
            this._capacity(2);
            this._view.setInt16(this._dataLength, v, true);
            this._dataLength += 2;
        }
    }

    private _addUint16(v: number | number[]): void {
        if (Array.isArray(v)) {
            this._capacity(2 * v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setUint16(this._dataLength, v[i], true);
                this._dataLength += 2;
            }
        } else {
            this._view.setUint16(this._dataLength, v, true);
            this._dataLength += 2;
        }
    }

    private _addInt32(v: number | number[]): void {
        if (Array.isArray(v)) {
            this._capacity(4 * v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setInt32(this._dataLength, v[i], true);
                this._dataLength += 4;
            }
        } else {
            this._capacity(4);
            this._view.setInt32(this._dataLength, v, true);
            this._dataLength += 4;
        }
    }

    private _addUint32(v: number | number[]): void {
        if (Array.isArray(v)) {
            this._capacity(4 * v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setUint32(this._dataLength, v[i], true);
                this._dataLength += 4;
            }
        } else {
            this._capacity(4);
            this._view.setUint32(this._dataLength, v, true);
            this._dataLength += 4;
        }
    }

    private _addUint64(v: BigUint64Array | BigInt[]): void {
        if (Array.isArray(v)) {
            this._capacity(8 * v.length);
            for (let i = 0; i < v.length; ++i) {
                (this._view as any).setBigUint64(this._dataLength, v[i] as bigint, true);
                this._dataLength += 8;
            }

        } else {
            this._capacity(v.byteLength);
            for (let i = 0; i < v.length; ++i) {
                (this._view as any).setBigUint64(this._dataLength, v[i], true);
                this._dataLength += 8;
            }
        }
    }

    private _addFloat(v: number | number[] | Float32Array): void {
        if (Array.isArray(v)) {
            this._capacity(4 * v.length);
            for (let i = 0; i < v.length; ++i) {
                this._view.setFloat32(this._dataLength, v[i], true);
                this._dataLength += 4;
            }
        } else if (v instanceof Float32Array) {
            this._capacity(v.byteLength);
            this._buffer.set(v, this._dataLength);
            this._dataLength += v.byteLength;
        } else {
            this._capacity(4);
            this._view.setFloat32(this._dataLength, v, true);
            this._dataLength += 4;
        }
    }

    private _addNull(num = 1): void {
        this._capacity(num);
        while (num-- > 0) {
            this._view.setUint8(this._dataLength++, 0);
        }
    }

    private _add(data: Uint8Array | number[]): void {
        if (Array.isArray(data)) {
            data = new Uint8Array(data);
        }

        const dataLength = data.byteLength;

        this._capacity(dataLength);

        this._buffer.set(data, this._dataLength);
        this._dataLength += dataLength;
    }

    private _capacity(size: number): void {
        if (this._dataLength + size <= this._buffer.byteLength) {
            return;
        }

        this._growBuffer(Math.max(this._growSize, size));
    }

    private _growBuffer(addSize: number): void {
        const newBuffer = new Uint8Array(this._buffer.byteLength + addSize);

        newBuffer.set(this._buffer, 0);

        this._buffer = newBuffer;
        this._view = new DataView(this._buffer.buffer);
    }
}


const fp32 = BABYLON.Tools.FloatRound;

class Vector3Float32 extends BABYLON.Vector3 {

    /**
     * Gets the class name
     * @returns the string "Vector3Float32"
     */
    public getClassName(): string {
        return "Vector3Float32";
    }

    /**
     * Adds the given coordinates to the current Vector3Float32
     * @param x defines the x coordinate of the operand
     * @param y defines the y coordinate of the operand
     * @param z defines the z coordinate of the operand
     * @returns the current updated Vector3Float32
     */
    public addInPlaceFromFloats(x: number, y: number, z: number): Vector3Float32 {
        this.x = fp32(this.x + x);
        this.y = fp32(this.y + y);
        this.z = fp32(this.z + z);
        return this;
    }

    /**
     * Gets a new Vector3Float32, result of the addition the current Vector3Float32 and the given vector
     * @param otherVector defines the second operand
     * @returns the resulting Vector3Float32
     */
    public add(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        return this.addToRef(otherVector, new Vector3Float32(this._x, this._y, this._z));
    }

    /**
     * Gets a new Vector3Float32, result of the addition the current Vector3Float32 and the given vector
     * @param otherVector defines the second operand
     * @returns the resulting Vector3Float32
     */
    public addScalar(scalar: number): Vector3Float32 {
        const result = new Vector3Float32(scalar, scalar, scalar);
        return this.addToRef(result, result);
    }

    /**
     * Adds the current Vector3Float32 to the given one and stores the result in the vector "result"
     * @param otherVector defines the second operand
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public addToRef(otherVector: BABYLON.DeepImmutable<Vector3Float32>, result: Vector3Float32): Vector3Float32 {
        return result.copyFromFloats(fp32(this._x + otherVector._x), fp32(this._y + otherVector._y), fp32(this._z + otherVector._z));
    }

    /**
     * Subtract the given vector from the current Vector3Float32
     * @param otherVector defines the second operand
     * @returns the current updated Vector3Float32
     */
    public subtractInPlace(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        this.x = fp32(this.x - otherVector._x);
        this.y = fp32(this.y - otherVector._y);
        this.z = fp32(this.z - otherVector._z);
        return this;
    }

    /**
     * Returns a new Vector3Float32, result of the subtraction of the given vector from the current Vector3Float32
     * @param otherVector defines the second operand
     * @returns the resulting Vector3Float32
     */
    public subtract(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        return new Vector3Float32(this._x, this._y, this._z).subtractInPlace(otherVector);
    }

    /**
     * Subtracts the given vector from the current Vector3Float32 and stores the result in the vector "result".
     * @param otherVector defines the second operand
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public subtractToRef(otherVector: BABYLON.DeepImmutable<Vector3Float32>, result: Vector3Float32): Vector3Float32 {
        return this.subtractFromFloatsToRef(otherVector._x, otherVector._y, otherVector._z, result);
    }

    /**
     * Returns a new Vector3Float32 set with the subtraction of the given floats from the current Vector3Float32 coordinates
     * @param x defines the x coordinate of the operand
     * @param y defines the y coordinate of the operand
     * @param z defines the z coordinate of the operand
     * @returns the resulting Vector3Float32
     */
    public subtractFromFloats(x: number, y: number, z: number): Vector3Float32 {
        return this.subtractFromFloatsToRef(x, y, z, new Vector3Float32(this._x, this._y, this._z));
    }

    /**
     * Subtracts the given floats from the current Vector3Float32 coordinates and set the given vector "result" with this result
     * @param x defines the x coordinate of the operand
     * @param y defines the y coordinate of the operand
     * @param z defines the z coordinate of the operand
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public subtractFromFloatsToRef(x: number, y: number, z: number, result: Vector3Float32): Vector3Float32 {
        return result.copyFromFloats(fp32(this._x - x), fp32(this._y - y), fp32(this._z - z));
    }

    /**
     * Multiplies the Vector3Float32 coordinates by the float "scale"
     * @param scale defines the multiplier factor
     * @returns the current updated Vector3Float32
     */
    public scaleInPlace(scale: number): Vector3Float32 {
        this.x = fp32(this.x * scale);
        this.y = fp32(this.y * scale);
        this.z = fp32(this.z * scale);
        return this;
    }

    /**
     * Returns a new Vector3Float32 set with the current Vector3Float32 coordinates multiplied by the float "scale"
     * @param scale defines the multiplier factor
     * @returns a new Vector3Float32
     */
    public scale(scale: number): Vector3Float32 {
        return new Vector3Float32(this._x, this._y, this._z).scaleInPlace(scale);
    }

    /**
     * Multiplies the current Vector3Float32 coordinates by the float "scale" and stores the result in the given vector "result" coordinates
     * @param scale defines the multiplier factor
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public scaleToRef(scale: number, result: Vector3Float32): Vector3Float32 {
        return result.copyFromFloats(fp32(this._x * scale), fp32(this._y * scale), fp32(this._z * scale));
    }

    /**
     * Scale the current Vector3Float32 values by a factor and add the result to a given Vector3Float32
     * @param scale defines the scale factor
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public scaleAndAddToRef(scale: number, result: Vector3Float32): Vector3Float32 {
        return result.addInPlaceFromFloats(fp32(this._x * scale), fp32(this._y * scale), fp32(this._z * scale));
    }

    /**
     * Multiplies the current Vector3Float32 coordinates by the given ones
     * @param otherVector defines the second operand
     * @returns the current updated Vector3Float32
     */
    public multiplyInPlace(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        this.x = fp32(this.x * otherVector._x);
        this.y = fp32(this.y * otherVector._y);
        this.z = fp32(this.z * otherVector._z);
        return this;
    }

    /**
     * Returns a new Vector3Float32, result of the multiplication of the current Vector3Float32 by the given vector
     * @param otherVector defines the second operand
     * @returns the new Vector3Float32
     */
    public multiply(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        return this.multiplyByFloats(otherVector._x, otherVector._y, otherVector._z);
    }

    /**
     * Multiplies the current Vector3Float32 by the given one and stores the result in the given vector "result"
     * @param otherVector defines the second operand
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public multiplyToRef(otherVector: BABYLON.DeepImmutable<Vector3Float32>, result: Vector3Float32): Vector3Float32 {
        return result.copyFromFloats(fp32(this._x * otherVector._x), fp32(this._y * otherVector._y), fp32(this._z * otherVector._z));
    }

    /**
     * Returns a new Vector3Float32 set with the result of the mulliplication of the current Vector3Float32 coordinates by the given floats
     * @param x defines the x coordinate of the operand
     * @param y defines the y coordinate of the operand
     * @param z defines the z coordinate of the operand
     * @returns the new Vector3Float32
     */
    public multiplyByFloats(x: number, y: number, z: number): Vector3Float32 {
        const result = new Vector3Float32(x, y, z);
        return this.multiplyToRef(result, result);
    }

    /**
     * Returns a new Vector3Float32 set with the result of the division of the current Vector3Float32 coordinates by the given ones
     * @param otherVector defines the second operand
     * @returns the new Vector3Float32
     */
    public divide(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        return this.divideToRef(otherVector, new Vector3Float32());
    }

    /**
     * Divides the current Vector3Float32 coordinates by the given ones and stores the result in the given vector "result"
     * @param otherVector defines the second operand
     * @param result defines the Vector3Float32 object where to store the result
     * @returns the "result" vector
     */
    public divideToRef(otherVector: BABYLON.DeepImmutable<Vector3Float32>, result: Vector3Float32): Vector3Float32 {
        return result.copyFromFloats(fp32(this._x / otherVector._x), fp32(this._y / otherVector._y), fp32(this._z / otherVector._z));
    }

    /**
     * Divides the current Vector3Float32 coordinates by the given ones.
     * @param otherVector defines the second operand
     * @returns the current updated Vector3Float32
     */
    public divideInPlace(otherVector: Vector3Float32): Vector3Float32 {
        return this.divideToRef(otherVector, this);
    }

    /**
     * Returns a new Vector3Float32, result of applying pow on the current Vector3Float32 by the given vector
     * @param otherVector defines the second operand
     * @returns the new Vector3Float32
     */
    public pow(otherVector: BABYLON.DeepImmutable<Vector3Float32>): Vector3Float32 {
        const result = new Vector3Float32();
        result.x = fp32(Math.pow(this._x, otherVector._x));
        result.y = fp32(Math.pow(this._y, otherVector._y));
        result.z = fp32(Math.pow(this._z, otherVector._z));
        return result;
    }

    /**
     * Gets the length of the Vector3Float32
     * @returns the length of the Vector3Float32
     */
    public length(): number {
        return fp32(Math.sqrt(fp32(fp32(fp32(this._x * this._x) + fp32(this._y * this._y)) + fp32(this._z * this._z))));
    }

    /**
     * Gets the squared length of the Vector3Float
     * @returns squared length of the Vector3Float
     */
    public lengthSquared(): number {
        return fp32(fp32(fp32(this._x * this._x) + fp32(this._y * this._y)) + fp32(this._z * this._z));
    }

    /**
     * Normalize the current Vector3Float32.
     * Please note that this is an in place operation.
     * @returns the current updated Vector3Float32
     */
    public normalize(): Vector3Float32 {
        return this.normalizeFromLength(this.length());
    }

    /**
     * Normalize the current Vector3Float32 with the given input length.
     * Please note that this is an in place operation.
     * @param len the length of the vector
     * @returns the current updated Vector3Float32
     */
    public normalizeFromLength(len: number): Vector3Float32 {
        if (len === 0 || len === 1.0) {
            return this;
        }

        return this.scaleInPlace(fp32(1.0 / len));
    }

    /**
     * Normalize the current Vector3Float32 to a new vector
     * @returns the new Vector3Float32
     */
    public normalizeToNew(): Vector3Float32 {
        const normalized = new Vector3Float32(0, 0, 0);
        this.normalizeToRef(normalized);
        return normalized;
    }

    /**
     * Normalize the current Vector3Float32 to the reference
     * @param reference define the Vector3Float32 to update
     * @returns the updated Vector3Float32
     */
    public normalizeToRef(reference: Vector3Float32): Vector3Float32 {
        const len = this.length();
        if (len === 0 || len === 1.0) {
            return reference.copyFromFloats(this._x, this._y, this._z);
        }

        return this.scaleToRef(fp32(1.0 / len), reference);
    }

    /**
     * Copies the given floats to the current Vector3Float32 coordinates
     * @param x defines the x coordinate of the operand
     * @param y defines the y coordinate of the operand
     * @param z defines the z coordinate of the operand
     * @returns the current updated Vector3Float32
     */
     public copyFromFloats(x: number, y: number, z: number): Vector3Float32 {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    /**
     * Returns a new Vector3Float32 located for "amount" (float) on the linear interpolation between the vectors "start" and "end"
     * @param start defines the start value
     * @param end defines the end value
     * @param amount max defines amount between both (between 0 and 1)
     * @returns the new Vector3Float32
     */
     public static Lerp(start: BABYLON.DeepImmutable<Vector3Float32>, end: BABYLON.DeepImmutable<Vector3Float32>, amount: number): Vector3Float32 {
        var result = new Vector3Float32(0, 0, 0);
        Vector3Float32.LerpToRef(start, end, amount, result);
        return result;
    }

    /**
     * Sets the given vector "result" with the result of the linear interpolation from the vector "start" for "amount" to the vector "end"
     * @param start defines the start value
     * @param end defines the end value
     * @param amount max defines amount between both (between 0 and 1)
     * @param result defines the Vector3Float32 where to store the result
     */
    public static LerpToRef(start: BABYLON.DeepImmutable<Vector3Float32>, end: BABYLON.DeepImmutable<Vector3Float32>, amount: number, result: Vector3Float32): void {
        result.x = fp32(start._x + fp32(fp32(end._x - start._x) * amount));
        result.y = fp32(start._y + fp32(fp32(end._y - start._y) * amount));
        result.z = fp32(start._z + fp32(fp32(end._z - start._z) * amount));
    }

    /**
     * Returns the dot product (float) between the vectors "left" and "right"
     * @param left defines the left operand
     * @param right defines the right operand
     * @returns the dot product
     */
    public static Dot(left: BABYLON.DeepImmutable<Vector3Float32>, right: BABYLON.DeepImmutable<Vector3Float32>): number {
        return fp32(fp32(fp32(left._x * right._x) + fp32(left._y * right._y)) + fp32(left._z * right._z));
    }

    /**
     * Converts a Vector3 to a Vector3Float32
     * @param source source Vector3
     * @param destination destination Vector3Float32
     */
    public static ToFloat32(source: BABYLON.DeepImmutable<BABYLON.Vector3>, destination: Vector3Float32): void {
        destination.set(fp32(source.x), fp32(source.y), fp32(source.z));
    }
}



const numTotalPlanes = 32;
const planeSpacing = 0.003;

class RTTDebug {
    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.TargetCamera;
    private _debugPlaneList: Array<BABYLON.Mesh>;
    private _gui: BABYLON.GUI.AdvancedDynamicTexture;
    private _guiBackgrounds: BABYLON.GUI.Rectangle[];
    private _guiTexts: BABYLON.GUI.TextBlock[];
    private _guiButtons: BABYLON.GUI.Button[];
    private _exrSerializer: EXRSerializer;

    public get camera(): BABYLON.TargetCamera {
        return this._camera;
    }

    public setTexture(index: number, name: string, texture: BABYLON.BaseTexture, multiplier = 1): void {
        (this._debugPlaneList[index].material as BABYLON.StandardMaterial).emissiveTexture = texture;
        if (multiplier !== 1) {
            this._debugPlaneList[index].material?.onBindObservable.add(() => {
                this._debugPlaneList[index].material!.getEffect()?.setFloat("multiplier", multiplier);
            });
        }
        this._debugPlaneList[index].name = name;
        this._debugPlaneList[index].material!.name = "rttDebug_" + name;
        this._guiTexts[index].text = name;
    }

    public get isVisible() {
        return this._gui.layer!.isEnabled;
    }

    public show(show: boolean): void {
        for (const plane of this._debugPlaneList) {
            plane.setEnabled(show);
        }
        for (const gelem of this._guiBackgrounds) {
            gelem.isVisible = show;
        }
        for (const gelem of this._guiTexts) {
            gelem.isVisible = show;
        }
        for (const gelem of this._guiButtons) {
            gelem.isVisible = show;
        }
        this._gui.layer!.isEnabled = show;
    }

    constructor(scene: BABYLON.Scene, engine: BABYLON.Engine, numPlanes = 5) {
        this._engine = engine;
        this._scene = scene;
        this._debugPlaneList = [];
        this._guiBackgrounds = [];
        this._guiTexts = [];
        this._guiButtons = [];
        this._exrSerializer = new EXRSerializer();

        this._camera = new BABYLON.ArcRotateCamera(
            "debug",
            -Math.PI / 2,
            Math.PI / 2,
            10,
            new BABYLON.Vector3(0, 0, 0),
            this._scene
        );

        this._camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        this._camera.layerMask = 0x10000000;

        this._gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("debugGUI", true, scene);

        this._gui.layer!.layerMask = 0x10000000;

        this._makePlanes(numPlanes);
    }

    private _makePlanes(numPlanes: number): void {
        const grid = new BABYLON.GUI.Grid("grid");

        grid.addRowDefinition(1);

        this._gui.addControl(grid);

        const root = new BABYLON.TransformNode("rttDebug", this._scene);

        for (let i = 0; i < numPlanes; ++i) {
            const plane = BABYLON.MeshBuilder.CreatePlane("plane" + i, { size: 1 }, this._scene);
            const uvs = plane.getVerticesData("uv")!;

            for (let i = 0; i < uvs.length; i += 2) {
                uvs[i + 1] = 1 - uvs[i + 1];
            }

            plane.setVerticesData("uv", uvs);

            plane.layerMask = 0x10000000;
            plane.position.x += 0.5;
            plane.position.y -= 0.5;
            plane.bakeCurrentTransformIntoVertices();
            plane.parent = root;

            this._debugPlaneList.push(plane);

            const mat = new BABYLON.CustomMaterial("planemat" + i, this._scene);
            plane.material = mat;

            mat.AddUniform("multiplier", "float", "1.0");
            mat.Fragment_Before_FragColor(`
                color.rgba *= vec4(multiplier);
            `);

            mat.disableLighting = true;

            grid.addColumnDefinition(1 / numTotalPlanes);

            const bkg = new BABYLON.GUI.Rectangle("text" + i);

            bkg.background = "green";
            bkg.color = "white";
            bkg.thickness = 2;
            bkg.width = 0.95;
            bkg.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            bkg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;

            this._guiBackgrounds.push(bkg);

            const text = new BABYLON.GUI.TextBlock("title" + i, "");

            text.color = "white";
            text.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            text.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
            text.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            text.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;

            this._guiTexts.push(text);

            const button = BABYLON.GUI.Button.CreateSimpleButton("button" + i, "Save");
            button.width = 0.7;
            button.color = "white";
            button.cornerRadius = 10;
            button.background = "green";
            button.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            button.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
            button.onPointerUpObservable.add(() => {
                const texture = (this._debugPlaneList[i].material as BABYLON.StandardMaterial).emissiveTexture;
                if (texture) {
                    const textureFormat = texture.getInternalTexture()?.format ?? BABYLON.Constants.TEXTUREFORMAT_RGBA;
                    texture.readPixels()!.then((buffer) => {
                        const channels =
                            textureFormat === BABYLON.Constants.TEXTUREFORMAT_R  ? ["R"] :
                            textureFormat === BABYLON.Constants.TEXTUREFORMAT_RG ? ["R", "G"] : ["R", "G", "B", "A"];
                        this._exrSerializer.serialize(texture.getSize().width, texture.getSize().height, new Float32Array(buffer.buffer), channels);
                        this._exrSerializer.download(this._debugPlaneList[i].name + ".exr");
                    });
                }
            });

            this._guiButtons.push(button);

            grid.addControl(bkg, 0, i);
            grid.addControl(text, 0, i);
            grid.addControl(button, 0, i)
        }

        for (let i = numPlanes; i < numTotalPlanes; ++i) {
            grid.addColumnDefinition(1 / numTotalPlanes);
        }

        this._resize();

        this._engine.onResizeObservable.add(this._resize.bind(this));
    }

    private _resize(): void {
        const screenWidth = this._engine.getRenderWidth();
        const screenHeight = this._engine.getRenderHeight();

        const ratio = screenWidth / screenHeight;

        this._camera.orthoLeft = -5 * ratio;
        this._camera.orthoRight = 5 * ratio;
        this._camera.orthoTop = 5;
        this._camera.orthoBottom = -5;

        this._camera.getProjectionMatrix(true);

        const invTransfMatrix = this._camera.getTransformationMatrix().invert();

        const p = new BABYLON.Vector3(-1, 1, 0 + 0.001);
        const q = new BABYLON.Vector3(-1, 1, 0 + 0.001);

        p.x += planeSpacing / 2;
        q.x += planeSpacing / 2;

        const planeSize = (2 - planeSpacing * numTotalPlanes) / numTotalPlanes;
        const y = Math.floor(screenHeight * planeSize * ratio / 2 + 5);

        this._guiBackgrounds[0].parent!.paddingTop = y + "px";

        for (let i = 0; i < this._debugPlaneList.length; ++i) {
            const plane = this._debugPlaneList[i];

            q.x += planeSize;

            const ip = BABYLON.Vector3.TransformCoordinates(p, invTransfMatrix);
            const iq = BABYLON.Vector3.TransformCoordinates(q, invTransfMatrix);
            const scale = iq.x - ip.x;

            plane.scaling.set(scale, scale, 1);
            plane.position.set(ip.x, ip.y, ip.z);

            q.x += planeSpacing;
            p.x = q.x;

            this._guiBackgrounds[i].height = (20 * screenWidth / 1920) + "px";
            this._guiTexts[i].height = (20 * screenWidth / 1920) + "px";
            this._guiTexts[i].fontSize = (8 * screenWidth / 1920) + "px";
            this._guiButtons[i].top = ((20 * screenWidth / 1920) + 2) + "px";
            this._guiButtons[i].height = (16 * screenWidth / 1920) + "px";
            this._guiButtons[i].fontSize = (8 * screenWidth / 1920) + "px";
        }
    }
}



const f32 = BABYLON.Tools.FloatRound;

const PI = f32(Math.PI);
const sunPosition = new Vector3Float32();
const sunDirection = new Vector3Float32();
const up = new Vector3Float32();
const temp1 = new Vector3Float32(); // simplifiedRayleigh
const temp2 = new Vector3Float32(); // totalMie
const temp3 = new Vector3Float32(); // retColor
const EE = f32(1000.0);
const cutoffAngle = f32(PI / f32(1.95));
const steepness = f32(1.5);
const v = f32(4.0);
const TwoPI = f32(2.0 * PI);
const lambda = new Vector3Float32(f32(680E-9), f32(550E-9), f32(450E-9));
const K = new Vector3Float32(f32(0.686), f32(0.678), f32(0.666));
const rayleighZenithLength = f32(8.4E3);
const mieZenithLength = f32(1.25E3);
const unitVec = new Vector3Float32(f32(1), f32(1), f32(1));
const twoVec = new Vector3Float32(f32(2), f32(2), f32(2));
const oneAndHalfVec = new Vector3Float32(f32(1.5), f32(1.5), f32(1.5));
const halfOneVec = new Vector3Float32(f32(0.5), f32(0.5), f32(0.5));
const tenthVec = new Vector3Float32(f32(0.1), f32(0.1), f32(0.1));
const texColorCst = new Vector3Float32(f32(f32(0.0) * f32(0.3)), f32(f32(0.001) * f32(0.3)), f32(f32(0.0025) * f32(0.3)));

(BABYLON.SkyMaterial.prototype as any).getSunColor = function() {
    const sunIntensity = (zenithAngleCos: number) => {
	    return f32(EE * Math.max(0.0, f32(1.0 - f32(Math.exp((-f32(cutoffAngle - f32(Math.acos(zenithAngleCos)))/f32(steepness)))))));
    };

    const simplifiedRayleigh = () => {
        const c = f32(0.0005);
        temp1.set(f32(c / 94), f32(c / 40), f32(c / 18));
        return temp1;
    };

    const totalMie = (lambda: Vector3Float32, K: Vector3Float32, T: number) => {
        const c = f32(f32((f32(0.2) * T)) * f32(10E-18));
        const p = f32(v - 2.0);
        const m = f32(f32(f32(0.434) * c) * PI);
        temp2.set(
            f32(f32(m * f32(Math.pow(f32(TwoPI / lambda.x), p))) * f32(K.x)),
            f32(f32(m * f32(Math.pow(f32(TwoPI / lambda.y), p))) * f32(K.y)),
            f32(f32(m * f32(Math.pow(f32(TwoPI / lambda.z), p))) * f32(K.z))
        );
        return temp2;
    };

    const rayleighPhase = (cosTheta: number) => {	 
        return f32(f32(3.0 / f32(16.0 * PI)) * f32(1.0 + f32(Math.pow(cosTheta, 2.0))));
    };

    const hgPhase = (cosTheta: number, g: number) => {
        return f32(f32(1.0 / f32(4.0 * PI)) * f32((f32(1.0 - f32(Math.pow(g, 2.0))) / f32(Math.pow(1.0 - f32(f32(2.0 * g) * cosTheta) + f32(Math.pow(g, 2.0)), 1.5)))));
    };

    const A = f32(0.15);
    const B = f32(0.50);
    const C = f32(0.10);
    const D = f32(0.20);
    const EEE = f32(0.02);
    const F = f32(0.30);
    const W = new Vector3Float32(f32(1000.0), f32(1000.0), f32(1000.0));

    const Uncharted2Tonemap = (x: Vector3Float32) => {
        const c1 = x.scale(A).addScalar(f32(C * B));
        const c2 = x.scale(A).addScalar(B);
        const c3 = x.multiply(c1).addScalar(f32(D * EEE));
        const c4 = x.multiply(c2).addScalar(f32(D * F));
        return c3.divide(c4).addScalar(-f32(EEE / F));
    };

    Vector3Float32.ToFloat32(this.sunPosition, sunPosition);
    Vector3Float32.ToFloat32(this.up, up);

	//float sunfade = 1.0 - clamp(1.0 - exp((sunPosition.y / 450000.0)), 0.0, 1.0);
	const sunfade = f32(1.0 - BABYLON.Scalar.Clamp(f32(1.0 - f32(Math.exp(f32(sunPosition.y / 450000.0)))), 0.0, 1.0));

	//float rayleighCoefficient = rayleigh - (1.0 * (1.0 - sunfade));
	const rayleighCoefficient = f32(f32(this.rayleigh) - (1.0 * f32(1.0 - sunfade)));

	//vec3 sunDirection = normalize(sunPosition);
    sunPosition.normalizeToRef(sunDirection);

	//float sunE = sunIntensity(dot(sunDirection, up));
	const sunE = sunIntensity(Vector3Float32.Dot(sunDirection, up));

	//vec3 betaR = simplifiedRayleigh() * rayleighCoefficient;
	const betaR = simplifiedRayleigh().scale(rayleighCoefficient);

	//vec3 betaM = totalMie(lambda, K, turbidity) * mieCoefficient;
	const betaM = totalMie(lambda, K, f32(this.turbidity)).scale(f32(this.mieCoefficient));

	//float zenithAngle = acos(max(0.0, sunDirection.y));
	const zenithAngle = f32(Math.acos(Math.max(0.0, sunDirection.y)));

	//float sR = rayleighZenithLength / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
	const sR = f32(rayleighZenithLength / f32(f32(Math.cos(zenithAngle)) +
        f32(f32(0.15) * f32(Math.pow(f32(f32(93.885) - f32(f32(zenithAngle * 180.0) / PI)), f32(-1.253))))));

	//float sM = mieZenithLength / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
	const sM = f32(mieZenithLength / (f32(Math.cos(zenithAngle)) +
        f32(f32(0.15) * f32(Math.pow(f32(f32(93.885) - f32(f32(zenithAngle * 180.0) / PI)), f32(-1.253))))));

	//vec3 Fex = exp(-(betaR * sR + betaM * sM));
	const Fex = betaR.scale(sR).add(betaM.scale(sM));
    Fex.set(f32(Math.exp(-Fex.x)), f32(Math.exp(-Fex.y)), f32(Math.exp(-Fex.z)));

	const cosTheta = 1.0;

	//float rPhase = rayleighPhase(cosTheta*0.5+0.5);
	const rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);

	//vec3 betaRTheta = betaR * rPhase;
	const mPhase = hgPhase(cosTheta, f32(this.mieDirectionalG));

	//float mPhase = hgPhase(cosTheta, mieDirectionalG);
	const betaRTheta = betaR.scale(rPhase);

	//vec3 betaMTheta = betaM * mPhase;
	const betaMTheta = betaM.scale(mPhase);
	
	// vec3 Lin = pow(sunE * ((betaRTheta + betaMTheta) / (betaR + betaM)) * (1.0 - Fex),vec3(1.5));
    const f1 = betaRTheta.add(betaMTheta).divide(betaR.add(betaM)).scale(sunE); // sunE * ((betaRTheta + betaMTheta) / (betaR + betaM))
    let Lin = f1.multiply(unitVec.subtract(Fex)).pow(oneAndHalfVec);

	//Lin *= mix(vec3(1.0), pow(sunE * ((betaRTheta + betaMTheta) / (betaR + betaM)) * Fex, vec3(1.0 / 2.0)), clamp(pow(1.0-dot(up, sunDirection), 5.0), 0.0, 1.0));
    const l1 = f1.multiply(Fex).pow(halfOneVec);
    const l2 = BABYLON.Scalar.Clamp(f32(Math.pow(f32(1.0 - Vector3Float32.Dot(up, sunDirection)), 5.0)), 0, 1); // clamp(pow(1.0-dot(up, sunDirection), 5.0), 0.0, 1.0)

	Lin = Lin.multiply(Vector3Float32.Lerp(unitVec, l1, l2));

	//vec3 L0 = vec3(0.1) * Fex;
    const L0 = tenthVec.multiply(Fex);

	//L0 += (sunE * 19000.0 * Fex) * sundisk;
	const sundisk = 1.;
	L0.addInPlace(Fex.scale(f32(sunE * 19000.0)));

	//vec3 whiteScale = 1.0/Uncharted2Tonemap(vec3(W));
    const whiteScale = unitVec.divide(Uncharted2Tonemap(W));

	//vec3 texColor = (Lin+L0);
	//texColor *= 0.04;
	//texColor += vec3(0.0,0.001,0.0025)*0.3;
    const texColor = Lin.add(L0).scale(f32(0.04)).add(texColorCst);

    //vec3 curr = Uncharted2Tonemap((log2(2.0/pow(luminance, 4.0)))*texColor);
    const curr = Uncharted2Tonemap(texColor.scale(f32(Math.log2(f32(2.0 / f32(Math.pow(this.luminance, 4.0)))))));

    //vec3 retColor = curr*whiteScale;
    Vector3Float32.ClampToRef(curr.multiply(whiteScale), halfOneVec, unitVec, temp3);

    const retColor = new BABYLON.Color3(temp3.x, temp3.y, temp3.z);

    return retColor;
};






const initialSpectrumCS = `
let PI : f32 = 3.1415926;

[[group(0), binding(1)]] var WavesData : texture_storage_2d<rgba32float, write>;
[[group(0), binding(2)]] var H0K : texture_storage_2d<rg32float, write>;
[[group(0), binding(4)]] var Noise : texture_2d<f32>;

[[block]] struct Params {
    Size : u32;
    LengthScale : f32;
    CutoffHigh : f32;
    CutoffLow : f32;
    GravityAcceleration : f32;
    Depth : f32;
};

[[group(0), binding(5)]] var<uniform> params : Params;

struct SpectrumParameter {
	scale : f32;
	angle : f32;
	spreadBlend : f32;
	swell : f32;
	alpha : f32;
	peakOmega : f32;
	gamma : f32;
	shortWavesFade : f32;
};

[[block]] struct SpectrumParameters {
    elements : array<SpectrumParameter>;
};

[[group(0), binding(6)]] var<storage, read> spectrums : SpectrumParameters;

fn frequency(k: f32, g: f32, depth: f32) -> f32
{
	return sqrt(g * k * tanh(min(k * depth, 20.0)));
}

fn frequencyDerivative(k: f32, g: f32, depth: f32) -> f32
{
	let th = tanh(min(k * depth, 20.0));
	let ch = cosh(k * depth);
	return g * (depth * k / ch / ch + th) / frequency(k, g, depth) / 2.0;
}

fn normalisationFactor(s: f32) -> f32
{
	let s2 = s * s;
	let s3 = s2 * s;
	let s4 = s3 * s;
	if (s < 5.0) {
		return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
    }
	return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}

fn cosine2s(theta: f32, s: f32) -> f32
{
	return normalisationFactor(s) * pow(abs(cos(0.5 * theta)), 2.0 * s);
}

fn spreadPower(omega: f32, peakOmega: f32) -> f32
{
	if (omega > peakOmega) {
		return 9.77 * pow(abs(omega / peakOmega), -2.5);
	}
	return 6.97 * pow(abs(omega / peakOmega), 5.0);
}

fn directionSpectrum(theta: f32, omega: f32, pars: SpectrumParameter) -> f32
{
	let s = spreadPower(omega, pars.peakOmega) + 16.0 * tanh(min(omega / pars.peakOmega, 20.0)) * pars.swell * pars.swell;
	return mix(2.0 / PI * cos(theta) * cos(theta), cosine2s(theta - pars.angle, s), pars.spreadBlend);
}

fn TMACorrection(omega: f32, g: f32, depth: f32) -> f32
{
	let omegaH = omega * sqrt(depth / g);
	if (omegaH <= 1.0) {
		return 0.5 * omegaH * omegaH;
    }
	if (omegaH < 2.0) {
		return 1.0 - 0.5 * (2.0 - omegaH) * (2.0 - omegaH);
    }
	return 1.0;
}

fn JONSWAP(omega: f32, g: f32, depth: f32, pars: SpectrumParameter) -> f32
{
	var sigma: f32;
	if (omega <= pars.peakOmega) {
		sigma = 0.07;
    } else {
		sigma = 0.09;
    }
	let r = exp(-(omega - pars.peakOmega) * (omega - pars.peakOmega) / 2.0 / sigma / sigma / pars.peakOmega / pars.peakOmega);
	
	let oneOverOmega = 1.0 / omega;
	let peakOmegaOverOmega = pars.peakOmega / omega;

	return pars.scale * TMACorrection(omega, g, depth) * pars.alpha * g * g
		* oneOverOmega * oneOverOmega * oneOverOmega * oneOverOmega * oneOverOmega
		* exp(-1.25 * peakOmegaOverOmega * peakOmegaOverOmega * peakOmegaOverOmega * peakOmegaOverOmega)
		* pow(abs(pars.gamma), r);
}

fn shortWavesFade(kLength: f32, pars: SpectrumParameter) -> f32
{
	return exp(-pars.shortWavesFade * pars.shortWavesFade * kLength * kLength);
}

[[stage(compute), workgroup_size(8,8,1)]]
fn calculateInitialSpectrum([[builtin(global_invocation_id)]] id : vec3<u32>)
{
	let deltaK = 2.0 * PI / params.LengthScale;
	let nx = f32(id.x) - f32(params.Size) / 2.0;
	let nz = f32(id.y) - f32(params.Size) / 2.0;
	let k = vec2<f32>(nx, nz) * deltaK;
	let kLength = length(k);

	if (kLength <= params.CutoffHigh && kLength >= params.CutoffLow) {
		let omega = frequency(kLength, params.GravityAcceleration, params.Depth);
		textureStore(WavesData, vec2<i32>(id.xy), vec4<f32>(k.x, 1.0 / kLength, k.y, omega));

		let kAngle = atan2(k.y, k.x);
		let dOmegadk = frequencyDerivative(kLength, params.GravityAcceleration, params.Depth);
		var spectrum = JONSWAP(omega, params.GravityAcceleration, params.Depth, spectrums.elements[0]) * directionSpectrum(kAngle, omega, spectrums.elements[0]) * shortWavesFade(kLength, spectrums.elements[0]);
		if (spectrums.elements[1].scale > 0.0) {
			spectrum = spectrum + JONSWAP(omega, params.GravityAcceleration, params.Depth, spectrums.elements[1]) * directionSpectrum(kAngle, omega, spectrums.elements[1]) * shortWavesFade(kLength, spectrums.elements[1]);
        }
        let noise = textureLoad(Noise, vec2<i32>(id.xy), 0).xy;
        textureStore(H0K, vec2<i32>(id.xy), vec4<f32>(noise * sqrt(2.0 * spectrum * abs(dOmegadk) / kLength * deltaK * deltaK), 0., 0.));
	} else {
		textureStore(H0K, vec2<i32>(id.xy), vec4<f32>(0.0));
		textureStore(WavesData, vec2<i32>(id.xy), vec4<f32>(k.x, 1.0, k.y, 0.0));
	}    
}
`

const initialSpectrum2CS = `
[[group(0), binding(0)]] var H0 : texture_storage_2d<rgba32float, write>;

[[block]] struct Params {
    Size : u32;
    LengthScale : f32;
    CutoffHigh : f32;
    CutoffLow : f32;
    GravityAcceleration : f32;
    Depth : f32;
};

[[group(0), binding(5)]] var<uniform> params : Params;

[[group(0), binding(8)]] var H0K : texture_2d<f32>;

[[stage(compute), workgroup_size(8,8,1)]]
fn calculateConjugatedSpectrum([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let h0K = textureLoad(H0K, vec2<i32>(id.xy), 0).xy;
	let h0MinusK = textureLoad(H0K, vec2<i32>(i32(params.Size - id.x) % i32(params.Size), i32(params.Size - id.y) % i32(params.Size)), 0);

    textureStore(H0, vec2<i32>(id.xy), vec4<f32>(h0K.x, h0K.y, h0MinusK.x, -h0MinusK.y));
}
`

const fftPrecomputeCS = `
let PI: f32 = 3.1415926;

[[group(0), binding(0)]] var PrecomputeBuffer : texture_storage_2d<rgba32float, write>;

[[block]] struct Params {
    Step : i32;
    Size : i32;
};

[[group(0), binding(1)]] var<uniform> params : Params;

fn complexMult(a: vec2<f32>, b: vec2<f32>) -> vec2<f32>
{
	return vec2<f32>(a.r * b.r - a.g * b.g, a.r * b.g + a.g * b.r);
}

fn complexExp(a: vec2<f32>) -> vec2<f32>
{
	return vec2<f32>(cos(a.y), sin(a.y)) * exp(a.x);
}

[[stage(compute), workgroup_size(1,8,1)]]
fn precomputeTwiddleFactorsAndInputIndices([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);
	let b = params.Size >> (id.x + 1u);
	let mult = 2.0 * PI * vec2<f32>(0.0, -1.0) / f32(params.Size);
	let i = (2 * b * (iid.y / b) + (iid.y % b)) % params.Size;
	let twiddle = complexExp(mult * vec2<f32>(f32((iid.y / b) * b)));
	
    textureStore(PrecomputeBuffer, iid.xy, vec4<f32>(twiddle.x, twiddle.y, f32(i), f32(i + b)));
	textureStore(PrecomputeBuffer, vec2<i32>(iid.x, iid.y + params.Size / 2), vec4<f32>(-twiddle.x, -twiddle.y, f32(i), f32(i + b)));
}
`

const fftInverseFFTCS = `
[[block]] struct Params {
    Step : i32;
    Size : i32;
};

[[group(0), binding(1)]] var<uniform> params : Params;

[[group(0), binding(3)]] var PrecomputedData : texture_2d<f32>;

[[group(0), binding(5)]] var InputBuffer : texture_2d<f32>;
[[group(0), binding(6)]] var OutputBuffer : texture_storage_2d<rg32float, write>;

fn complexMult(a: vec2<f32>, b: vec2<f32>) -> vec2<f32>
{
	return vec2<f32>(a.r * b.r - a.g * b.g, a.r * b.g + a.g * b.r);
}

[[stage(compute), workgroup_size(8,8,1)]]
fn horizontalStepInverseFFT([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);
    let data = textureLoad(PrecomputedData, vec2<i32>(params.Step, iid.x), 0);
	let inputsIndices = vec2<i32>(data.ba);

    let input0 = textureLoad(InputBuffer, vec2<i32>(inputsIndices.x, iid.y), 0);
    let input1 = textureLoad(InputBuffer, vec2<i32>(inputsIndices.y, iid.y), 0);

    textureStore(OutputBuffer, iid.xy, vec4<f32>(
        input0.xy + complexMult(vec2<f32>(data.r, -data.g), input1.xy), 0., 0.
    ));
}
`

const fftInverseFFT2CS = `
[[block]] struct Params {
    Step : i32;
    Size : i32;
};

[[group(0), binding(1)]] var<uniform> params : Params;

[[group(0), binding(3)]] var PrecomputedData : texture_2d<f32>;

[[group(0), binding(5)]] var InputBuffer : texture_2d<f32>;
[[group(0), binding(6)]] var OutputBuffer : texture_storage_2d<rg32float, write>;

fn complexMult(a: vec2<f32>, b: vec2<f32>) -> vec2<f32>
{
	return vec2<f32>(a.r * b.r - a.g * b.g, a.r * b.g + a.g * b.r);
}

[[stage(compute), workgroup_size(8,8,1)]]
fn verticalStepInverseFFT([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);
    let data = textureLoad(PrecomputedData, vec2<i32>(params.Step, iid.y), 0);
	let inputsIndices = vec2<i32>(data.ba);

    let input0 = textureLoad(InputBuffer, vec2<i32>(iid.x, inputsIndices.x), 0);
    let input1 = textureLoad(InputBuffer, vec2<i32>(iid.x, inputsIndices.y), 0);

    textureStore(OutputBuffer, iid.xy, vec4<f32>(
        input0.xy + complexMult(vec2<f32>(data.r, -data.g), input1.xy), 0., 0.
    ));
}
`

const fftInverseFFT3CS = `
[[group(0), binding(5)]] var InputBuffer : texture_2d<f32>;
[[group(0), binding(6)]] var OutputBuffer : texture_storage_2d<rg32float, write>;

[[stage(compute), workgroup_size(8,8,1)]]
fn permute([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);
    let input = textureLoad(InputBuffer, iid.xy, 0);

    textureStore(OutputBuffer, iid.xy, input * (1.0 - 2.0 * f32((iid.x + iid.y) % 2)));
}
`

const timeDependentSpectrumCS = `
[[group(0), binding(1)]] var H0 : texture_2d<f32>;
[[group(0), binding(3)]] var WavesData : texture_2d<f32>;

[[block]] struct Params {
    Time : f32;
};

[[group(0), binding(4)]] var<uniform> params : Params;

[[group(0), binding(5)]] var DxDz : texture_storage_2d<rg32float, write>;
[[group(0), binding(6)]] var DyDxz : texture_storage_2d<rg32float, write>;
[[group(0), binding(7)]] var DyxDyz : texture_storage_2d<rg32float, write>;
[[group(0), binding(8)]] var DxxDzz : texture_storage_2d<rg32float, write>;

fn complexMult(a: vec2<f32>, b: vec2<f32>) -> vec2<f32>
{
	return vec2<f32>(a.r * b.r - a.g * b.g, a.r * b.g + a.g * b.r);
}

[[stage(compute), workgroup_size(8,8,1)]]
fn calculateAmplitudes([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);
	let wave = textureLoad(WavesData, iid.xy, 0);
	let phase = wave.w * params.Time;
	let exponent = vec2<f32>(cos(phase), sin(phase));
    let h0 = textureLoad(H0, iid.xy, 0);
	let h = complexMult(h0.xy, exponent) + complexMult(h0.zw, vec2<f32>(exponent.x, -exponent.y));
	let ih = vec2<f32>(-h.y, h.x);

	let displacementX = ih * wave.x * wave.y;
	let displacementY = h;
	let displacementZ = ih * wave.z * wave.y;

	let displacementX_dx = -h * wave.x * wave.x * wave.y;
	let displacementY_dx = ih * wave.x;
	let displacementZ_dx = -h * wave.x * wave.z * wave.y;
		 
	let displacementY_dz = ih * wave.z;
	let displacementZ_dz = -h * wave.z * wave.z * wave.y;

	textureStore(DxDz,   iid.xy, vec4<f32>(displacementX.x - displacementZ.y, displacementX.y + displacementZ.x, 0., 0.));
	textureStore(DyDxz,  iid.xy, vec4<f32>(displacementY.x - displacementZ_dx.y, displacementY.y + displacementZ_dx.x, 0., 0.));
	textureStore(DyxDyz, iid.xy, vec4<f32>(displacementY_dx.x - displacementY_dz.y, displacementY_dx.y + displacementY_dz.x, 0., 0.));
	textureStore(DxxDzz, iid.xy, vec4<f32>(displacementX_dx.x - displacementZ_dz.y, displacementX_dx.y + displacementZ_dz.x, 0., 0.));
}
`

const wavesTexturesMergerCS = `
[[block]] struct Params {
    Lambda : f32;
    DeltaTime : f32;
};

[[group(0), binding(0)]] var<uniform> params : Params;

[[group(0), binding(1)]] var Displacement : texture_storage_2d<rgba16float, write>;
[[group(0), binding(2)]] var Derivatives : texture_storage_2d<rgba16float, write>;
[[group(0), binding(3)]] var TurbulenceRead : texture_2d<f32>;
[[group(0), binding(4)]] var TurbulenceWrite : texture_storage_2d<rgba16float, write>;

[[group(0), binding(5)]] var Dx_Dz : texture_2d<f32>;
[[group(0), binding(6)]] var Dy_Dxz : texture_2d<f32>;
[[group(0), binding(7)]] var Dyx_Dyz : texture_2d<f32>;
[[group(0), binding(8)]] var Dxx_Dzz : texture_2d<f32>;

[[stage(compute), workgroup_size(8,8,1)]]
fn fillResultTextures([[builtin(global_invocation_id)]] id : vec3<u32>)
{
    let iid = vec3<i32>(id);

	let DxDz = textureLoad(Dx_Dz, iid.xy, 0);
	let DyDxz = textureLoad(Dy_Dxz, iid.xy, 0);
	let DyxDyz = textureLoad(Dyx_Dyz, iid.xy, 0);
	let DxxDzz = textureLoad(Dxx_Dzz, iid.xy, 0);
	
	textureStore(Displacement, iid.xy, vec4<f32>(params.Lambda * DxDz.x, DyDxz.x, params.Lambda * DxDz.y, 0.));
	textureStore(Derivatives, iid.xy, vec4<f32>(DyxDyz.x, DyxDyz.y, DxxDzz.x * params.Lambda, DxxDzz.y * params.Lambda));

	let jacobian = (1.0 + params.Lambda * DxxDzz.x) * (1.0 + params.Lambda * DxxDzz.y) - params.Lambda * params.Lambda * DyDxz.y * DyDxz.y;

    var turbulence = textureLoad(TurbulenceRead, iid.xy, 0).r + params.DeltaTime * 0.5 / max(jacobian, 0.5);
    turbulence = min(jacobian, turbulence);

    textureStore(TurbulenceWrite, iid.xy, vec4<f32>(turbulence, turbulence, turbulence, 1.));
}
`