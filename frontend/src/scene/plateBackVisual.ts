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
 * A plate seen from the back: a brown flower slab carrying seven identical cell marks.
 *
 * Plates in the shared source lie face down, so which tile a plate carries is hidden until it is
 * drafted. The back's job is to say "there is a plate here and you cannot see what is on it", and it
 * does that by being uniform where the front is ornate — seven plain repeating marks against the front's
 * painted brass sockets. A player should never have to look twice to tell which way up a plate is.
 *
 * **All seven marks are the same**, the centre included. The front singles its centre out because that
 * cell is a hole nothing can ever fill; the back has no such structure — nothing can be placed on a
 * face-down plate at all — so distinguishing one cell would imply a distinction that is not there.
 *
 * Built from the same slab geometry as the front. Sharing `createPlateBaseGeometry` matters for more than
 * reuse: the silhouette is identical to a face-up plate, so a plate flipping over will not change shape.
 *
 * Built at board scale (`HEX_SIZE`) with its local origin at the slab's underside, exactly like
 * `createPlateVisual` — so the same positioning and scaling code drops either one into a lot.
 */

const baseGeometry: BufferGeometry = createPlateBaseGeometry({
  size: HEX_SIZE,
  thickness: PLATE_BASE_THICKNESS,
  bevel: PLATE_BASE_BEVEL,
  margin: PLATE_BASE_MARGIN,
})

/**
 * Warm brown, and deliberately unlike the face-up side's dark slate.
 *
 * The two faces are meant to be told apart instantly, so they do not share a palette: the front is dark
 * so its painted sockets sit *on* it, while the back has nothing to carry and can hold the colour itself.
 */
const backMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.slab,
  // Low metalness on purpose. A metal is lit almost entirely by what it reflects, and the studio
  // environment here is deliberately dark (studioEnvironment.ts) — so metalness 0.55 rendered this
  // slab near-black and the plate read as a hole in the lot rather than an object in it.
  roughness: 0.5,
  metalness: 0.2,
})

/** One cell's mark: a hexagonal disc with a concentric outline around it. */
const sealGeometry = new CircleGeometry(HEX_SIZE * PLATE_CELL_MARK_R, 6, Math.PI / 2)
const sealRingGeometry = new RingGeometry(
  HEX_SIZE * PLATE_CELL_RING_R[0],
  HEX_SIZE * PLATE_CELL_RING_R[1],
  6,
  1,
  Math.PI / 2,
)

/**
 * Darker than the slab, not brighter — an emboss rather than an inlay.
 *
 * A bright mark was the first attempt and it looked like a fault: the tiles heaped on a lot cover most of
 * the plate, so all that showed was a pale sliver between them, reading as a gap rather than a marking.
 * Close to the slab's own colour, it stays a detail at any coverage.
 */
const sealMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.socket,
  roughness: 0.55,
  metalness: 0.2,
  side: DoubleSide,
})

const FLAT_X = -Math.PI / 2

/** The seven cell centres: the hole first, then the six petals. */
const CELL_OFFSETS = [{ x: 0, z: 0 }, ...PETAL_DIRS.map(dir => axialToWorld(dir, HEX_SIZE))]

export function createPlateBackVisual(): Group {
  const group = new Group()

  // The slab. Its local origin is its underside, so everything else stacks above it.
  group.add(new Mesh(baseGeometry, backMaterial))

  for (const offset of CELL_OFFSETS) {
    for (const geometry of [sealGeometry, sealRingGeometry]) {
      const mesh = new Mesh(geometry, sealMaterial)
      mesh.rotation.x = FLAT_X
      mesh.position.set(offset.x, PLATE_SOCKET_Y, offset.z)
      group.add(mesh)
    }
  }

  return group
}

/** Shared geometries and materials — call once, when no face-down plates remain. */
export function disposePlateBackAssets(): void {
  baseGeometry.dispose()
  sealGeometry.dispose()
  sealRingGeometry.dispose()
  backMaterial.dispose()
  sealMaterial.dispose()
}
