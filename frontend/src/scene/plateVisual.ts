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
  PLATE_RIM_Y,
  PLATE_SOCKET_Y,
} from './constants'
import { createPlateBaseGeometry } from './plateBaseGeometry'

/**
 * A plate: a thin flower-shaped slab carrying six petal sockets around a dead centre hole.
 *
 * The slab is what makes it read as **one physical piece**. Without it a plate is seven
 * unconnected hexes floating over the board, and the gaps between petals show the board
 * straight through. Being a real solid rather than a decal, its bevelled edge catches the key
 * light, which is what conveys thickness under a camera that only ever sees the top.
 *
 * The hole gets no rim and a near-black face so it reads as an absence — it is never
 * fillable, and that has to be legible at a glance or a plate looks like it has seven usable
 * spaces instead of six.
 *
 * Built at board scale (`HEX_SIZE`), so one uniform scale on the group drops the same plate
 * into a drawer bay.
 */

const SOCKET_R = HEX_SIZE * 0.9
/** 6-segment circle and ring are hexagons; thetaStart 90° puts vertices top and bottom. */
const socketGeometry = new CircleGeometry(SOCKET_R, 6, Math.PI / 2)
const rimGeometry = new RingGeometry(SOCKET_R * 0.9, SOCKET_R, 6, 1, Math.PI / 2)
const holeGeometry = new CircleGeometry(HEX_SIZE * 0.84, 6, Math.PI / 2)
const baseGeometry: BufferGeometry = createPlateBaseGeometry({
  size: HEX_SIZE,
  thickness: PLATE_BASE_THICKNESS,
  bevel: PLATE_BASE_BEVEL,
  margin: PLATE_BASE_MARGIN,
})

/** Lighter than the sockets, so the sockets read as recesses cut into it. */
const baseMaterial = new MeshStandardMaterial({
  color: '#4b5058',
  roughness: 0.55,
  metalness: 0.35,
})
const socketMaterial = new MeshStandardMaterial({
  color: '#2c3238',
  roughness: 0.75,
  metalness: 0.15,
  side: DoubleSide,
})
const rimMaterial = new MeshStandardMaterial({
  color: '#8a7442',
  roughness: 0.42,
  metalness: 0.55,
  side: DoubleSide,
})
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

    const socket = new Mesh(socketGeometry, socketMaterial)
    socket.rotation.x = FLAT_X
    socket.position.set(offset.x, PLATE_SOCKET_Y, offset.z)
    group.add(socket)

    const rim = new Mesh(rimGeometry, rimMaterial)
    rim.rotation.x = FLAT_X
    rim.position.set(offset.x, PLATE_RIM_Y, offset.z)
    group.add(rim)
  }

  return group
}

/** Shared geometries and materials — call once, when no plates remain. */
export function disposePlateVisualAssets(): void {
  baseGeometry.dispose()
  socketGeometry.dispose()
  rimGeometry.dispose()
  holeGeometry.dispose()
  baseMaterial.dispose()
  socketMaterial.dispose()
  rimMaterial.dispose()
  holeMaterial.dispose()
}

/** Offset of a petal's centre from the plate's hole, in world units at scale 1. */
export function petalOffset(petal: number): { x: number, z: number } {
  const dir = PETAL_DIRS[petal]
  return dir ? axialToWorld(dir, HEX_SIZE) : { x: 0, z: 0 }
}
