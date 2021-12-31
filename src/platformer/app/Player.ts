import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup"
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera"
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera"
import { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo"
import { Ray } from "@babylonjs/core/Culling/ray"
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial"
import { Axis } from "@babylonjs/core/Maths/math.axis"
import { Color3 } from "@babylonjs/core/Maths/math.color"
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector"
import { Viewport } from "@babylonjs/core/Maths/math.viewport"
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh"
import { Mesh } from "@babylonjs/core/Meshes/mesh"
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Scene } from "@babylonjs/core/scene"
import { Control, TextBlock } from "@babylonjs/gui/2D"
import { AudioManager } from "./AudioManager"
import { Config } from "./Config"

import type { Level, Spawn } from "./Game"

// configurables
const SPEED_DEFAULT = 0.7
const SPEED_CROUCH = SPEED_DEFAULT * 0.5
const SPEED_JUMP = 0.4
const GRAVITY = 0.016
const GRAVITY_LIMIT = -(5 * SPEED_JUMP)

const PLAYER_HEIGHT = 8
const PLAYER_DIAMETER = 4 // of cylinder
const PLAYER_CROUCH_Y_SCALING = 0.65

// Camera y-position offsets (depends on player scale and stand/crouch)
const CAMERA_STAND_OFFSET = 0.35 * PLAYER_HEIGHT // half of height would place cam at top of mesh
const CAMERA_CROUCH_OFFSET = CAMERA_STAND_OFFSET * PLAYER_CROUCH_Y_SCALING

// Configuration for ArcRotateCamera
const THIRD_PERSON_ALPHA_OFFSET = -0.5 * Math.PI
const THIRD_PERSON_BETA_OFFSET = 0.5 * Math.PI

export class CheckPoint {
  public position: Vector3
  public cameraRotation: Vector3

  private player: Player
  private count: number
  private limit: number
  private timeoutHandle: number
  private uiText: TextBlock

  constructor(player: Player) {
    this.player = player
    this.count = 0
    this.limit = this.player.level.checkPointLimit
    this.set()
  }

  private set() {
    this.position = this.player.mesh.get().position.clone()
    this.cameraRotation = this.player.camera.get().rotation.clone()
  }

  public save(onGround: boolean) {
    // do not make checkpoint if player can not make more checkpoints
    if (this.count >= this.limit) {
      this.showMessage("You have no more checkpoints left!", true)
    }
    // do not allow checkpoint if player is not standing on the ground
    else if (!onGround) {
      this.showMessage("You must be on the ground!", true)
    } else {
      this.set()
      this.count++
      this.showMessage("Created a new checkpoint (" + this.count + "/" + this.limit + ")")
    }
  }

  public load() {
    this.player.mesh.get().position = this.position.clone()
    this.player.camera.get().position = this.position.clone()
    this.player.camera.get().rotation = this.cameraRotation.clone()
    this.player.hSpeed = 0
    this.player.vSpeed = 0
    this.showMessage("Loaded your latest checkpoint!")
  }

  private showMessage(message: string, isError = false) {
    if (this.uiText) {
      this.uiText.dispose()
    }
    this.uiText = new TextBlock("checkpointText")
    this.uiText.color = isError ? "red" : "green"
    this.uiText.fontSize = 32
    this.uiText.widthInPixels = 1000
    this.uiText.heightInPixels = 100
    this.uiText.fontFamily = "Helvetica"
    this.uiText.text = message
    this.uiText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    this.uiText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    this.uiText.top = -100
    this.player.level.ui.advancedTexture.addControl(this.uiText)

    window.clearTimeout(this.timeoutHandle)
    this.timeoutHandle = window.setTimeout(() => {
      this.uiText.dispose()
      this.uiText = null
    }, 5000)
  }
}

export class Player {
  public level: Level
  public mesh: PlayerMesh
  public crouching: boolean

  protected standMesh: PlayerMesh
  protected crouchMesh: PlayerMesh
  public spawn: Spawn
  public controls: PlayerControls
  public camera: PlayerCamera
  public hSpeed: number
  public vSpeed: number

