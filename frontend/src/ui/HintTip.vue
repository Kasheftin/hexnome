<script setup lang="ts">
/**
 * A tooltip, for things the interface cannot say in the space it has.
 *
 * Wraps whatever it is explaining and shows a bubble on hover or focus. Deliberately not a library:
 * a tooltip is a rectangle in the right place, and the only genuinely hard parts are the two below.
 *
 * ## Why it is not the browser's own
 *
 * `title=` is free and this replaces four uses of it. It waits about a second, cannot be styled at
 * all — an OS bubble against a dark brass panel reads as a bug — and never appears on touch. Worst,
 * it does not respond to keyboard focus, so the one group of people most likely to need the
 * explanation are the ones who cannot get it.
 *
 * ## Teleported, because a panel would otherwise cut it in half
 *
 * The scoring panel scrolls, the results panel scrolls, and both have their own stacking context.
 * A bubble positioned inside either would be clipped by it, and `overflow: visible` is not available
 * — the panels scroll for good reasons. So it is rendered at the end of `<body>` and positioned in
 * viewport coordinates from the trigger's own rectangle.
 *
 * ## It adds nothing to the layout
 *
 * The wrapper is `display: contents`, so it generates no box and whatever it wraps is laid out
 * exactly as it was without it. That is not tidiness: the rotate buttons are absolutely positioned
 * inside a zero-height container whose `translate(-50%, -50%)` depends on its own height, and their
 * container turns pointer events off so that only the buttons themselves catch them. A wrapper with
 * a box of its own would move them and swallow their hover at once.
 *
 * The cost is that a box-less element cannot be measured and does not receive `pointerenter`. So the
 * trigger's rectangle comes from the element inside, and hover is watched with `pointerover` and
 * `pointerout`, which bubble up through a node that has no box of its own.
 *
 * ## It moves out of its own way at the edges
 *
 * The seat list this was written for sits against the right-hand edge of the screen, where a centred
 * bubble would hang off it. So the bubble is measured after it renders and pulled back inside, and
 * flipped below its trigger when there is no room above. Both are one frame late by construction —
 * a rectangle cannot be measured before it exists — which is invisible next to the fade.
 */
import { nextTick, ref, shallowRef } from 'vue'

const props = defineProps<{
  /** What to say. Empty or absent means no tooltip at all — a caller may switch it off by value. */
  text: string
  /**
   * Where it prefers to sit relative to its trigger. It goes below anyway if there is no room above.
   *
   * Not a general placement API: two directions is what this interface needs, and every option here
   * is one more arrangement to keep working.
   */
  side?: 'above' | 'below'
}>()

const open = ref(false)
const bubble = shallowRef<HTMLElement | null>(null)
const anchor = shallowRef<HTMLElement | null>(null)
const at = ref({ left: 0, top: 0 })

/** How far the bubble stays off its trigger, and off the edge of the window. */
const GAP = 8
const MARGIN = 6

/** Roughly one line of it, for the frame before the real height is known. */
const GUESSED_HEIGHT = 28

async function show(): Promise<void> {
  if (!props.text) return

  /*
   * Guessed from the trigger alone, then corrected once there is a bubble to measure.
   *
   * The guess matters: a rectangle cannot be measured before it exists, so the first frame is drawn
   * somewhere. Without this it is drawn at the top-left of the window and jumps, which is a flicker
   * in the corner of the eye a long way from where the pointer is. Anchored to the trigger it is a
   * few pixels out for one frame instead, underneath a fade that is only just starting.
   */
  const from = triggerRect()
  if (from) at.value = { left: Math.round(from.left), top: Math.round(from.top - GUESSED_HEIGHT) }
  open.value = true

  await nextTick()
  place()
}

/** What the bubble is positioned against: the thing being explained, not the box-less wrapper. */
function triggerRect(): DOMRect | null {
  const wrapper = anchor.value
  const inner = wrapper?.firstElementChild ?? wrapper
  return inner ? inner.getBoundingClientRect() : null
}

function place(): void {
  const tip = bubble.value
  const from = triggerRect()
  if (!from || !tip) return

  const size = tip.getBoundingClientRect()

  const above = props.side !== 'below' && from.top - size.height - GAP >= MARGIN
  const top = above ? from.top - size.height - GAP : from.bottom + GAP

  // Centred on the trigger, then pulled back inside whichever edge it crossed.
  const centred = from.left + from.width / 2 - size.width / 2
  const rightmost = window.innerWidth - size.width - MARGIN
  at.value = { left: Math.round(Math.min(Math.max(centred, MARGIN), Math.max(rightmost, MARGIN))), top: Math.round(top) }
}

function hide(): void {
  open.value = false
}

/**
 * Left, unless the pointer only moved to something inside.
 *
 * `pointerout` fires on the way to a child as well as on the way out, and the icons here are exactly
 * that — an `<svg>` inside a `<span>`. Without the check the bubble flickers off and on as the
 * pointer crosses the glyph it is describing.
 */
function onOut(event: PointerEvent): void {
  const to = event.relatedTarget
  if (to instanceof Node && anchor.value?.contains(to)) return
  hide()
}

/*
 * Escape closes it, because a bubble that only a pointer can dismiss is a dead end for anyone who
 * arrived by keyboard. On the anchor rather than on the window: it is open because something inside
 * has focus, so the key is already coming through here.
 */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') hide()
}
</script>

<template>
  <span
    ref="anchor"
    class="anchor"
    @pointerover="show"
    @pointerout="onOut"
    @focusin="show"
    @focusout="hide"
    @keydown="onKey"
  >
    <slot />
    <Teleport to="body">
      <Transition name="tip">
        <span
          v-if="open && text"
          ref="bubble"
          class="tip"
          role="tooltip"
          :style="{ left: `${at.left}px`, top: `${at.top}px` }"
        >{{ text }}</span>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
/* No box of its own: see the note above. It exists to listen, not to lay anything out. */
.anchor {
  display: contents;
}
</style>

<style>
/*
 * Unscoped, because the bubble is teleported out of this component's subtree and a scoped rule would
 * not reach it. Named specifically enough to be safe outside a scope.
 */
.tip {
  position: fixed;
  z-index: 80;
  /*
   * `max-content` so the width does not depend on where the bubble happens to be sitting when it is
   * measured. Without it a `position: fixed` box shrinks to the room left of the window edge, so the
   * first frame near an edge measures narrow, gets centred on that narrow width, and then reflows
   * wider — landing a couple of dozen pixels off centre for good.
   */
  width: max-content;
  max-width: 260px;
  padding: 5px 8px;
  border: 1px solid #3a3222;
  border-radius: 3px;
  background: rgb(21 23 28 / 96%);
  box-shadow: 0 2px 12px rgb(0 0 0 / 55%);
  color: #cfd4de;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  /* It explains what is under the pointer; it must never become what is under the pointer. */
  pointer-events: none;
}

.tip-enter-active,
.tip-leave-active {
  transition: opacity 120ms;
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tip-enter-active,
  .tip-leave-active {
    transition: none;
  }
}
</style>
