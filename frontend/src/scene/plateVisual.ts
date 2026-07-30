import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type BufferGeometry,
} from 'three'
import { axialToWorld } from '@/game/hex'
import { PETAL_DIRS } from '@/game/plate'
import {
  HEX_SIZE,
  PLATE_BASE_BEVEL,
  PLATE_BASE_MARGIN,
  PLATE_BASE_THICKNESS,
  PLATE_SOCKET_Y,
  PLATE_TEXTURE_URLS,
} from './constants'
import { createHexPlateGeometry } from './hexPlateGeometry'
import { createPlateBaseGeometry } from './plateBaseGeometry'

/**
 * A plate: a thin flower-shaped slab carrying six ornate petal sockets around a dead centre
 * hole.
 *
 * **The plate is where the colour lives.** The board only says where a plate may go, which is
 * a minor job, so it is a bare honeycomb on dark slate; the petals are the places a tile
 * actually goes, so they get the ornate brass-and-green art. The earlier arrangement had it
 * the other way round — a richly textured board under flat grey sockets — which drew the eye
 * to the least interesting part of the screen.
 *
 * The slab is what makes it read as **one physical piece**. Without it a plate is seven
 * unconnected hexes floating over the board. Being a real solid rather than a decal, its
 * bevelled edge catches the key light, which is what conveys thickness under a camera that
 * only ever sees the top. It is dark so the sockets sit on it rather than compete with it.
 *
 * The hole gets no socket art and a near-black face so it reads as an absence — it is never
 * fillable, and that has to be legible at a glance or a plate looks like it has seven usable
 * spaces instead of six.
 *
 * Built at board scale (`HEX_SIZE`), so one uniform scale on the group drops the same plate
 * into a drawer bay.
 */

const SOCKET_R = HEX_SIZE * 0.9

/**
 * Sockets use the hexagon geometry with bounding-box UVs, not `CircleGeometry`: the art is a
 * full-bleed hexagon, and CircleGeometry's UVs map the circumscribed *square*, which squashes
 * it inward. See hexPlateGeometry.ts.
 */
const socketGeometry: BufferGeometry = createHexPlateGeometry(SOCKET_R)
const holeGeometry = new CircleGeometry(HEX_SIZE * 0.84, 6, Math.PI / 2)
const baseGeometry: BufferGeometry = createPlateBaseGeometry({
  size: HEX_SIZE,
  thickness: PLATE_BASE_THICKNESS,
  bevel: PLATE_BASE_BEVEL,
  margin: PLATE_BASE_MARGIN,
})

/** Dark, so the ornate sockets read as inset into it rather than floating on it. */
const baseMaterial = new MeshStandardMaterial({
  color: '#20242a',
  roughness: 0.6,
  metalness: 0.3,
})

/**
 * Unlit, like the board cells were: the art already has its lighting painted in, so lighting
 * it again doubles up and darkens it away from what was drawn.
 */
const socketMaterial = new MeshBasicMaterial({ transparent: true, side: DoubleSide })
const socketTextureUrl = PLATE_TEXTURE_URLS[0]
if (socketTextureUrl) {
  new TextureLoader().load(socketTextureUrl, texture => {
    // The PNG holds sRGB values; without this three reads them as linear and it washes out.
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    socketMaterial.map = texture
    socketMaterial.needsUpdate = true
  })
}

const holeMaterial = new MeshStandardMaterial({
  color: '#05070a',
  roughness: 0.95,
  metalness: 0,
  side: DoubleSide,
})

const FLAT_X = -Math.PI / 2

export function createPlateVisual(): Group {
  const group = new Group()

  // The slab. Its local origin is its underside, so everything else stacks above it.
  group.add(new Mesh(baseGeometry, baseMaterial))

  const hole = new Mesh(holeGeometry, holeMaterial)
  hole.rotation.x = FLAT_X
  hole.position.y = PLATE_SOCKET_Y
  group.add(hole)

  for (const dir of PETAL_DIRS) {
    const offset = axialToWorld(dir, HEX_SIZE)
    // createHexPlateGeometry already lies flat in XZ, so no rotation here.
    const socket = new Mesh(socketGeometry, socketMaterial)
    socket.position.set(offset.x, PLATE_SOCKET_Y, offset.z)
    group.add(socket)
  }

  return group
}

/** Shared geometries and materials — call once, when no plates remain. */
export function disposePlateVisualAssets(): void {
  baseGeometry.dispose()
  socketGeometry.dispose()
  holeGeometry.dispose()
  baseMaterial.dispose()
  socketMaterial.map?.dispose()
  socketMaterial.dispose()
  holeMaterial.dispose()
}

/** Offset of a petal's centre from the plate's hole, in world units at scale 1. */
export function petalOffset(petal: number): { x: number, z: number } {
  const dir = PETAL_DIRS[petal]
  return dir ? axialToWorld(dir, HEX_SIZE) : { x: 0, z: 0 }
}