  // locks are used to prevent user from spamming the key by holding it
  private jumpingLock: boolean
  private checkPointLock: boolean
  private gotoCheckPointLock: boolean
  private restartLock: boolean
  private checkPoint: CheckPoint
  private audioManager: AudioManager
  private prevOnGroundDir: MoveDirection // used to make player move same direction when jumping/falling

  constructor(level: Level, isOtherPlayer: boolean = false) {
    this.hSpeed = 0
    this.vSpeed = 0
    this.prevOnGroundDir = MoveDirection.IDLE
    this.controls = new PlayerControls()
    this.level = level

    const modelScaling = 4.5
    const standAnimSpeedRatio = 1
    const crouchAnimSpeedRatio = 1.3
    this.standMesh = new PlayerMesh(
      "playerStand",
      "stand.glb",
      PLAYER_HEIGHT,
      PLAYER_DIAMETER,
      modelScaling,
      standAnimSpeedRatio,
      this.level.scene,
      isOtherPlayer
    )
    this.crouchMesh = new PlayerMesh(
      "playerCrouch",
      "crouch.glb",
      PLAYER_HEIGHT * PLAYER_CROUCH_Y_SCALING,
      PLAYER_DIAMETER,
      modelScaling,
      crouchAnimSpeedRatio,
      this.level.scene,
      isOtherPlayer
    )
  }

  protected switchMesh(doCrouch: boolean) {
    // if standing, switch to the crouching mesh and vica versa
    const tempMesh = doCrouch ? this.crouchMesh : this.standMesh
    tempMesh.get().position = this.mesh.get().position.clone()
    tempMesh.get().rotation = this.mesh.get().rotation.clone()
    this.mesh.setEnabled(false)
    tempMesh.setEnabled(true)
    this.mesh = tempMesh
  }

  public dispose() {
    this.standMesh.dispose()
    this.crouchMesh.dispose()
  }

  public getMoveDirection(keys: IMoveKeys): MoveDirection {
    if (keys.up && keys.left && !keys.down && !keys.right) {
      return MoveDirection.FORWARD_LEFT
    } else if (keys.up && keys.right && !keys.down && !keys.left) {
      return MoveDirection.FORWARD_RIGHT
    } else if (keys.down && keys.left && !keys.up && !keys.right) {
      return MoveDirection.BACK_LEFT
    } else if (keys.down && keys.right && !keys.up && !keys.left) {
      return MoveDirection.BACK_RIGHT
    }

    if (keys.up && !keys.down) {
      return MoveDirection.FORWARD
    } else if (keys.down && !keys.up) {
      return MoveDirection.BACK
    } else if (keys.left && !keys.right) {
      return MoveDirection.LEFT
    } else if (keys.right && !keys.left) {
      return MoveDirection.RIGHT
    }
    return MoveDirection.IDLE
  }

  public async build() {
    await Promise.all([this.standMesh.build(), this.crouchMesh.build()])

    // start by standing up
    this.mesh = this.standMesh
    this.crouchMesh.setEnabled(false)
    this.mesh.get().position = this.level.spawn.spawnPoint.clone()
    this.spawn = this.level.spawn
    this.camera = new PlayerCamera(this)
    this.checkPoint = new CheckPoint(this)
    this.audioManager = this.level.audioManager
  }

  public respawn() {
    this.standMesh.get().position = this.level.spawn.spawnPoint.clone()
    this.crouchMesh.get().position = this.level.spawn.spawnPoint.clone()
    this.switchMesh(false)
    this.crouching = false
    this.hSpeed = 0
    this.vSpeed = 0
    this.prevOnGroundDir = MoveDirection.IDLE
    this.camera.reset()
    this.checkPoint = new CheckPoint(this)
  }

  public setVisible(visible: boolean) {
    this.standMesh.setVisible(visible)
    this.crouchMesh.setVisible(visible)
  }

