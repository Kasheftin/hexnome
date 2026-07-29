<script setup lang="ts">
/**
 * Everything on the table — plates and tiles — and the one drag that moves them.
 *
 * A single component because a drag is a single piece of state, and because dropping a
 * *tile* depends on where the *plates* are. Splitting them would mean two controllers
 * negotiating over one gesture.
 *
 * **A tile on a plate is parented to it in the scene graph**, not merely positioned to
 * match. Three's transform hierarchy then makes plate-and-tile one rigid body: the tile
 * inherits the plate's position and scale exactly, on the same frame, for free.
 *
 * The earlier version instead eased each tile toward its plate's current position every
 * frame. That looks fine while both are still and wrong whenever the plate moves — the
 * tile is chasing a target that is itself moving, so it trails behind by a lag that
 * compounds. Visible when dragging a plate, and when scrolling the board with a plate in
 * the drawer. Easing cannot fix that; only rigid attachment can, because the tile is not
 * *approaching* the petal, it *is* in the petal.
 *
 * A tile's local transform is therefore just its petal offset, and easing that local
 * position gives the settle animation without reintroducing any lag.
 *
 * Board tiles are anchored in **world** space, drawer contents in **screen** space, so the
 * drawer stays put while the board pans beneath it. Each entity keeps both anchors in
 * sync, so crossing between containers eases from where it already is instead of jumping.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  Group,
  Mesh,
  Raycaster,
  TextureLoader,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type OrthographicCamera,
  type Texture,
} from 'three'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { axialToWorld, worldToAxial, type Axial } from '@/game/hex'
import { petalCell } from '@/game/plate'
import type { PlateLocation, Tableau, TileLocation } from '@/game/tableau'
import {
  DRAWER_SLOT_PX,
  DRAWER_TILE_FILL,
  DRAWER_TILE_Y,
  HELD_TILE_Y,
  HEX_SIZE,
  PLATE_BASE_Y,
  PLATE_SLOT_FILL,
  PLATE_SLOT_PX,
  PLATE_TILE_LIFT,
  PLATE_WORLD_WIDTH,
  SYMBOL_TEXTURE_URLS,
  TILE_BEVEL,
  TILE_SIZE,
  TILE_THICKNESS,
} from './constants'
import { registerGrabbable } from './grabbables'
import { createPlateVisual, disposePlateVisualAssets, petalOffset } from './plateVisual'
import { boardToScreen, screenToBoard, unitsPerPixel } from './screenProjection'
import { createSymbolPlane } from './symbolPlane'
import { createTileGeometry, hexApothemOf } from './tileGeometry'
import { createTileMaterial, type TileColorIndex } from './tileMaterials'
import { useDrawerLayout } from './useDrawerLayout'

const props = defineProps<{ tableau: Tableau }>()

const emit = defineEmits<{
  /** Cells to mark as the drop target, and whether dropping there is legal. */
  target: [cells: Axial[], valid: boolean]
  /** Drawer slot being targeted: a tile slot, a plate slot, or neither. */
  drawerTarget: [tileSlot: number | null, plateSlot: number | null, valid: boolean]
  changed: []
}>()

const { scene, camera, renderer, sizes } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useDrawerLayout()

const tileGeometry: BufferGeometry = createTileGeometry({
  circumradius: TILE_SIZE,
  thickness: TILE_THICKNESS,
  bevel: TILE_BEVEL,
})
const tileMaterials = new Map<number, Material>()

interface View {
  readonly object: Object3D
  readonly world: Vector3
  screenX: number
  screenY: number
  scale: number
  /**
   * Which anchoring regime the object was in last frame — 'held', 'drawer' or the plate
   * it rides. Used only to notice a change and restart the scale ease.
   */
  regime: string
  /**
   * True once the scale ease has finished. While settled, scale is assigned *directly*
   * from the current target rather than eased toward it.
   *
   * This is what stops drawer contents from visibly resizing and springing back when the
   * board is zoomed. A drawer item's world scale is a zoom-compensation factor —
   * `pixels × unitsPerPixel` — so when zoom changes the target changes, and easing toward
   * it means rendering a knowingly wrong size for several frames. It is not an animation
   * and must not be treated as one. The ease exists only for the one real transition,
   * between drawer size and board size.
   */
  settled: boolean
}

