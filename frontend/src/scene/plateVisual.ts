import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  type BufferGeometry,
} from 'three'
import { axialToWorld } from '@/game/hex'
import { PETAL_DIRS } from '@/game/plate'
import {
  HEX_SIZE,
  PLATE_BASE_BEVEL,
  PLATE_BASE_MARGIN,
  PLATE_BASE_THICKNESS,
  PLATE_CELL_MARK_R,
  PLATE_CELL_RING_R,
  PLATE_SOCKET_Y,
  PLATE_TONES,
} from './constants'
import { createPlateBaseGeometry } from './plateBaseGeometry'

/**
 * A plate, face up: a brown flower slab carrying seven inset dark-brown cells.
 *
 * Each cell wears the same mark as the **reverse side** — an inset hex, a gap of bare slab, then a thin
 * outline (scene/plateBackVisual.ts). Both faces draw from `PLATE_TONES` and the same radii, and the
 * reverse carries seven of them too. One object seen from two sides, not two objects that resemble
 * each other.
 *
 * The slab is what makes it read as **one physical piece**. Without it a plate is seven unconnected
 * hexes floating over the board. Being a real solid rather than a decal, its bevelled edge catches the
 * key light, which is what conveys thickness under a camera that only ever sees the top.
 *
 * The centre **has no fill at all** — its outline is drawn and the slab shows through it. The hole used
 * to be a darker socket, on the reasoning that a plate must not look like it offers seven usable spaces
 * when it offers six. The anchor emblem now does that job and does it better: an ornate crest is
 * unmistakably not a place to put a tile, in a way a slightly darker hexagon never quite was. Leaving
 * the dark fill underneath only muddied the emblem it sits behind.
 *
 * A painted socket texture (`plate-full.png`) was tried here twice and dropped twice: the ornate art did
 * not sit with the plain cardboard slab the reverse established. See docs/art-spec.md, Asset 0.
 *
 * Built at board scale (`HEX_SIZE`), so one uniform scale on the group drops the same plate into a
 * drawer bay or a source lot.
 */

const baseGeometry: BufferGeometry = createPlateBaseGeometry({
  size: HEX_SIZE,
  thickness: PLATE_BASE_THICKNESS,
  bevel: PLATE_BASE_BEVEL,
  margin: PLATE_BASE_MARGIN,
})

/** Pointy-top, so the marks line up with the tiles that sit on them. */
const markGeometry = new CircleGeometry(HEX_SIZE * PLATE_CELL_MARK_R, 6, Math.PI / 2)
const ringGeometry = new RingGeometry(
  HEX_SIZE * PLATE_CELL_RING_R[0],
  HEX_SIZE * PLATE_CELL_RING_R[1],
  6,
  1,
  Math.PI / 2,
)

const slabMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.slab,
  /*
   * Low metalness, as on the reverse. A metal is lit almost entirely by what it reflects and this
   * scene's studio environment is deliberately dark, so a shinier slab is a *darker* slab here, not a
   * brighter one — high metalness rendered the reverse near-black before this was pinned down.
   */
  roughness: 0.5,
  metalness: 0.2,
})

const socketMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.socket,
  roughness: 0.55,
  metalness: 0.2,
  side: DoubleSide,
})

const FLAT_X = -Math.PI / 2

/** The seven cell centres: the hole first, then the six petals in order. */
const CELL_OFFSETS = [{ x: 0, z: 0 }, ...PETAL_DIRS.map(dir => axialToWorld(dir, HEX_SIZE))]

export function createPlateVisual(): Group {
  const group = new Group()

  // The slab. Its local origin is its underside, so everything else stacks above it.
  group.add(new Mesh(baseGeometry, slabMaterial))

  CELL_OFFSETS.forEach((offset, cell) => {
    // Cell 0 is the hole. It keeps its outline but gets no fill: the anchor emblem sits there.
    if (cell !== 0) {
      const mark = new Mesh(markGeometry, socketMaterial)
      mark.rotation.x = FLAT_X
      mark.position.set(offset.x, PLATE_SOCKET_Y, offset.z)
      group.add(mark)
    }

    const ring = new Mesh(ringGeometry, socketMaterial)
    ring.rotation.x = FLAT_X
    ring.position.set(offset.x, PLATE_SOCKET_Y, offset.z)
    group.add(ring)
  })

  return group
}

/** Shared geometries and materials — call once, when no plates remain. */
export function disposePlateVisualAssets(): void {
  baseGeometry.dispose()
  markGeometry.dispose()
  ringGeometry.dispose()
  slabMaterial.dispose()
  socketMaterial.dispose()
}

/** Offset of a petal's centre from the plate's hole, in world units at scale 1. */
export function petalOffset(petal: number): { x: number, z: number } {
  const dir = PETAL_DIRS[petal]
  return dir ? axialToWorld(dir, HEX_SIZE) : { x: 0, z: 0 }
}