  public update() {
    // mesh.update casts new rays for collision detection (ground and ceiling)
    this.mesh.update()
    // define constants to be used below
    const keys = this.controls.keys
    const deltaTime = this.level.scene.getAnimationRatio()
    const canStand = this.canStand()
    const onGround = this.mesh.isOnGround()
    const onCeiling = this.mesh.isOnCeiling()
    const moveDirection = this.getMoveDirection(keys)

    this.handlePlayerMovement(keys, deltaTime, canStand, onGround, onCeiling, moveDirection)

    // handle checkpoint keys
    if (keys.checkpoint && !this.checkPointLock) {
      this.checkPoint.save(onGround)
    }
    this.checkPointLock = keys.checkpoint
    if (keys.gotoCheckpoint && !this.gotoCheckPointLock) {
      this.checkPoint.load()
    }
    this.gotoCheckPointLock = keys.gotoCheckpoint

    // handle restart key
    if (keys.restart && !this.restartLock) {
      this.level.restart()
    }
    this.restartLock = keys.restart

    // handle camera keys
    if (keys.selectFirstPersonCamera) {
      this.camera.selectFirstPerson()
    } else if (keys.selectThirdPersonCamera) {
      this.camera.selectThirdPerson()
    }

    // update animations
    this.mesh.animator.update(moveDirection, onGround)

    // play sounds based on movement
    this.updatePlayerSounds(onGround, moveDirection)

    // update camera position and rotation
    this.camera.update()

    // update collision-mesh position, if enabled
    if (Config.debugPlayer) {
      this.mesh.ellipsoidMesh.position = this.mesh.get().position.add(this.mesh.get().ellipsoidOffset)
    }
  }

  private handlePlayerMovement(
    keys: IKeys,
    deltaTime: number,
    canStand: boolean,
    onGround: boolean,
    onCeiling: boolean,
    moveDirection: MoveDirection
  ) {
    // rotate mesh based on camera movement
    this.mesh.get().rotation.y = this.camera.get().rotation.y

    const moveVector = Vector3.Zero()
    this.setHorizontalMovement(moveVector, moveDirection, onGround)
    this.setVerticalMovement(moveVector, onGround, canStand, onCeiling, deltaTime, keys)

    // change mesh height if crouching
    if (keys.crouch != this.crouching) {
      this.crouch(keys.crouch, onGround, canStand)
    }

    // perform the movement
    this.mesh.get().moveWithCollisions(moveVector)
  }

  private setHorizontalMovement(moveVector: Vector3, currMoveDir: MoveDirection, onGround: boolean) {
    let moveDir
    if (onGround) {
      moveDir = currMoveDir
      this.prevOnGroundDir = currMoveDir
    } else {
      moveDir = this.prevOnGroundDir
    }

    const temp = this.getMoveVectorFromMoveDir(moveDir)
    moveVector.set(temp.x, temp.y, temp.z)

    // set hSpeed according to crouch
    if (this.crouching) {
      this.hSpeed = SPEED_CROUCH
    } else {
      this.hSpeed = SPEED_DEFAULT
    }

    // change to local space
    const m = Matrix.RotationAxis(Axis.Y, this.mesh.get().rotation.y)
    Vector3.TransformCoordinatesToRef(moveVector, m, moveVector)

    // Ensure diagonal is not faster than straight
    moveVector.normalize().scaleInPlace(this.hSpeed)
  }

  private setVerticalMovement(
    moveVector: Vector3,
    onGround: boolean,
    canStand: boolean,
    onCeiling: boolean,
    deltaTime: number,
    keys: IKeys
  ) {
    if (onGround && this.vSpeed <= 0) {
      // don't trigger if moving upwards
      // landing
      if (this.vSpeed < 0) {
        this.vSpeed = 0
      }
      // change vertical speed if jumping
      if (keys.jump && !this.jumpingLock && canStand) {
        this.vSpeed = SPEED_JUMP
        this.audioManager.playJump(true)
      }
      this.jumpingLock = keys.jump
    } else {
      // not on ground
      if (onCeiling && this.vSpeed >= 0) {
        // don't trigger if falling
        this.vSpeed = 0
      }
      // apply gravity (multiply with deltaTime cause it's an acceleration)
      this.vSpeed -= GRAVITY * deltaTime
      // clamp vSpeed
      if (this.vSpeed < GRAVITY_LIMIT) {
        this.vSpeed = GRAVITY_LIMIT
      }
      moveVector.y = this.vSpeed
      // scale movement with delta time
      moveVector.scaleInPlace(deltaTime)
    }
  }