const plateViews = new Map<string, View>()
const tileViews = new Map<string, View>()
/** Maps a picked object back to what it belongs to. */
const owners = new Map<Object3D, { kind: 'tile' | 'plate', id: string }>()
const unregisters: (() => void)[] = []
const textures: Texture[] = []
let disposed = false

const held = shallowRef<{ kind: 'tile' | 'plate', id: string } | null>(null)
const pointer = { x: 0, y: 0 }
let targetTile: TileLocation | null = null
let targetPlate: PlateLocation | null = null
let targetValid = false
let lastEmitted = ''

const raycaster = new Raycaster()
const ndc = new Vector2()

function activeCamera(): OrthographicCamera | null {
  const cam = camera.activeCamera.value as OrthographicCamera | undefined
  return cam?.isOrthographicCamera ? cam : null
}

function canvasEl(): HTMLCanvasElement | null {
  return renderer.instance?.domElement ?? null
}

/** Tile radius in world units when sitting in a drawer tile slot. */
function drawerTileScale(upp: number): number {
  return (((DRAWER_SLOT_PX / 2) * DRAWER_TILE_FILL) * upp) / TILE_SIZE
}

/** Plate scale when sitting in a drawer plate slot. */
function drawerPlateScale(upp: number): number {
  return (PLATE_SLOT_PX * PLATE_SLOT_FILL * upp) / PLATE_WORLD_WIDTH
}

/**
 * Move `object` under `parent`, keeping it exactly where it appears.
 *
 * Reparenting is what makes a tile rigid with its plate, but three's `add()` only
 * reassigns the parent — the local transform is reinterpreted against the new parent, so
 * the object jumps unless its position and scale are converted first.
 */
const reparentPosition = new Vector3()
const reparentScale = new Vector3()
const parentScale = new Vector3()

function reparent(object: Object3D, parent: Object3D): void {
  if (object.parent === parent) return
  object.updateMatrixWorld()
  object.getWorldPosition(reparentPosition)
  object.getWorldScale(reparentScale)
  parent.updateMatrixWorld()
  parent.getWorldScale(parentScale)
  parent.add(object)
  object.position.copy(parent.worldToLocal(reparentPosition.clone()))
  object.scale.setScalar(reparentScale.x / (parentScale.x || 1))
}

/** Ease `view.scale` toward `target`, then track it exactly. See View.settled. */
function approachScale(view: View, target: number, ease: number): void {
  if (view.settled) {
    view.scale = target
    return
  }
  view.scale += (target - view.scale) * ease
  if (Math.abs(target - view.scale) <= Math.max(target, 1) * 0.005) {
    view.scale = target
    view.settled = true
  }
}

/** Restart the scale ease when an object changes container. */
function setRegime(view: View, regime: string): void {
  if (view.regime === regime) return
  view.regime = regime
  view.settled = false
}

/* ── picking ──────────────────────────────────────────────────────────────────── */

