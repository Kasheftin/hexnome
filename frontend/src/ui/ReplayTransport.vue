<script setup lang="ts">
/**
 * The controls for watching a finished game back.
 *
 * ## Why it is above everything
 *
 * A replay walks through round endings, and a round ending puts the scoresheet up — a `v-dialog`,
 * with a scrim over the board and a focus trap inside it. A transport underneath that is a transport
 * you cannot reach at exactly the moments you most want it, because the game has stopped and is
 * waiting for you to press something.
 *
 * Two things are needed and only one of them is `z-index`. The stacking puts it over the scrim
 * (Vuetify hands overlays numbers from about 2000, assigned in the order they open, so this sits well
 * clear at 3000). The other half is that the dialog must stop retaining focus while a replay is on, or
 * this is clickable but not tabbable — see GameView, which passes `:retain-focus="false"` in replay.
 *
 * Deliberately **not** a `v-dialog` itself. A second overlay would join the same stack and take its
 * turn in it, which is the problem rather than the fix.
 */
import { computed } from 'vue'
import {
  mdiPause,
  mdiPlay,
  mdiSkipBackward,
  mdiSkipForward,
  mdiSkipNext,
  mdiSkipPrevious,
} from '@mdi/js'

const props = defineProps<{
  /** Which position is showing: 0 is the opening, `moves` is the end of the game. */
  at: number
  moves: number
  playing: boolean
  round: number
  rounds: number
  /**
   * The drawer's top edge, which is where the action bar sits.
   *
   * A replay takes that place because it *is* the action bar: the only thing that moves the game on.
   * Anchored to the bottom of the window instead, it sat over the drawer and hid the tiles whose
   * arrival is the thing being watched.
   */
  anchorX: number
  anchorY: number
}>()

const emit = defineEmits<{
  seek: [position: number]
  play: []
  pause: []
}>()

const atStart = computed(() => props.at <= 0)
const atEnd = computed(() => props.at >= props.moves)

/**
 * Playing at the end is not a state worth being in.
 *
 * Pressing play on the last position would tick once and stop, which reads as a broken button. From
 * the end, play starts again from the opening — the only reading of "play" that does anything.
 */
function togglePlay(): void {
  if (props.playing) {
    emit('pause')
    return
  }
  if (atEnd.value) emit('seek', 0)
  emit('play')
}
</script>

<template>
  <div
    class="hx-replay"
    role="group"
    aria-label="Replay controls"
    :style="{ left: `${props.anchorX}px`, top: `${props.anchorY}px` }"
  >
    <v-btn
      :icon="mdiSkipBackward"
      :border="false"
      :disabled="atStart"
      variant="text"
      density="comfortable"
      aria-label="Back to the start"
      @click="emit('seek', 0)"
    />
    <v-btn
      :icon="mdiSkipPrevious"
      :border="false"
      :disabled="atStart"
      variant="text"
      density="comfortable"
      aria-label="A move back"
      @click="emit('seek', props.at - 1)"
    />
    <v-btn
      :icon="props.playing ? mdiPause : mdiPlay"
      :border="false"
      variant="text"
      density="comfortable"
      :aria-label="props.playing ? 'Pause' : 'Play'"
      @click="togglePlay"
    />
    <v-btn
      :icon="mdiSkipNext"
      :border="false"
      :disabled="atEnd"
      variant="text"
      density="comfortable"
      aria-label="A move on"
      @click="emit('seek', props.at + 1)"
    />

    <v-btn
      :icon="mdiSkipForward"
      :border="false"
      :disabled="atEnd"
      variant="text"
      density="comfortable"
      aria-label="On to the end"
      @click="emit('seek', props.moves)"
    />

    <!--
      Where you are, in the two units that mean something: which move, and which round it fell in.
      The round is what makes a position findable — "somewhere around the end of round two" is how
      anybody actually remembers a game.
    -->
    <p class="hx-replay__where">
      <span class="hx-replay__move">{{ props.at }} / {{ props.moves }}</span>
      <span
        v-if="props.rounds > 1"
        class="hx-replay__round"
      >round {{ props.round }}</span>
    </p>
  </div>
</template>

<style lang="scss">
/*
 * Not `scoped`: a scope attribute raises specificity, which is what the layers exist to make
 * irrelevant. See styles/layers.scss.
 */
@layer components {
  .hx-replay {
    /*
     * Over the dialog stack. Vuetify numbers overlays from about 2000 as they open, so 3000 clears a
     * scoresheet and anything opened on top of one. Fixed rather than absolute: the board pans under
     * it and a control that panned with the board would be a control that walked off the screen.
     */
    position: fixed;
    z-index: 3000;
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 6px 8px 6px 6px;
    border: 1px solid rgb(var(--v-theme-outline));
    border-radius: 8px;
    background: rgb(var(--v-theme-surface));
    /* Bottom-centre on the drawer's top edge, the same anchoring the action bar uses. */
    transform: translate(-50%, calc(-100% - 10px));
  }

  .hx-replay__where {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 0;
    padding-inline: 8px;
    white-space: nowrap;
  }

  .hx-replay__move {
    font-variant-numeric: tabular-nums;
  }

  .hx-replay__round {
    color: rgb(var(--v-theme-muted));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
  }
}
</style>