  private getMoveVectorFromMoveDir(moveDir: MoveDirection): Vector3 {
    switch (moveDir) {
      case MoveDirection.FORWARD:
        return new Vector3(0, 0, 1)
      case MoveDirection.FORWARD_LEFT:
        return new Vector3(-1, 0, 1)
      case MoveDirection.FORWARD_RIGHT:
        return new Vector3(1, 0, 1)
      case MoveDirection.LEFT:
        return new Vector3(-1, 0, 0)
      case MoveDirection.RIGHT:
        return new Vector3(1, 0, 0)
      case MoveDirection.BACK:
        return new Vector3(0, 0, -1)
      case MoveDirection.BACK_LEFT:
        return new Vector3(-1, 0, -1)
      case MoveDirection.BACK_RIGHT:
        return new Vector3(1, 0, -1)
    }
    return Vector3.Zero()
  }

  private updatePlayerSounds(onGround: boolean, moveDirection: MoveDirection) {
    const isRunning = this.isRunning(onGround, moveDirection)
    const isCrouchWalking = this.isCrouchWalking(onGround, moveDirection)
    this.audioManager.playRun(isRunning && !isCrouchWalking)
    this.audioManager.playCrouchWalk(!isRunning && isCrouchWalking)
  }

  private isRunning(isOnGround: boolean, moveDirection: MoveDirection) {
    if (this.crouching || !isOnGround) {
      return false
    }
    return moveDirection != MoveDirection.IDLE
  }

  private isCrouchWalking(isOnGround: boolean, moveDirection: MoveDirection) {
    if (!this.crouching || !isOnGround) {
      return false
    }
    return moveDirection != MoveDirection.IDLE
  }

  private canStand(): boolean {
    if (!this.crouching) return true
    const offset = PLAYER_CROUCH_Y_SCALING * PLAYER_HEIGHT
    return !this.mesh.isOnCeiling(offset)
  }

  private crouch(doCrouch: boolean, onGround: boolean, canStand: boolean) {
    if (this.crouching == doCrouch) {
      return
    }
    if (!doCrouch && onGround && !canStand) {
      // standing up would place us inside a mesh
      return
    }
    this.crouching = doCrouch
    this.switchMesh(doCrouch)

    // adjust mesh position, which depends on whether we are on the ground
    // we want mesh height to change top-down if standing on the ground and bottom-up if airborne
    let changeY = PLAYER_HEIGHT * (1 - PLAYER_CROUCH_Y_SCALING) * 0.5
    if (onGround == doCrouch) {
      changeY = -changeY
    }
    this.mesh.get().position.y += changeY

    // if we stand up just before hitting the ground, the mesh will be stuck in ground
    // we fix this by doing a new onGround raycast and reset vertical position
    if (!doCrouch && !onGround) {
      // this is only an issue when we are not already on the ground
      this.mesh.setToGroundLevel()
    }

    this.camera.setCrouch(doCrouch)
  }

  public getPosition(): Vector3 {
    return this.mesh.get().position
  }

  public getDirection(): Vector3 {
    return this.mesh.get().rotation
  }
}

enum Perspective {
  FIRST_PERSON,
  THIRD_PERSON
}

export class PlayerCamera {
  private firstPersonCamera: UniversalCamera
  private thirdPersonCamera: ArcRotateCamera
  private scene: Scene
  private player: Player
  private cameraOffset: number // y-axis camera offset, changes when crouching
  private currentPerspective: Perspective

  constructor(player: Player) {
    this.player = player
    this.scene = this.player.level.scene
    this.cameraOffset = CAMERA_STAND_OFFSET

    this.setupFirstPersonCamera()
    this.setupThirdPersonCamera()
    this.selectFirstPerson()

    this.reset()
  }