function pointerToCanvas(e: PointerEvent): { x: number, y: number } | null {
  const el = canvasEl()
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/**
 * What is under the pointer. Tiles win over plates automatically: a tile sits higher than
 * the plate beneath it, so under a top-down camera it is the nearer hit.
 */
function pick(canvasX: number, canvasY: number): { kind: 'tile' | 'plate', id: string } | null {
  const cam = activeCamera()
  const el = canvasEl()
  if (!cam || !el) return null
  ndc.set((canvasX / el.clientWidth) * 2 - 1, -(canvasY / el.clientHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, cam)

  const roots = [...tileViews.values(), ...plateViews.values()].map(v => v.object)
  for (const hit of raycaster.intersectObjects(roots, true)) {
    let node: Object3D | null = hit.object
    while (node) {
      const owner = owners.get(node)
      if (owner) return owner
      node = node.parent
    }
  }
  return null
}

/* ── target resolution ────────────────────────────────────────────────────────── */

function cellUnderPointer(): Axial | null {
  const cam = activeCamera()
  if (!cam) return null
  const p = screenToBoard(cam, sizes.width.value, sizes.height.value, pointer.x, pointer.y)
  const cell = worldToAxial(p, HEX_SIZE)
  return props.tableau.isBoardCell(cell) ? cell : null
}

function resolveTarget(): void {
  const current = held.value
  targetTile = null
  targetPlate = null
  targetValid = false
  if (!current) return

  const l = layout.value
  const overDrawer = l.contains(pointer.x, pointer.y)

  if (current.kind === 'tile') {
    if (overDrawer) {
      // A tile may go in a tile slot. The plate slots and the frame take nothing.
      const slot = l.slotAt(pointer.x, pointer.y)
      targetTile = slot === null ? null : { kind: 'drawer', slot }
    } else {
      const cell = cellUnderPointer()
      // petalAt returns null for the hole and for any uncovered cell, which is exactly
      // the "tiles only go into plate petals" rule.
      targetTile = cell ? props.tableau.petalAt(cell) : null
    }
    targetValid = targetTile !== null && props.tableau.canPlaceTile(targetTile, current.id)
  } else {
    if (overDrawer) {
      const slot = l.plateSlotAt(pointer.x, pointer.y)
      targetPlate = slot === null ? null : { kind: 'plateSlot', slot }
    } else {
      const cell = cellUnderPointer()
      targetPlate = cell ? { kind: 'board', hole: cell } : null
    }
    targetValid = targetPlate !== null && props.tableau.canPlacePlate(targetPlate, current.id)
  }

  emitTarget()
}

function emitTarget(): void {
  let cells: Axial[] = []
  let tileSlot: number | null = null
  let plateSlot: number | null = null

  if (targetTile?.kind === 'drawer') {
    tileSlot = targetTile.slot
  } else if (targetTile?.kind === 'onPlate') {
    const plate = props.tableau.plate(targetTile.plateId)
    if (plate?.location.kind === 'board') {
      cells = [petalCell(plate.location.hole, targetTile.petal)]
    }
  } else if (targetPlate?.kind === 'plateSlot') {
    plateSlot = targetPlate.slot
  } else if (targetPlate?.kind === 'board') {
    // Show the whole flower, so it is obvious what the plate will cover.
    const hole = targetPlate.hole
    cells = [hole, ...Array.from({ length: 6 }, (_, i) => petalCell(hole, i))]
  }

  const key = `${cells.map(c => `${c.q},${c.r}`).join('|')}/${tileSlot}/${plateSlot}/${targetValid}`
  if (key === lastEmitted) return
  lastEmitted = key
  emit('target', cells, targetValid)
  emit('drawerTarget', tileSlot, plateSlot, targetValid)
}

/* ── pointer handlers ─────────────────────────────────────────────────────────── */

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const c = pointerToCanvas(e)
  if (!c) return
  const hit = pick(c.x, c.y)
  if (!hit) return

  held.value = hit
  pointer.x = c.x
  pointer.y = c.y
  document.body.style.cursor = 'grabbing'
  resolveTarget()

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp, { once: true })
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!held.value) return
  const c = pointerToCanvas(e)
  if (!c) return
  pointer.x = c.x
  pointer.y = c.y
  resolveTarget()
}

