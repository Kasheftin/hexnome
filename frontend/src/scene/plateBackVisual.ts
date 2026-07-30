import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  type BufferGeometry,
} from 'three'
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
 * A plate seen from the back: the same flower slab and the same cell mark, but only one of them.
 *
 * Plates in the shared source lie face down, so which tile a plate carries is hidden until it is
 * drafted. The back therefore has one job — say clearly "there is a plate here and you cannot see what
 * is on it" — and it does that by being conspicuously *bare* where the front is busy: one mark in the
 * centre instead of seven cells. A player should never have to look twice to tell which way up a plate
 * is, and the count of marks is the tell.
 *
 * Built from the same slab geometry as the front plus a single centred mark. Sharing
 * `createPlateBaseGeometry` matters for more than reuse: the silhouette is identical to a face-up plate,
 * so a plate flipping over will not change shape.
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
 * The same slab as the face-up side, from the shared palette.
 *
 * The two faces are deliberately one material and one set of tones: a plate is one object, and the only
 * thing that should distinguish its reverse is what is *marked* on it — a single centre seal rather than
 * seven cells. Anything else and a face-down plate reads as a different kind of piece.
 */
const backMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.slab,
  // Low metalness on purpose. A metal is lit almost entirely by what it reflects, and the studio
  // environment here is deliberately dark (studioEnvironment.ts) — so metalness 0.55 rendered this
  // slab near-black and the plate read as a hole in the lot rather than an object in it.
  roughness: 0.5,
  metalness: 0.2,
})

/**
 * The seal: a hexagonal disc and a concentric outline, sitting in the plate's centre cell.
 *
 * The same mark, at the same radii, that the face-up side puts in all seven cells — shared through
 * `PLATE_CELL_*` so the two faces cannot drift apart.
 */
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
 * A bright seal was the first attempt and it looked like a fault: the tiles heaped on a lot cover most
 * of the centre, so all that showed was a pale sliver between them, reading as a gap in the plate
 * rather than a mark on it. Close to the slab's own colour, it stays a detail at any coverage.
 *
 * Deliberately the *socket* tone, not the front's darker hole tone. The back has no hole, and hinting at
 * one where a plate is solid would be misleading.
 */
const sealMaterial = new MeshStandardMaterial({
  color: PLATE_TONES.socket,
  roughness: 0.55,
  metalness: 0.2,
  side: DoubleSide,
})

const FLAT_X = -Math.PI / 2

export function createPlateBackVisual(): Group {
  const group = new Group()

  // The slab. Its local origin is its underside, so everything else stacks above it.
  group.add(new Mesh(baseGeometry, backMaterial))

  for (const geometry of [sealGeometry, sealRingGeometry]) {
    const mesh = new Mesh(geometry, sealMaterial)
    mesh.rotation.x = FLAT_X
    mesh.position.y = PLATE_SOCKET_Y
    group.add(mesh)
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