  // firstperson camera is the default camera that we use to change the rotation of the player mesh
  public get(): UniversalCamera {
    return this.firstPersonCamera
  }

  private setupFirstPersonCamera() {
    this.firstPersonCamera = new UniversalCamera(
      "playerfirstperson",
      this.player.spawn.spawnPoint.clone(),
      this.player.level.scene
    )
    //this.firstPersonCamera.attachControl(Game.canvas, true)
    this.firstPersonCamera.attachControl(null, true)
    this.firstPersonCamera.inertia = 0.1
    this.firstPersonCamera.angularSensibility = 800
    this.firstPersonCamera.checkCollisions = false
    this.scene.activeCameras.push(this.firstPersonCamera)

    // remove key events (this is handled in player)
    this.firstPersonCamera.keysUp = [] // W or UP Arrow
    this.firstPersonCamera.keysDown = [] // S or DOWN ARROW
    this.firstPersonCamera.keysLeft = [] // A or LEFT ARROW
    this.firstPersonCamera.keysRight = [] // D or RIGHT ARROW
    this.firstPersonCamera.speed = 0
  }

  private setupThirdPersonCamera() {
    const alpha = -0.5 * Math.PI
    const beta = 0.5 * Math.PI
    const distance = 30
    this.thirdPersonCamera = new ArcRotateCamera(
      "playerthirdperson",
      alpha,
      beta,
      distance,
      this.player.spawn.spawnPoint.clone(),
      this.scene
    )
    const cam = this.thirdPersonCamera
    this.scene.activeCameras.push(cam)

    cam.inertia = 0.1
    cam.checkCollisions = false
    cam.setTarget(this.player.mesh.get())
  }

  public selectFirstPerson() {
    if (this.currentPerspective != Perspective.FIRST_PERSON) {
      this.currentPerspective = Perspective.FIRST_PERSON
      this.firstPersonCamera.viewport = new Viewport(0, 0, 1, 1)
      this.thirdPersonCamera.viewport = new Viewport(0, 0, 0, 0)
      this.scene.cameraToUseForPointers = this.firstPersonCamera

      this.player.setVisible(false)
    }
  }

  public selectThirdPerson() {
    if (this.currentPerspective != Perspective.THIRD_PERSON) {
      this.currentPerspective = Perspective.THIRD_PERSON
      this.firstPersonCamera.viewport = new Viewport(0, 0, 0, 0)
      this.thirdPersonCamera.viewport = new Viewport(0, 0, 1, 1)
      this.scene.cameraToUseForPointers = this.thirdPersonCamera

      this.player.setVisible(true)
    }
  }

  public reset() {
    this.resetFirstPersonCamera()
    this.resetThirdPersonCamera()
  }

  private resetFirstPersonCamera() {
    // set target to view direction
    this.firstPersonCamera.position = this.player.spawn.spawnPoint.clone()
    this.firstPersonCamera.setTarget(this.player.spawn.lookAt.clone())
  }

  private resetThirdPersonCamera() {
    this.thirdPersonCamera.setTarget(this.player.mesh.get())
    this.thirdPersonCamera.radius = 30
  }

  public update() {
    // set camera position equal to mesh position
    // also increase height of camera to match top of cylinder
    const pos = this.player.mesh.get().position
    this.firstPersonCamera.position.set(pos.x, pos.y + this.cameraOffset, pos.z)

    this.thirdPersonCamera.alpha = THIRD_PERSON_ALPHA_OFFSET - this.firstPersonCamera.rotation.y
    this.thirdPersonCamera.beta = THIRD_PERSON_BETA_OFFSET - this.firstPersonCamera.rotation.x
  }

  public setCrouch(doCrouch: boolean) {
    // adjust camera offset accordingly
    this.cameraOffset = doCrouch ? CAMERA_CROUCH_OFFSET : CAMERA_STAND_OFFSET
    this.resetThirdPersonCamera()
  }
}