function onWindowPointerUp(): void {
  window.removeEventListener('pointermove', onWindowPointerMove)
  document.body.style.cursor = ''
  const current = held.value

  if (current && targetValid) {
    const moved = current.kind === 'tile'
      ? targetTile !== null && props.tableau.moveTile(current.id, targetTile)
      : targetPlate !== null && props.tableau.movePlate(current.id, targetPlate)
    if (moved) emit('changed')
  }

  held.value = null
  targetTile = null
  targetPlate = null
  targetValid = false
  lastEmitted = ''
  emit('target', [], false)
  emit('drawerTarget', null, null, false)
}

function onCanvasPointerMove(e: PointerEvent): void {
  if (held.value) return
  const c = pointerToCanvas(e)
  if (!c) return
  document.body.style.cursor = pick(c.x, c.y) ? 'grab' : ''
}

/* ── per-frame placement ──────────────────────────────────────────────────────── */

const desired = new Vector3()

onBeforeRender(({ delta }) => {
  const cam = activeCamera()
  if (!cam) return
  const w = sizes.width.value
  const h = sizes.height.value
  const upp = unitsPerPixel(cam, h)
  const ease = Math.min(1, delta * 16)
  const current = held.value
  const l = layout.value

  // Plates first: tiles are positioned through them.
  for (const [id, view] of plateViews) {
    const plate = props.tableau.plate(id)
    if (!plate) continue

    if (current?.kind === 'plate' && current.id === id) {
      setRegime(view, 'held')
      view.screenX = pointer.x
      view.screenY = pointer.y
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, HELD_TILE_Y, p.z)
      approachScale(view, 1, ease)
    } else if (plate.location.kind === 'plateSlot') {
      setRegime(view, 'drawer')
      const c = l.plateSlotCentre(plate.location.slot)
      view.screenX += (c.x - view.screenX) * ease
      view.screenY += (c.y - view.screenY) * ease
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, DRAWER_TILE_Y, p.z)
      approachScale(view, drawerPlateScale(upp), ease)
    } else {
      setRegime(view, 'board')
      const c = axialToWorld(plate.location.hole, HEX_SIZE)
      desired.set(c.x, PLATE_BASE_Y, c.z)
      view.world.lerp(desired, ease)
      approachScale(view, 1, ease)
      const s = boardToScreen(cam, w, h, view.world.x, view.world.z)
      view.screenX = s.x
      view.screenY = s.y
    }

    view.object.position.copy(view.world)
    view.object.scale.setScalar(view.scale)
    view.object.updateMatrixWorld()
  }

  for (const [id, view] of tileViews) {
    const tile = props.tableau.tile(id)
    if (!tile) continue

    if (current?.kind === 'tile' && current.id === id) {
      setRegime(view, 'held')
      reparent(view.object, scene.value)
      view.screenX = pointer.x
      view.screenY = pointer.y
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, HELD_TILE_Y, p.z)
      approachScale(view, 1, ease)
      view.object.position.copy(view.world)
      view.object.scale.setScalar(view.scale)
    } else if (tile.location.kind === 'drawer') {
      setRegime(view, 'drawer')
      reparent(view.object, scene.value)
      const c = l.slotCentre(tile.location.slot)
      view.screenX += (c.x - view.screenX) * ease
      view.screenY += (c.y - view.screenY) * ease
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, DRAWER_TILE_Y, p.z)
      approachScale(view, drawerTileScale(upp), ease)
      view.object.position.copy(view.world)
      view.object.scale.setScalar(view.scale)
    } else {
      // Rigid with the plate: parented to it, so it inherits the plate's position and
      // scale exactly and on the same frame. Only the local settle into the petal eases.
      const plateView = plateViews.get(tile.location.plateId)
      if (!plateView) continue
      setRegime(view, tile.location.plateId)
      reparent(view.object, plateView.object)
      const offset = petalOffset(tile.location.petal)
      desired.set(offset.x, PLATE_TILE_LIFT, offset.z)
      // Ease into the petal, then sit exactly in it. A lerp only ever converges
      // asymptotically, and "almost rigid" is what the lag looked like in the first place.
      if (view.object.position.distanceToSquared(desired) < 1e-6) {
        view.object.position.copy(desired)
      } else {
        view.object.position.lerp(desired, ease)
      }
      approachScale(view, 1, ease)
      view.object.scale.setScalar(view.scale)
      // Keep the world and screen anchors current, so being picked up starts from here.
      view.object.updateMatrixWorld()
      view.object.getWorldPosition(view.world)
      const s = boardToScreen(cam, w, h, view.world.x, view.world.z)
      view.screenX = s.x
      view.screenY = s.y
    }
  }
})

