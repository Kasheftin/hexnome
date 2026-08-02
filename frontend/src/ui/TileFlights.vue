<script setup lang="ts">
/**
 * The layer tiles fly across.
 *
 * Teleported to `body`, and that is load-bearing rather than tidy: `.chrome-panel` has a
 * `backdrop-filter`, which makes it a containing block for fixed positioning, and the scoresheet
 * scrolls. Rendered inside the panel, a tile would be clipped the moment it left the rows.
 *
 * A dumb renderer — `useTileFlights` owns every decision; this only puts the elements where that
 * composable says and hands each one back so it can be animated.
 */
import type { Flyer } from './useTileFlights'
import TileChip from './TileChip.vue'

defineProps<{
  flyers: readonly Flyer[]
  launch: (el: Element | null, flyer: Flyer) => void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="flyers.length"
      class="flyers"
      aria-hidden="true"
    >
      <div
        v-for="flyer in flyers"
        :ref="el => launch(el as Element | null, flyer)"
        :key="flyer.id"
        class="flyer"
        :style="{
          left: `${flyer.to.left}px`,
          top: `${flyer.to.top}px`,
          width: `${flyer.to.width}px`,
          height: `${flyer.to.height}px`,
        }"
      >
        <TileChip
          :color="flyer.color"
          :value="flyer.value"
        />
      </div>
    </div>
  </Teleport>
</template>

<style>
/*
 * Unscoped: teleported to `body`, so a scoped attribute would not reach it.
 * `pointer-events: none` is mandatory — the layer covers the viewport, and without it it would swallow
 * the click that skips the reveal.
 */
.flyers {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
}

.flyers .flyer {
  position: fixed;
  display: grid;
  place-items: center;
}
</style>