// export interface IKeys {
//   up: boolean
//   down: boolean
//   left: boolean
//   right: boolean
//   jump: boolean
//   crouch: boolean
//   checkpoint: boolean
//   gotoCheckpoint: boolean
//   restart: boolean
//   selectFirstPersonCamera: boolean
//   selectThirdPersonCamera: boolean
// }

export type IKeys = PlayerControls["keys"]

// used for receiving other player keys from server where we don't care about all keys
export interface IMoveKeys {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  jump: boolean
}

export class PlayerControls {
  public keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    checkpoint: false,
    gotoCheckpoint: false,
    restart: false,
    selectFirstPersonCamera: false,
    selectThirdPersonCamera: false
  }

  constructor() {
    this.setupListeners()
  }

  private setupListeners() {
    window.onkeydown = (e: KeyboardEvent) => this.handleKey(e.code, true)
    window.onkeyup = (e: KeyboardEvent) => this.handleKey(e.code, false)
  }

  private handleKey(code: string, keydown: boolean) {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        this.keys.up = keydown
        break
      case "KeyA":
      case "ArrowLeft":
        this.keys.left = keydown
        break
      case "KeyS":
      case "ArrowDown":
        this.keys.down = keydown
        break
      case "KeyD":
      case "ArrowRight":
        this.keys.right = keydown
        break
      case "Space":
        this.keys.jump = keydown
        break
      case "KeyC":
        this.keys.crouch = keydown
        break
      case "KeyT":
        this.keys.checkpoint = keydown
        break
      case "KeyV":
        this.keys.gotoCheckpoint = keydown
        break
      case "KeyP":
        this.keys.restart = keydown
        break
      case "Digit1":
        this.keys.selectFirstPersonCamera = keydown
        break
      case "Digit2":
        this.keys.selectThirdPersonCamera = keydown
        break
    }
  }
}

// How many units away from roof/ground before we detect a collision?
const ROOF_COLLISION_THRESHOLD = 0.1
const GROUND_COLLISION_THRESHOLD = 0.1

// this class is a wrapper for the mesh class, and you can get the base mesh object by calling get()
export class PlayerMesh {
  public scene: Scene
  public ellipsoidMesh: Mesh
  public animator: PlayerAnimator
  public groundCollisionInfo: PickingInfo
  public ceilingCollisionInfo: PickingInfo

  private mesh: AbstractMesh
  private isOtherPlayer: boolean
  private height: number
  private width: number
  private name: string

  constructor(
    name: string,
    modelFileName: string,
    height: number,
    width: number,
    modelScaling: number,
    animationSpeedRatio: number,
    scene: Scene,
    isOtherPlayer: boolean
  ) {
    this.scene = scene
    this.height = height
    this.width = width
    this.name = name
    this.isOtherPlayer = isOtherPlayer
    this.animator = new PlayerAnimator(this, name, modelFileName, modelScaling, animationSpeedRatio)
  }

  public async build() {
    this.mesh = MeshBuilder.CreateCylinder(this.name, { height: this.height, diameter: this.width }, this.scene)
    this.mesh.isPickable = false
    this.mesh.checkCollisions = !this.isOtherPlayer
    this.mesh.isVisible = false

    // babylonjs uses ellipsoids to simulate mesh collisions when moving with camera, see: https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
    // sets the ellipsoid of this mesh to its bounding box
    if (!this.isOtherPlayer) {
      this.setEllipsoidToBoundingBox()
      if (Config.debugPlayer) {
        this.drawCollisionEllipsoid()
      }
    }

    // import and build animated models
    await this.animator.build()
  }

  public update() {
    this.groundCollisionInfo = this.castRayToGround()
    this.ceilingCollisionInfo = this.castRayToCeiling()
  }

  public get(): AbstractMesh {
    return this.mesh
  }

  public setVisible(visible: boolean) {
    // set visibility for all children (and not the parent mesh)
    this.mesh.getChildMeshes().forEach((child) => {
      child.isVisible = visible
    })
  }

