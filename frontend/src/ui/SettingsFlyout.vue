<script setup lang="ts">
/**
 * A modal panel for settings that do not belong on the screen behind it.
 *
 * **Header, body, actions** — and only the body scrolls. The panel is a flex column with its own
 * overflow hidden, so the title stays put and *Done* stays reachable however long the list of dials
 * grows. Scrolling the whole panel instead put the way out below the fold, which is where a settings
 * list that keeps growing eventually leaves it.
 *
 * **A shell, not a form.** It owns the scrim, the framing, the title, and the ways out — Escape, the
 * backdrop, the close button — and takes the controls themselves through a slot. The dials live next
 * to the data that declares them, in whichever view opened this, so adding one is an entry in a list
 * rather than an edit in two files. The same shell can hold the in-game settings later.
 *
 * Modal rather than a popover pinned to the gear. These are the settings a game is *started* with, so
 * the choice is deliberate and worth stopping for — and a popover long enough to hold six dials would
 * have to reposition itself against the viewport anyway, which is a lot of machinery for a panel that
 * wants the screen's attention regardless.
 */
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

/**
 * Move focus into the panel when it opens.
 *
 * The panel itself takes focus rather than the first control: a screen reader then reads the title
 * before the dials, which is the order the panel is meant to be understood in, and Tab still lands on
 * the first control from there.
 */
watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  panel.value?.focus()
})
</script>

<template>
  <Transition name="flyout">
    <div
      v-if="props.open"
      class="backdrop"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <section
        ref="panel"
        class="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="props.title"
        tabindex="-1"
      >
        <header class="head">
          <h2>{{ props.title }}</h2>
          <button
            type="button"
            class="close"
            aria-label="Close settings"
            @click="emit('close')"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <div class="body">
          <slot />
        </div>

        <!--
          The footer stays put while the body scrolls, so anything here is reachable from any point
          in a long list of dials. `aside` is for what the caller wants beside Done — see HomeView's
          reset, which has to be findable rather than buried under thirteen sections.
        -->
        <footer class="actions">
          <slot name="aside" />
          <button
            type="button"
            class="done"
            @click="emit('close')"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * Takes pointer events, so a click meant for a dial that lands beside one hits the backdrop and closes
 * rather than reaching the menu underneath and changing a mode by accident.
 */
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(4 5 8 / 62%);
  z-index: 60;
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  max-height: min(86vh, 720px);
  /* No padding of its own: each band pads itself, so the scrollbar runs the body's full height. */
  overflow: hidden;
  border: 1px solid #3a3222;
  border-radius: 4px;
  background: rgb(21 23 28 / 97%);
  box-shadow: 0 8px 40px rgb(0 0 0 / 60%);
}

.panel:focus {
  outline: none;
}

.head {
  display: flex;
  flex: none;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 14px;
  border-bottom: 1px solid #2a2c33;
}

h2 {
  margin: 0;
  color: #e8c878;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.close {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.close svg {
  width: 15px;
  height: 15px;
  fill: currentcolor;
}

.close:hover {
  border-color: #7d6a41;
  color: #e8c878;
}

/*
 * `min-height: 0` is what makes this scroll at all: a flex item will not shrink below its content
 * without it, so the body would grow the panel past its max height instead of overflowing.
 */
.body {
  flex: 1;
  min-height: 0;
  padding: 16px 22px;
  overflow-y: auto;
}

/* Pinned below the body, with a rule so the boundary reads even when nothing is scrolled. */
.actions {
  display: flex;
  flex: none;
  gap: 10px;
  align-items: center;
  padding: 14px 22px 20px;
  border-top: 1px solid #2a2c33;
}

/* Done takes the room that is left, so an empty `aside` leaves the footer exactly as it was. */
.actions .done {
  flex: 1 1 auto;
}

.done {
  display: block;
  width: 100%;
  padding: 10px 0;
  border: 1px solid #7d6a41;
  border-radius: 3px;
  background: transparent;
  color: #e8c878;
  font: inherit;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 140ms;
}

.done:hover {
  background: rgb(232 200 120 / 12%);
}

:is(.close, .done):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

/* Short, and only on the scrim and a small rise: the panel should feel summoned, not animated. */
.flyout-enter-active,
.flyout-leave-active {
  transition: opacity 140ms ease;
}

.flyout-enter-active .panel,
.flyout-leave-active .panel {
  transition: transform 140ms ease;
}

.flyout-enter-from,
.flyout-leave-to {
  opacity: 0;
}

.flyout-enter-from .panel,
.flyout-leave-to .panel {
  transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .flyout-enter-active,
  .flyout-leave-active,
  .flyout-enter-active .panel,
  .flyout-leave-active .panel {
    transition: none;
  }
}
</style>
