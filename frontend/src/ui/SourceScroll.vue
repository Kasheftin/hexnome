<script setup lang="ts">
/**
 * The source column's scrollbar: a real element, with the browser's own bar and its own momentum.
 *
 * The column is drawn in WebGL, so it cannot have a scrollbar of its own. Rather than emulate one —
 * hit-testing a drawn thumb, writing inertia, reimplementing what every platform already disagrees
 * about — this puts an empty, transparent, genuinely scrollable div exactly where the column is and
 * reads its `scrollTop`. The browser supplies the bar, the touch momentum, the rubber-banding, the
 * keyboard support and the trackpad feel; the scene supplies the picture.
 *
 * **Only mounted when there is something to scroll.** On a desktop, and on a phone held upright, the
 * lots fit and this does not exist — so nothing overlays the canvas and nothing changes.
 *
 * ## Why it may swallow presses
 *
 * It sits over the canvas and takes pointer events, which is the price of the browser handling the
 * gesture. `TableauView` binds its picker to this element as well as to the canvas, so a tap still
 * selects a tile. `touch-action: pan-y` is what makes the two coexist on a touchscreen: the browser
 * commits a vertical drag to scrolling before any handler runs, and leaves taps alone.
 */
import { computed, type ComponentPublicInstance } from 'vue'
import { columnRect, scrollElement, scrollTop } from '../scene/sourceScroll'

const rect = computed(() => columnRect.value)

/**
 * Hands the element to `TableauView`, which binds its picker to it. Nulled again on unmount.
 *
 * Typed as Vue types a function ref — it can be handed a component instance — even though this one is
 * only ever placed on a plain div.
 */
function setElement(el: Element | ComponentPublicInstance | null): void {
  scrollElement.value = el instanceof HTMLElement ? el : null
}

const frame = computed(() => {
  const r = rect.value
  if (!r) return undefined
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    // A snap point per lot, so the column tends to come to rest showing whole lots.
    scrollSnapType: 'y proximity',
  }
})

function onScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}
</script>

<template>
  <div
    v-if="rect && rect.contentHeight > rect.height"
    :ref="setElement"
    class="source-scroll"
    :style="frame"
    @scroll="onScroll"
  >
    <!--
      The spacer exists only to give the container a scroll range. It draws nothing: the lots it
      stands in for are rendered by the scene underneath, offset by the `scrollTop` it produces.
    -->
    <div
      class="source-scroll__extent"
      :style="{ height: `${rect.contentHeight}px` }"
    >
      <!--
        One zero-height marker per lot, so `proximity` snapping has somewhere to land. A single tall
        child would offer exactly one snap point — at the top — which is worse than none.
      -->
      <i
        v-for="lot in rect.lotCount"
        :key="lot"
        class="source-scroll__snap"
        :style="{ top: `${rect.pitch * (lot - 1)}px` }"
      />
    </div>
  </div>
</template>

<style scoped>
.source-scroll {
  position: absolute;
  z-index: 2;
  overflow-x: hidden;
  overflow-y: auto;
  /*
   * The browser owns vertical panning. That is what settles scroll-versus-tap without a gesture
   * recogniser of ours: a vertical drag is committed to scrolling before any handler sees it, and
   * everything else still reaches the picker.
   */
  touch-action: pan-y;
}

.source-scroll__extent {
  position: relative;
  width: 1px;
}

.source-scroll__snap {
  position: absolute;
  width: 1px;
  height: 0;
  scroll-snap-align: start;
}
</style>