/* ── setup ────────────────────────────────────────────────────────────────────── */

function tileMaterialFor(colorIndex: number): Material {
  const existing = tileMaterials.get(colorIndex)
  if (existing) return existing
  const created = createTileMaterial(colorIndex as TileColorIndex)
  tileMaterials.set(colorIndex, created)
  return created
}

function build(symbols: Texture[]): void {
  if (disposed) return

  for (const plate of props.tableau.plates()) {
    const group: Group = createPlateVisual()
    group.renderOrder = 1
    plateViews.set(plate.id, {
      object: group,
      world: new Vector3(),
      screenX: 0,
      screenY: 0,
      scale: 1,
      regime: '',
      settled: false,
    })
    owners.set(group, { kind: 'plate', id: plate.id })
    scene.value.add(group)
    unregisters.push(registerGrabbable(group))
  }

  for (const tile of props.tableau.tiles()) {
    const mesh = new Mesh(tileGeometry, tileMaterialFor(tile.color))
    mesh.renderOrder = 4
    const texture = symbols[Math.min(symbols.length, Math.max(1, tile.value)) - 1]
    if (texture) {
      mesh.add(createSymbolPlane(texture, {
        fitRadius: hexApothemOf(TILE_SIZE) * 0.84,
        y: TILE_THICKNESS / 2 + 0.008,
      }))
    }
    tileViews.set(tile.id, {
      object: mesh,
      world: new Vector3(),
      screenX: 0,
      screenY: 0,
      scale: 1,
      regime: '',
      settled: false,
    })
    owners.set(mesh, { kind: 'tile', id: tile.id })
    scene.value.add(mesh)
    unregisters.push(registerGrabbable(mesh))
  }
}

let canvas: HTMLCanvasElement | null = null

onMounted(() => {
  canvas = canvasEl()
  canvas?.addEventListener('pointerdown', onPointerDown)
  canvas?.addEventListener('pointermove', onCanvasPointerMove)

  const loader = new TextureLoader()
  Promise.all(
    SYMBOL_TEXTURE_URLS.map(
      url => new Promise<Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      }),
    ),
  )
    .then(loaded => {
      textures.push(...loaded)
      build(loaded)
    })
    .catch((error: unknown) => {
      console.error('[hexnome] failed to load symbol textures', error)
    })
})

onBeforeUnmount(() => {
  disposed = true
  canvas?.removeEventListener('pointerdown', onPointerDown)
  canvas?.removeEventListener('pointermove', onCanvasPointerMove)
  window.removeEventListener('pointermove', onWindowPointerMove)
  document.body.style.cursor = ''
  for (const off of unregisters) off()
  unregisters.length = 0

  for (const view of tileViews.values()) {
    view.object.parent?.remove(view.object)
    for (const child of view.object.children) {
      const mesh = child as Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as Material | undefined)?.dispose()
    }
  }
  for (const view of plateViews.values()) scene.value?.remove(view.object)
  tileViews.clear()
  plateViews.clear()
  owners.clear()

  for (const material of tileMaterials.values()) material.dispose()
  tileMaterials.clear()
  for (const texture of textures) texture.dispose()
  textures.length = 0
  tileGeometry.dispose()
  disposePlateVisualAssets()
})
</script>

<template>
  <TresGroup />
</template>
