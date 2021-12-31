import { HemisphericLight } from "@babylonjs/core"
import { Engine } from "@babylonjs/core/Engines/engine"
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Texture } from "@babylonjs/core/Materials/Textures"
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import { Vector3 } from "@babylonjs/core/Maths/math.vector"
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Scene } from "@babylonjs/core/scene"
import { AdvancedDynamicTexture, Button, Container, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui/2D"
//import "@babylonjs/inspector"
import "@babylonjs/loaders/glTF"
import { AudioManager } from "./AudioManager"
import { Config } from "./Config"
import { FullScreenUI } from "./FullScreenUI"
import { Player } from "./Player"

export class GoalMesh {
  private mesh: AbstractMesh
  private goalTextMesh: AbstractMesh
  private level: Level

  constructor(level: Level, mesh: AbstractMesh) {
    this.level = level
    this.mesh = mesh
    this.addGoalUI()
  }

  private addGoalUI() {
    const dim = this.mesh.getBoundingInfo().maximum.multiply(this.mesh.scaling)
    const verticalOffset = 3 // 2 units above top of mesh
    this.goalTextMesh = MeshBuilder.CreatePlane(
      "goalTextPlane",
      { width: dim.x * 4, height: dim.y * 4 },
      this.level.scene
    )
    this.goalTextMesh.position.set(
      this.mesh.position.x,
      this.mesh.position.y + dim.y + verticalOffset,
      this.mesh.position.z
    )
    // render this mesh in front of everything
    this.goalTextMesh.renderingGroupId = 1
    const ui = AdvancedDynamicTexture.CreateForMesh(this.goalTextMesh, 1024, 1024, false)
    const text = new TextBlock()
    text.text = "Goal"
    text.color = "white"
    text.fontSize = 400
    ui.addControl(text)
  }

  private showGoalPopup() {
    // popup window
    const rectangle = new Rectangle()
    rectangle.background = "#878BFF"
    rectangle.color = "black"
    rectangle.cornerRadius = 20
    rectangle.thickness = 5
    rectangle.widthInPixels = 600
    rectangle.heightInPixels = 400
    this.level.ui.advancedTexture.addControl(rectangle)

    // stack panel
    const stackPanel = new StackPanel("goalStackpanel")
    stackPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    rectangle.addControl(stackPanel)

    // popup text
    const goalText = new TextBlock("goalText")
    goalText.paddingBottomInPixels = 20
    goalText.fontFamily = "Helvetica"
    goalText.textWrapping = true
    goalText.lineSpacing = 15
    goalText.text =
      "Congratulations, you beat the map!\nYour final time was " +
      this.level.startLevelTimer.timeSpent.toFixed(1) +
      " seconds.\nYour current position on the leaderboard: 1st"
    goalText.color = "white"
    goalText.fontSize = 24
    goalText.widthInPixels = 550
    goalText.heightInPixels = 200
    stackPanel.addControl(goalText)

    // panel for buttons
    const panel = new StackPanel("goalButtonPanel")
    panel.width = stackPanel.width
    panel.widthInPixels = 400
    panel.heightInPixels = 100
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    panel.isVertical = false
    stackPanel.addControl(panel)

    // restart button
    const restartButton = this.createButton("restartButton", "Restart", panel)
    restartButton.paddingRightInPixels = 15
    restartButton.onPointerClickObservable.add(() => {
      this.level.restart()
      this.level.setFrozen(false)
      rectangle.dispose()
    })

    // view leaderboard button
    const boardButton = this.createButton("boardButton", "View Leaderboard", panel)
    boardButton.paddingLeftInPixels = 15
    boardButton.onPointerClickObservable.add(() => {
      // TODO - leaderboard does not exist yet
    })

    // back-to-lobby button
    const backButton = this.createButton("backButton", "Back to lobby", stackPanel)
    backButton.onPointerClickObservable.add(() => {
      // TODO - lobby does not exist yet
    })
  }

  private createButton(name: string, text: string, parent?: Container): Button {
    const button = Button.CreateSimpleButton(name, text)
    button.widthInPixels = 200
    button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    button.heightInPixels = 60
    button.cornerRadius = 20
    button.thickness = 4
    button.children[0].color = "white"
    button.children[0].fontSize = 20
    button.color = "black"
    button.background = "#3FA938"
    parent.addControl(button)
    return button
  }

  public update() {
    // use onGround and onCeiling since apparently intersectsMesh doesn't work very well
    const playerMesh = this.level.player.mesh
    const onGround = playerMesh.isOnGround() && playerMesh.groundCollisionInfo.pickedMesh.uniqueId == this.mesh.uniqueId
    const onCeiling =
      playerMesh.isOnCeiling() && playerMesh.ceilingCollisionInfo.pickedMesh.uniqueId == this.mesh.uniqueId
    if (onGround || onCeiling || this.mesh.intersectsMesh(playerMesh.get())) {
      this.level.setFrozen(true)
      this.showGoalPopup()
    }
    // rotate goalTextMesh to always face towards the player
    const target = this.goalTextMesh.position.scale(2).subtract(playerMesh.get().position)
    this.goalTextMesh.lookAt(target)
  }
}

export class Timer {
  public timeSpent: number

  private ui: FullScreenUI
  private timerText: TextBlock
  private paused: boolean

  constructor(ui: FullScreenUI) {
    this.timeSpent = 0.0
    this.ui = ui
    this.show()
  }

  public restart() {
    this.timeSpent = 0
  }

  public start() {
    window.setInterval(() => {
      if (!this.paused) {
        this.timeSpent += 0.1
        this.timerText.text = this.timeSpent.toFixed(1)
      }
    }, 100)
  }

  public setPaused(paused: boolean) {
    this.paused = paused
  }

  private show() {
    const adt = this.ui.advancedTexture

    // popup text
    this.timerText = new TextBlock("timerText")
    this.timerText.color = "white"
    this.timerText.fontSize = 32
    this.timerText.widthInPixels = 200
    this.timerText.heightInPixels = 100
    this.timerText.fontFamily = "Helvetica"
    this.timerText.text = "0.0"
    this.timerText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
    this.timerText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM
    adt.addControl(this.timerText)
  }
}

export class Spawn {
  public lookAt: Vector3
  public spawnPoint: Vector3

  constructor(spawnPoint: Vector3, lookAt: Vector3) {
    this.lookAt = lookAt
    this.spawnPoint = spawnPoint
  }

  public clone(): Spawn {
    return new Spawn(this.spawnPoint.clone(), this.lookAt.clone())
  }
}

export class Level {
  public scene: Scene
  public player: Player
  public ui: FullScreenUI
  public audioManager: AudioManager
  public spawn: Spawn
  public goal: GoalMesh
  //public otherPlayersMap: Map<string, OtherPlayer>;
  public startLevelTimer: Timer
  public checkPointLimit: number

  private isFrozen: boolean
  private fileName: string

  constructor(fileName: string) {
    this.initializeScene()
    this.setupListeners()

    this.isFrozen = false
    this.fileName = fileName
    //this.otherPlayersMap = new Map;
    this.checkPointLimit = 5 // how many checkpoints can the player make per level
    this.player = new Player(this)
    this.audioManager = new AudioManager(this.scene)
  }

  private initializeScene() {
    this.scene = new Scene(Game.engine)
    this.scene.collisionsEnabled = true
    if (Config.showInspector) {
      this.scene.debugLayer.show()
    }
  }

  public async build() {
    await this.importLevel()
    // add a skybox internally to the level
    this.createSkyBox()
    await Promise.all([this.player.build(), this.audioManager.loadAudio()])
    this.ui = new FullScreenUI()

    this.startLevelTimer = new Timer(this.ui)
    this.startLevelTimer.start()
  }

  private async importLevel() {
    await SceneLoader.AppendAsync("assets/scenes/", this.fileName, this.scene)
    this.applyModifiers()
  }

  private applyModifiers() {
    this.scene.meshes.forEach((mesh) => {
      // set colliders and whether we can pick mesh with raycast
      const isCollider = mesh.name.includes("Collider")
      mesh.checkCollisions = isCollider
      mesh.isPickable = isCollider
    })

    // If no lightning is added from blender add it manually
    if (this.scene.lights.length == 0) {
      this.setupLighting()
    } else {
    }

    this.setupSpawn()
    this.setupGoal()
  }

  private setupSpawn() {
    let spawnMesh = this.scene.getMeshByName("Spawn")
    if (spawnMesh == null) {
      throw new Error("No mesh in scene with a 'Spawn' ID!")
    }
    const spawnPos = spawnMesh.position.clone()
    // get lookAt mesh for initial player view direction
    let lookAtMesh = this.scene.getMeshByName("LookAt")
    let lookAt = Vector3.Zero()
    if (lookAtMesh != null) {
      lookAt = lookAtMesh.position.clone()
    }
    this.spawn = new Spawn(spawnPos, lookAt)
    // destroy spawnMesh and lookAtMesh after they have been retrieved
    spawnMesh.dispose()
    spawnMesh = null
    // dispose only if LookAt exists as a mesh inside scene
    if (lookAtMesh) {
      lookAtMesh.dispose()
      lookAtMesh = null
    }
  }

  // todo - verify that there is only a single goal mesh
  private setupGoal() {
    const goalMesh = this.scene.getMeshByID("Goal")
    if (goalMesh == null) {
      throw new Error("No mesh in scene with a 'Goal' ID!")
    }
    this.goal = new GoalMesh(this, goalMesh)
  }

  private setupLighting() {
    // setup light
    new HemisphericLight("HemiLight", new Vector3(0, 1, 0), this.scene)
  }

  // called after finishing level
  public setFrozen(frozen: boolean) {
    // player can no longer move if frozen
    this.isFrozen = frozen
    this.startLevelTimer.setPaused(frozen)
    if (frozen) {
      this.exitPointerLock()
    }
  }

  // public async addNewOtherPlayer(playerSchema: PlayerSchema) {
  //     const otherPlayer = new OtherPlayer(playerSchema.sessionId, this);
  //     await otherPlayer.build();
  //     otherPlayer.update(playerSchema);
  //     this.otherPlayersMap.set(playerSchema.sessionId, otherPlayer);
  // }

  // public removeOtherPlayer(playerSchema: PlayerSchema) {
  //     this.otherPlayersMap.get(playerSchema.sessionId).dispose();
  //     this.otherPlayersMap.delete(playerSchema.sessionId);
  // }

  // public updateOtherPlayer(playerSchema: PlayerSchema) {
  //     const otherPlayer = this.otherPlayersMap.get(playerSchema.sessionId);
  //     if(otherPlayer) {
  //         otherPlayer.update(playerSchema);
  //     }
  // }

  public update() {
    this.scene.render()
  }

  public restart() {
    this.player.respawn()
    this.startLevelTimer.restart()
  }

  private setupListeners() {
    // Lock cursor
    Game.canvas.addEventListener(
      "click",
      () => {
        if (!this.isFrozen) {
          this.requestPointerLock()
        }
      },
      false
    )

    // update function for level components
    this.scene.registerBeforeRender(() => {
      if (!this.isFrozen) {
        this.player.update()
        this.goal.update()
      }
    })
  }

  private requestPointerLock() {
    if (Game.canvas.requestPointerLock) {
      Game.canvas.requestPointerLock()
    }
  }

  private exitPointerLock() {
    document.exitPointerLock()
  }

  private createSkyBox() {
    // creating skybox
    let skybox = MeshBuilder.CreateBox("skyBox", { size: 10000.0 }, this.scene)
    let skyboxMaterial = new StandardMaterial("skyboxMaterial", this.scene)
    skyboxMaterial.backFaceCulling = false
    skyboxMaterial.reflectionTexture = new CubeTexture("assets/textures/skybox", this.scene)
    skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0)
    skyboxMaterial.specularColor = new Color3(0, 0, 0)
    skybox.material = skyboxMaterial
  }
}

