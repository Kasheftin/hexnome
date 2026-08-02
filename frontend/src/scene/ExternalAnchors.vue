<script setup lang="ts">
/**
 * The anchors that sit on bare board — the gaps the plates have wrapped.
 *
 * Separate from the plates, and it has to be: an external anchor is by definition a cell **no plate
 * covers**, so there is no plate group to hang it on. It is drawn straight into the world at board
 * coordinates, unlike its internal twin which rides on the plate that owns it.
 *
 * That difference shows in one more place. An internal anchor exists for the whole life of its plate,
 * so it is built once when the plate's view is; an external one appears and disappears as plates move,
 * so this rebuilds its set whenever the model changes.
 *
 * The emblem is the same art as the internal anchor's, tinted (`ANCHOR_EXTERNAL_TINT`) so the two can
 * be told apart at a glance — they pay different amounts, so that matters — without a second
 * illustration to keep in step with the first.
 */
import { useTresContext } from '@tresjs/core'
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { axialToWorld, axialKey, type Axial } from '@hexnome/rules/hex'
import type { Tableau } from '@hexnome/rules/tableau'
import {
  ANCHOR_EXTERNAL_PAD_COLOR,
  ANCHOR_EXTERNAL_PAD_R,
  ANCHOR_EXTERNAL_TINT,
  HEX_SIZE,
  PLATE_BASE_Y,
} from './constants'
import { attachAnchorVisual, disposeAnchorVisual, showAnchor, type AnchorVisual } from './anchorVisual'

const props = defineProps<{
  tableau: Tableau
  /** Bumped by the owner on every model mutation, since the tableau is not reactive. */
  revision: number
}>()

const { scene } = useTresContext()

/** Pointy-top, matching every other hexagon on the table. */
const padGeometry = new CircleGeometry(HEX_SIZE * ANCHOR_EXTERNAL_PAD_R, 6, Math.PI / 2)
const padMaterial = new MeshBasicMaterial({ color: ANCHOR_EXTERNAL_PAD_COLOR })

interface Marker {
  readonly group: Group
  readonly anchor: AnchorVisual
}

const markers = new Map<string, Marker>()

function build(cell: Axial): Marker {
  const group = new Group()
  const world = axialToWorld(cell, HEX_SIZE)
  group.position.set(world.x, PLATE_BASE_Y, world.z)

  const pad = new Mesh(padGeometry, padMaterial)
  pad.rotation.x = -Math.PI / 2
  group.add(pad)

  const anchor = attachAnchorVisual(group, { tint: ANCHOR_EXTERNAL_TINT })
  scene.value.add(group)
  return { group, anchor }
}

function reconcile(): void {
  if (!scene.value) return
  const wanted = new Map(
    props.tableau.anchors()
      .filter(anchor => anchor.kind === 'external')
      .map(anchor => [axialKey(anchor.cell), anchor.cell] as const),
  )

  for (const [key, marker] of [...markers]) {
    if (wanted.has(key)) continue
    // The gap was reopened — a plate moved away, and the anchor with it.
    disposeAnchorVisual(marker.anchor)
    scene.value.remove(marker.group)
    markers.delete(key)
  }

  for (const [key, cell] of wanted) {
    let marker = markers.get(key)
    if (!marker) {
      marker = build(cell)
      markers.set(key, marker)
    }
    showAnchor(marker.anchor, props.tableau.anchorIsEnclosed(cell))
  }
}

watch(() => props.revision, reconcile)
onMounted(reconcile)

onBeforeUnmount(() => {
  for (const marker of markers.values()) {
    disposeAnchorVisual(marker.anchor)
    scene.value?.remove(marker.group as unknown as Object3D)
  }
  markers.clear()
  padGeometry.dispose()
  padMaterial.dispose()
})
</script>

<template>
  <TresGroup />
</template>