  public isOnGround(verticalOffset = 0): boolean {
    let onGround = false
    const compareWith = this.mesh.getBoundingInfo().minimum.y + this.mesh.position.y + verticalOffset
    if (this.groundCollisionInfo && this.groundCollisionInfo.hit) {
      const pickedY = this.groundCollisionInfo.pickedPoint.y
      onGround = pickedY + GROUND_COLLISION_THRESHOLD >= compareWith
    }
    return onGround
  }

  public isOnCeiling(verticalOffset = 0): boolean {
    let onCeiling = false
    const compareWith = this.mesh.getBoundingInfo().maximum.y + this.mesh.position.y + verticalOffset
    if (this.ceilingCollisionInfo && this.ceilingCollisionInfo.hit) {
      const pickedY = this.ceilingCollisionInfo.pickedPoint.y
      onCeiling = pickedY < compareWith + ROOF_COLLISION_THRESHOLD
    }
    return onCeiling
  }

  public setToGroundLevel() {
    this.groundCollisionInfo = this.castRayToGround()
    if (this.isOnGround()) {
      const pickedY = this.groundCollisionInfo.pickedPoint.y
      this.mesh.position.y = pickedY + GROUND_COLLISION_THRESHOLD - this.mesh.getBoundingInfo().minimum.y
    }
  }

  private castRayToGround(): PickingInfo {
    // we want to cast from top of mesh to ensure the pickedY is the correct mesh
    // otherwise you will sometimes experience the ray cast to go straight through
    // we do something similar with castRayToCeiling
    const castFrom = this.mesh.position.clone()
    castFrom.y += this.mesh.getBoundingInfo().maximum.y - 0.2
    const ray = new Ray(castFrom, new Vector3(0, -1, 0))
    return this.mesh.getScene().pickWithRay(ray)
  }

  private castRayToCeiling(): PickingInfo {
    const castFrom = this.mesh.position.clone()
    castFrom.y += this.mesh.getBoundingInfo().minimum.y + 0.2
    const ray = new Ray(castFrom, new Vector3(0, 1, 0))
    return this.mesh.getScene().pickWithRay(ray)
  }

  public setEnabled(enabled: boolean) {
    this.mesh.setEnabled(enabled)
    this.animator.setEnabled(enabled)
    if (this.ellipsoidMesh != null) {
      this.ellipsoidMesh.setEnabled(enabled)
    }
  }

  private drawCollisionEllipsoid() {
    this.mesh.refreshBoundingInfo()

    const ellipsoidMesh = MeshBuilder.CreateSphere(
      "collisionEllipsoid",
      {
        diameterX: this.mesh.ellipsoid.x * 2,
        diameterZ: this.mesh.ellipsoid.z * 2,
        diameterY: this.mesh.ellipsoid.y * 2
      },
      this.mesh.getScene()
    )

    ellipsoidMesh.position = this.mesh.getAbsolutePosition().add(this.mesh.ellipsoidOffset)

    const material = new StandardMaterial("collider", this.mesh.getScene())
    material.wireframe = true
    material.diffuseColor = Color3.Yellow()
    ellipsoidMesh.material = material
    ellipsoidMesh.visibility = 0.3

    ellipsoidMesh.isPickable = false
    ellipsoidMesh.checkCollisions = false
    this.ellipsoidMesh = ellipsoidMesh
  }

  private setEllipsoidToBoundingBox() {
    const bb = this.mesh.getBoundingInfo().boundingBox
    this.mesh.ellipsoid = bb.maximumWorld.subtract(bb.minimumWorld).scale(0.5)
  }

  public dispose() {
    this.mesh.dispose()
    if (this.ellipsoidMesh != null) {
      this.ellipsoidMesh.dispose()
    }
    this.mesh = null
    this.ellipsoidMesh = null
  }
}

export class PlayerAnimator {
  private playerMesh: PlayerMesh
  private animatorMesh: AbstractMesh
  private name: string
  private fileName: string
  private scene: Scene
  private scaling: number
  private speedRatio: number

  private forwardAnim: AnimationGroup
  private leftAnim: AnimationGroup
  private rightAnim: AnimationGroup
  private backAnim: AnimationGroup
  private idleAnim: AnimationGroup
  private currentAnimation: AnimationGroup

