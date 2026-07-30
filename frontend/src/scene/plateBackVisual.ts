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
  PLATE_SOCKET_Y,
} from './constants'
import { createPlateBaseGeometry } from './plateBaseGeometry'

/**
 * A plate seen from the back: the same flower slab, reverse side up, with no sockets.
 *
 * Plates in the shared source lie face down, so which tile a plate carries is hidden until it is
 * drafted. The back therefore has one job — say clearly "there is a plate here and you cannot see
 * what is on it" — and it does that by being conspicuously *blank* where the front is busy. No
 * sockets, no centre hole, no petal art. A player should never have to look twice to tell which way
 * up a plate is.
 *
 * There is no back-side art in the asset set, so this is built from the same slab geometry as the
 * front plus a centred seal. It shares `createPlateBaseGeometry`, which matters for more than reuse:
 * the silhouette is identical to a face-up plate, so a plate flipping over will not change shape.
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
 * Warmer and more metallic than the front's slab.
 *
 * The front is dark so its ornate sockets sit *on* it; the back has nothing to sit on it, so it can
 * carry the colour itself. Brass-brown also reads as the reverse of a printed piece rather than as
 * an unlit or half-loaded front — a distinction worth being unambiguous about, since the two appear
 * side by side once plates reach the drawer.
 */
const backMaterial = new MeshStandardMaterial({
  color: '#6d5636',
  // Low metalness on purpose. A metal is lit almost entirely by what it reflects, and the studio
  // environment here is deliberately dark (studioEnvironment.ts) — so metalness 0.55 rendered this
  // slab near-black and the plate read as a hole in the lot rather than an object in it.
  roughness: 0.5,
  metalness: 0.2,
})

/** The seal: a hexagonal disc and a ring around it, concentric with the hole on the front. */
const sealGeometry = new CircleGeometry(HEX_SIZE * 0.62, 6, Math.PI / 2)
const sealRingGeometry = new RingGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.95, 6, 1, Math.PI / 2)

/**
 * Darker than the slab, not brighter — an emboss rather than an inlay.
 *
 * A bright seal was the first attempt and it looked like a fault: the tiles heaped on a lot cover
 * most of the centre, so all that showed was a pale sliver between them, reading as a gap in the
 * plate rather than a mark on it. Close to the slab's own colour, it stays a detail at any coverage.
 *
 * Not as dark as the *front's* centre hole, which is near-black to read as an absence. The back has
 * no hole, and suggesting one would be actively misleading.
 */
const sealMaterial = new MeshStandardMaterial({
  color: '#54422b',
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
