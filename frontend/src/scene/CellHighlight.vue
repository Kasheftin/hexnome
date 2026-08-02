<script setup lang="ts">
/**
 * The drop-target marker on the board: the cells a held thing would land on.
 *
 * One cell for a tile, seven for a plate — a plate's whole flower is shown, so it is
 * obvious what the piece will cover before you let go.
 *
 * Two layers per cell, because one is not enough. A held tile is nearly a cell wide and
 * hovers right over its target, so a thin outline alone gets covered by the tile itself
 * and reads as "the highlight is broken":
 *
 * - a **filled hexagon** across the cell, so it glows even under a tile;
 * - a brighter **outline band** just inside the cell edge, which stays visible around the
 *   tile and says precisely which cell is meant.
 *
 * Built imperatively with two shared materials, so the pulse is a direct mutation in the
 * render loop rather than a Vue patch every frame.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
} from 'three'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { axialToWorld, type Axial } from '@hexnome/rules/hex'
import { HEX_SIZE, HIGHLIGHT_COLORS, HIGHLIGHT_Y } from './constants'

const props = defineProps<{
  cells: readonly Axial[]
  /** Legal drop target? Illegal ones are outlined in red, and do not pulse. */
  valid: boolean
}>()

/** A plate's flower is the largest thing ever marked at once. */
const MAX_MARKERS = 7

const { scene } = useTresContext()
const { onBeforeRender } = useLoop()

const FLAT_X = -Math.PI / 2

/** 6-segment circle and ring are hexagons; thetaStart 90° puts vertices top and bottom. */
const glowGeometry = new CircleGeometry(HEX_SIZE * 0.97, 6, Math.PI / 2)
const bandGeometry = new RingGeometry(HEX_SIZE * 0.87, HEX_SIZE * 0.99, 6, 1, Math.PI / 2)

const glowMaterial = new MeshBasicMaterial({
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: DoubleSide,
})
/**
 * The band uses normal blending, not additive. Added over the bright brass of a cell
 * frame, an additive mint clips to white and loses its hue, which made the marker read as
 * a pale smudge instead of a green outline.
 */
const bandMaterial = new MeshBasicMaterial({
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: NormalBlending,
  side: DoubleSide,
})

const markers: { glow: Mesh, band: Mesh }[] = []

function layout(): void {
  markers.forEach((marker, i) => {
    const cell = props.cells[i]
    const visible = cell !== undefined
    marker.glow.visible = visible
    marker.band.visible = visible
    if (!cell) return
    const p = axialToWorld(cell, HEX_SIZE)
    marker.glow.position.set(p.x, HIGHLIGHT_Y, p.z)
    marker.band.position.set(p.x, HIGHLIGHT_Y + 0.01, p.z)
  })
}

onMounted(() => {
  for (let i = 0; i < MAX_MARKERS; i++) {
    const glow = new Mesh(glowGeometry, glowMaterial)
    glow.rotation.x = FLAT_X
    glow.renderOrder = 2
    glow.visible = false

    const band = new Mesh(bandGeometry, bandMaterial)
    band.rotation.x = FLAT_X
    band.renderOrder = 3
    band.visible = false

    markers.push({ glow, band })
    scene.value.add(glow)
    scene.value.add(band)
  }
  layout()
})

watch(() => props.cells, layout)

onBeforeRender(({ elapsed }) => {
  if (props.cells.length === 0) return
  const pulse = Math.sin(elapsed * 4.5) * 0.5 + 0.5
  const colour = props.valid ? HIGHLIGHT_COLORS.valid : HIGHLIGHT_COLORS.invalid
  glowMaterial.color.set(colour)
  bandMaterial.color.set(colour)
  glowMaterial.blending = props.valid ? AdditiveBlending : NormalBlending
  glowMaterial.opacity = props.valid ? 0.16 + pulse * 0.12 : 0.14
  /*
   * The refusal is stated at full strength — the outline is as solid as the accepting one, only red.
   *
   * It does not pulse, though. The pulse is an invitation, and a steady band reads as a stop rather
   * than a beckon: the two states then differ in hue *and* in behaviour, which survives being looked
   * at by someone who cannot tell the two hues apart.
   */
  bandMaterial.opacity = props.valid ? 0.75 + pulse * 0.25 : 0.92
})

onBeforeUnmount(() => {
  for (const marker of markers) {
    scene.value?.remove(marker.glow)
    scene.value?.remove(marker.band)
  }
  markers.length = 0
  glowGeometry.dispose()
  bandGeometry.dispose()
  glowMaterial.dispose()
  bandMaterial.dispose()
})
</script>

<template>
  <TresGroup />
</template>
