<script setup lang="ts">
/**
 * The plated board: a patch of hex cells, each wearing a tile texture.
 *
 * One InstancedMesh per texture — so the whole board is one draw call today, and
 * still only a handful once there are several tile variants. Giving each instance
 * its own texture would need a per-instance UV attribute and a hand-written
 * shader; bucketing cells by variant gets the same result with stock materials.
 *
 * Materials are **unlit** (MeshBasicMaterial). The tile art already has its
 * lighting painted in — the brass frame's highlights and the face's shading are
 * part of the image — so lighting it again would double up and darken it away from
 * what was authored. When real tiles cast real shadows this becomes a lit material
 * and the art becomes an albedo map; that is a deliberate later decision.
 *
 * Which variant a cell gets, and its tint jitter, come from the cell's position
 * hash, so the board is identical on every reload. A board that reshuffles itself
 * on refresh reads as a bug.
 */
import { useTresContext } from '@tresjs/core'
import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SRGBColorSpace,
  TextureLoader,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three'
import { onBeforeUnmount, onMounted } from 'vue'
import { axialHash, axialToWorld, type Axial } from '@/game/hex'
import {
  HEX_SIZE,
  PLATE_INSET,
  PLATE_TEXTURE_URLS,
  PLATE_TINT_JITTER,
  PLATE_Y,
} from './constants'
import { createHexPlateGeometry } from './hexPlateGeometry'

const props = defineProps<{
  /** The cells to plate. Shape of the playfield is the caller's decision. */
  cells: readonly Axial[]
}>()

const { scene } = useTresContext()

const meshes: InstancedMesh[] = []
const materials: Material[] = []
const textures: Texture[] = []
let geometry: BufferGeometry | null = null
let disposed = false

function build(loaded: Texture[]): void {
  if (disposed || loaded.length === 0) return

  const geo = createHexPlateGeometry(HEX_SIZE * PLATE_INSET)
  geometry = geo

  const buckets: Axial[][] = loaded.map(() => [])
  for (const cell of props.cells) {
    const index = Math.floor(axialHash(cell) * loaded.length) % loaded.length
    buckets[index]?.push(cell)
  }

  const matrix = new Matrix4()
  const tint = new Color()

  loaded.forEach((map, index) => {
    const cells = buckets[index]
    if (!cells || cells.length === 0) return

    const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: true })
    materials.push(material)

    const mesh = new InstancedMesh(geo, material, cells.length)
    mesh.frustumCulled = false

    cells.forEach((cell, i) => {
      const p = axialToWorld(cell, HEX_SIZE)
      matrix.makeTranslation(p.x, PLATE_Y, p.z)
      mesh.setMatrixAt(i, matrix)

      // A second, decorrelated hash so brightness does not track variant choice.
      const j = axialHash({ q: cell.q * 7 + 13, r: cell.r * 3 - 5 })
      const level = 1 + (j - 0.5) * 2 * PLATE_TINT_JITTER
      tint.setRGB(level, level, level)
      mesh.setColorAt(i, tint)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    scene.value.add(mesh)
    meshes.push(mesh)
  })
}

onMounted(() => {
  const loader = new TextureLoader()
  Promise.all(
    PLATE_TEXTURE_URLS.map(
      url =>
        new Promise<Texture>((resolve, reject) => {
          loader.load(
            url,
            texture => {
              // The PNG holds sRGB values; without this three reads them as linear
              // and the plates come out washed out.
              texture.colorSpace = SRGBColorSpace
              texture.anisotropy = 8
              resolve(texture)
            },
            undefined,
            reject,
          )
        }),
    ),
  )
    .then(loaded => {
      textures.push(...loaded)
      build(loaded)
    })
    .catch((error: unknown) => {
      console.error('[hexnome] failed to load plate textures', error)
    })
})

onBeforeUnmount(() => {
  disposed = true
  for (const mesh of meshes) {
    scene.value?.remove(mesh)
    mesh.dispose()
  }
  meshes.length = 0
  for (const material of materials) material.dispose()
  materials.length = 0
  for (const texture of textures) texture.dispose()
  textures.length = 0
  geometry?.dispose()
  geometry = null
})
</script>

<template>
  <TresGroup />
</template>