export class Game {
  public static canvas: HTMLCanvasElement
  public static engine: Engine
  public static currentLevel: Level

  constructor(canvasElement: string) {
    Game.canvas = document.getElementById(canvasElement) as HTMLCanvasElement
    Game.engine = new Engine(Game.canvas, true)

    this.init()
  }

  public init() {
    this.setupListeners()
    Game.currentLevel = new Level(Config.levelName)
    Game.canvas.focus()
  }

  public async start() {
    await Game.currentLevel.build()

    this.startGameLoop()
  }

  private startGameLoop() {
    Game.engine.runRenderLoop(() => {
      Game.currentLevel.update()

      let fpsLabel = document.getElementById("fps_label")
      fpsLabel.innerHTML = Game.engine.getFps().toFixed() + "FPS"
    })
  }

  private setupListeners() {
    window.addEventListener("resize", function () {
      Game.engine.resize()
    })
  }

  // private setupSockets() {
  //   const hostDevelopment = location.host.replace(/:.*/, "") // localhost
  //   const portDevelopment = location.port.slice(0, -1) + 1 // 8081
  //   let socketAddressDevelopment =
  //     location.protocol.replace("http", "ws") + "//" + hostDevelopment
  //   if (portDevelopment) {
  //     socketAddressDevelopment += ":" + portDevelopment
  //   }

  //   if (hostDevelopment === "localhost") {
  //     Game.client = new Client(socketAddressDevelopment)
  //   } else {
  //     Game.client = new Client(Config.socketAddressProduction)
  //   }

  //   console.log("DEV HOST: " + hostDevelopment)
  //   console.log("DEV PORT: " + portDevelopment)
  //   console.log("DEV SOCKET: " + socketAddressDevelopment)
  //   console.log("PROD SOCKET: " + Config.socketAddressProduction)
  // }
}