  constructor(playerMesh: PlayerMesh, name: string, fileName: string, scaling: number, speedRatio: number) {
    this.playerMesh = playerMesh
    this.scene = playerMesh.scene
    this.name = name
    this.fileName = fileName
    this.scaling = scaling
    this.speedRatio = speedRatio
  }

  public async build() {
    // Animation file is built in blender according to: https://doc.babylonjs.com/divingDeeper/animation/animatedCharacter
    const animations = await this.loadAnimations(this.fileName)

    this.forwardAnim = animations.find((anim) => anim.name == "Forward")
    this.idleAnim = animations.find((anim) => anim.name == "Idle")
    this.leftAnim = animations.find((anim) => anim.name == "Left")
    this.rightAnim = animations.find((anim) => anim.name == "Right")
    this.backAnim = animations.find((anim) => anim.name == "Back")

    // start with idle animation
    this.currentAnimation = this.idleAnim
    this.currentAnimation.play(true)
  }

  private async loadAnimations(fileName: string): Promise<AnimationGroup[]> {
    const result = await SceneLoader.ImportMeshAsync("", "assets/models/", fileName, this.scene)
    this.animatorMesh = result.meshes[0]
    this.animatorMesh.name = "animation" + this.name
    this.animatorMesh.scaling.scaleInPlace(this.scaling)
    const height = this.playerMesh.get().getBoundingInfo().boundingBox.maximum.y
    this.animatorMesh.position.y -= height
    this.animatorMesh.parent = this.playerMesh.get()
    // apply modifiers
    this.animatorMesh.checkCollisions = false
    this.animatorMesh.isPickable = false
    // apply to all children as well
    this.animatorMesh.getChildMeshes().forEach((child) => {
      child.checkCollisions = false
      child.isPickable = false
    })

    const animations = result.animationGroups

    // stop all animations and apply speed ratio
    animations.forEach((animation) => {
      animation.stop()
      animation.speedRatio = this.speedRatio
    })

    return animations
  }

  public update(direction: MoveDirection, onGround: boolean) {
    // do not play animations when in air
    if (!onGround) {
      this.currentAnimation.pause()
      return
    }

    switch (direction) {
      case MoveDirection.FORWARD:
      case MoveDirection.FORWARD_LEFT:
      case MoveDirection.FORWARD_RIGHT:
        this.playAnimation(this.forwardAnim)
        break
      case MoveDirection.BACK:
      case MoveDirection.BACK_LEFT:
      case MoveDirection.BACK_RIGHT:
        this.playAnimation(this.backAnim)
        break
      case MoveDirection.LEFT:
        this.playAnimation(this.leftAnim)
        break
      case MoveDirection.RIGHT:
        this.playAnimation(this.rightAnim)
        break
      default:
        this.playAnimation(this.idleAnim)
    }

    // rotate mesh for diagonal movement (instead of replacing animation)
    if (direction == MoveDirection.FORWARD_LEFT || direction == MoveDirection.BACK_RIGHT) {
      this.animatorMesh.rotation = new Vector3(0, 0.75 * Math.PI, 0)
    } else if (direction == MoveDirection.FORWARD_RIGHT || direction == MoveDirection.BACK_LEFT) {
      this.animatorMesh.rotation = new Vector3(0, -0.75 * Math.PI, 0)
    } else {
      this.animatorMesh.rotation = new Vector3(0, Math.PI, 0)
    }
  }

  public setEnabled(enabled: boolean) {
    if (!enabled) {
      this.currentAnimation.stop()
    }
    this.animatorMesh.setEnabled(enabled)
  }

  private playAnimation(animation: AnimationGroup, loop = true) {
    if (animation.isPlaying) {
      return
    }
    this.currentAnimation.stop()
    this.currentAnimation = animation
    animation.play(loop)
  }
}

export enum MoveDirection {
  FORWARD,
  FORWARD_LEFT,
  FORWARD_RIGHT,
  BACK,
  BACK_LEFT,
  BACK_RIGHT,
  LEFT,
  RIGHT,
  IDLE
}
