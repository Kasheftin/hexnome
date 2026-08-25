<script setup lang="ts">
/**
 * What the source column says once there is nothing left in it.
 *
 * The column draws one row per lot that holds something, so an emptied source would otherwise be a
 * panel with a single blank bay in it — which reads as "a plate is about to arrive" when none ever
 * will again. A line of text is the difference between an empty shelf and a closed shop.
 *
 * **DOM over the canvas, not a quad in it.** The column itself is drawn in WebGL because it holds live
 * 3D plates and tiles; this holds a sentence, and text belongs where it can be crisp, selectable and
 * read aloud. It is positioned from the same `columnRect` the scrollbar uses, so it cannot drift from
 * the panel it is labelling.
 *
 * `pointer-events: none`: there is nothing here to press, and the board behind it still pans.
 *
 * The wording is short on purpose. The column is about 104px wide at six lots per round, and a longer
 * sentence — "no more plates this round" — wrapped to three lines inside a bay one line tall. It uses
 * the game's own verb, so it answers the question the player is actually asking of that panel.
 */
import { computed } from 'vue'
import { columnRect } from '../scene/sourceScroll'

const props = defineProps<{ empty: boolean }>()

const rect = computed(() => (props.empty ? columnRect.value : null))

const frame = computed(() => {
  const r = rect.value
  if (!r) return undefined
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  }
})
</script>

<template>
  <p
    v-if="rect"
    class="hx-source-empty"
    :style="frame"
  >
    Nothing left to take
  </p>
</template>

<style lang="scss">
/*
 * Not `scoped`: a scope attribute raises specificity, which is the thing layers exist to make
 * irrelevant. See styles/layers.scss.
 */
@layer components {
  .hx-source-empty {
    position: absolute;
    z-index: 2;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 0 16px;
    color: rgb(var(--v-theme-muted-dim));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    letter-spacing: 0.16em;
    text-align: center;
    text-transform: uppercase;
    pointer-events: none;
  }
}
</style>
