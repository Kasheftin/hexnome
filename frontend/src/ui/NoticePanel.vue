<script setup lang="ts">
/**
 * Something the game needs to say before play carries on.
 *
 * A centred panel over a scrim with one button. Deliberately modal: what it carries is an
 * *explanation of something the player just tried to do*, and a message that fades while they are
 * still looking at the board is a message they will miss and try again.
 *
 * ## Not the same thing as `trouble`
 *
 * `GameView` already has a full-screen state for a table it cannot reach — a dead end with a way back
 * to the menu. This is the opposite: the game is fine, the move was not, and the only thing to do is
 * read it and continue. So it dismisses rather than offering an exit.
 *
 * ## Focus goes to the button
 *
 * The panel takes the keyboard when it opens, so Enter or Space dismisses it without reaching for the
 * mouse — and Escape does too, because a dialog that can only be agreed with is a dialog people learn
 * to fear. The board underneath is covered by the scrim, which takes pointer events for the same
 * reason `RoundResults` does: a stray click while reading should land on nothing rather than on a
 * tile.
 */
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  /** What to say, or null for nothing to say. Non-null is what opens it. */
  notice: string | null
  /** A word or two above the message. */
  heading?: string
}>()

const emit = defineEmits<{ dismiss: [] }>()

const confirm = ref<HTMLButtonElement | null>(null)

watch(() => props.notice, async (text) => {
  if (!text) return
  await nextTick()
  confirm.value?.focus()
})
</script>

<template>
  <Transition name="notice">
    <div
      v-if="notice"
      class="backdrop"
      @click.self="emit('dismiss')"
    >
      <section
        class="chrome-panel notice"
        role="alertdialog"
        aria-modal="true"
        :aria-label="heading ?? 'Not allowed'"
        @keydown.esc="emit('dismiss')"
      >
        <h2 class="chrome-title chrome-title--offset">
          {{ heading ?? 'Not allowed' }}
        </h2>
        <p class="said">
          {{ notice }}
        </p>
        <v-btn
          ref="confirm"
          color="success"
          variant="outlined"
          class="action"
          @click="emit('dismiss')"
        >
          Got it
        </v-btn>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(4 5 8 / 55%);
  z-index: 60;
}

.notice {
  width: min(420px, 90vw);
  padding: 18px 20px;
}

.said {
  margin: 0 0 16px;
  color: #cfd4de;
  font-size: var(--text-base);
  /* Roomier than the panels that hold numbers: this is a sentence, and sentences are read. */
  line-height: var(--text-base-line);
}

/* The same affordance the results panel advances on, so a dismissal reads as a dismissal. */
/* Full width; the mint edge and its hover are `color="success" variant="outlined"`. */
.action {
  width: 100%;
}

.notice-enter-active,
.notice-leave-active {
  transition: opacity 140ms;
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .action,
  .notice-enter-active,
  .notice-leave-active {
    transition: none;
  }
}
</style>
