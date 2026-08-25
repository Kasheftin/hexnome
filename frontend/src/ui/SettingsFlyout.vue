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
import { mdiClose } from '@mdi/js'

withDefaults(defineProps<{
  open: boolean
  title: string
  /**
   * **Defaults to a column of the menu behind it** — 460px, the same as each half of the setup
   * screen. The dials in there are the same dials that screen summarises, so a panel of a different
   * width would read as a different kind of thing.
   *
   * The in-game readout asks for more, because it is a two-column table rather than a stack of
   * dials and its explanations need somewhere to sit.
   */
  width?: number
}>(), { width: 460 })

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <!--
    `v-dialog` supplies the scrim, Escape, the focus trap and the transition, and returns focus to
    whatever opened it. What is left here is the three-band shape — header, scrolling body, pinned
    actions — which is the part that is actually a decision.

    `:model-value` with an emit rather than `v-model`, so the `open` / `close` contract both call
    sites already use survives the change of shell.
  -->
  <v-dialog
    :model-value="open"
    :max-width="width"
    scrollable
    :aria-label="title"
    @update:model-value="emit('close')"
  >
    <v-card class="hx-flyout">
      <v-card-title class="hx-flyout__head">
        <span class="chrome-title">{{ title }}</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          :border="false"
          variant="text"
          density="comfortable"
          aria-label="Close settings"
          @click="emit('close')"
        />
      </v-card-title>

      <v-divider />

      <div class="hx-flyout__body">
        <slot />
      </div>

      <v-divider />

      <!--
        The footer stays put while the body scrolls, so anything here is reachable from any point in
        a long list of dials. `aside` is for what the caller wants beside Done — see HomeView's
        reset, which has to be findable rather than buried under thirteen sections.
      -->
      <v-card-actions class="hx-flyout__actions">
        <slot name="aside" />
        <v-spacer />
        <v-btn
          color="primary"
          class="hx-flyout__done"
          @click="emit('close')"
        >
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style lang="scss">
/*
 * Not `scoped`: a scope attribute raises specificity, which is what the layers exist to make
 * irrelevant. See styles/layers.scss.
 *
 * Everything the dialog and the card already draw is gone — backdrop, frame, header rule, close
 * button, focus ring, transition. What is left is the band structure: the panel does not scroll,
 * its body does, so the title stays put and Done stays reachable however long the dials get.
 */
@layer components {
  .hx-flyout {
    display: flex;
    flex-direction: column;
    max-height: min(86vh, 720px);
    /* None of its own: each band pads itself, so the scrollbar runs the body's full height. */
    overflow: hidden;
  }

  .hx-flyout__head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  /*
   * `min-height: 0` is what makes the overflow work at all — a flex item's floor is its content,
   * and without it the body would grow the panel past its max height instead of scrolling.
   */
  .hx-flyout__body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 16px 22px;
    overflow-y: auto;
  }

  .hx-flyout__actions {
    flex: none;
    gap: 8px;
    padding: 12px 16px;
  }
}
</style>
