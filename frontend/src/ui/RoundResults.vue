<script setup lang="ts">
/**
 * What a round came to — the modal that holds the reveal.
 *
 * A shell: the scrim, the frame, the title and the way onward. The counting itself is `ScoringReveal`,
 * which takes one player's board and tally, so a multiplayer round becomes a queue over seats rather
 * than a rewrite of this file.
 *
 * **It shows its working.** A round that announced only a number would ask to be trusted, and would
 * teach nothing about which targets are worth chasing — which is the whole decision the agenda panel
 * exists to inform. So the score is counted out, tile by tile, from the board it came from.
 *
 * A modal, unlike the turn card: it waits rather than passing, because it ends with a choice.
 *
 * **Skip and advance are never the same pixel.** While the reveal plays the footer offers *Skip*; only
 * once it has finished does *Next round* take that place. Sharing one button would let a second click
 * land on a round the player had not seen yet.
 */
import { computed, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { RoundTally } from '@/game/agenda'
import type { Tile } from '@/game/tableau'
import type { BoardDiagram } from '@/scene/boardDiagram'
import ScoringReveal from './ScoringReveal.vue'

const props = defineProps<{
  round: number
  tally: RoundTally<Tile>
  /** The board as it stood when the round ended, snapshotted so it cannot go stale behind the panel. */
  board: BoardDiagram
  /** True on the last round of the game, which changes what the button offers. */
  final: boolean
  /**
   * Set once the last round has been banked: the same panel becomes the end of the game.
   *
   * The final round's working is still the most useful thing on screen at that moment, so it stays and
   * the footer changes rather than replacing one panel with another the player has to read afresh.
   */
  over: boolean
  /** Every round banked so far, for the closing total. */
  total: number
}>()

defineEmits<{ next: [] }>()

const reveal = shallowRef<InstanceType<typeof ScoringReveal> | null>(null)
const done = shallowRef(false)

/*
 * Keyed on the round, not on `over`.
 *
 * On the final round `startNextRound` leaves this panel mounted and only flips `over`, so anything that
 * re-ran on that change would replay the whole reveal underneath the "Final score" footer.
 */
const revealKey = computed(() => props.round)
</script>

<template>
  <div class="backdrop">
    <section
      class="chrome-panel results"
      role="dialog"
      aria-modal="true"
      :aria-label="`Round ${props.round} results`"
    >
      <h2 class="chrome-title">
        Round {{ props.round }} results
      </h2>

      <ScoringReveal
        :key="revealKey"
        ref="reveal"
        :tally="props.tally"
        :board="props.board"
        @done="done = true"
      />

      <template v-if="props.over">
        <p class="grand">
          <span>Final score</span>
          <strong>{{ props.total }}</strong>
        </p>
        <p class="note">
          Group scoring — connected runs of a colour or a value — is not built yet, so this is the
          round totals only.
        </p>
        <RouterLink
          to="/"
          class="action next"
        >
          Back to menu
        </RouterLink>
      </template>
      <button
        v-else-if="done"
        type="button"
        class="action next"
        @click="$emit('next')"
      >
        {{ props.final ? 'Finish the game' : 'Next round' }}
      </button>
      <button
        v-else
        type="button"
        class="action skip"
        @click="reveal?.skip()"
      >
        Skip
      </button>
    </section>
  </div>
</template>

<style scoped>
/*
 * A scrim, so the panel is legible over whatever the board happens to look like — and so it is obvious
 * that play has stopped. It takes pointer events: the round is over, and a stray click on the board
 * should land on nothing rather than on a tile.
 */
.backdrop {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(4 5 8 / 55%);
  z-index: 50;
}

/*
 * Much wider than a list of rows needs, because it now holds a board as well. At 36 plates the diagram
 * is the constraint: any narrower and the tiles stop being legible as tiles.
 */
.results {
  width: min(1100px, 94vw);
  max-height: 90vh;
  padding: 18px 20px;
  overflow-y: auto;
  font-size: 12px;
}

.grand {
  display: flex;
  justify-content: space-between;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid #3a3222;
  color: #79808f;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.grand strong {
  color: #8fe6c0;
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 8px 0 0;
  color: #6b7382;
  font-size: 11px;
}

.action {
  display: block;
  margin-top: 16px;
  text-align: center;
  text-decoration: none;
  padding: 9px 16px;
  width: 100%;
  border: 1px solid #4a6b58;
  border-radius: 3px;
  background: transparent;
  color: #8fe6c0;
  font: inherit;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms;
}

.action:hover {
  border-color: #8fe6c0;
  background: rgb(143 230 192 / 8%);
}

.action:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

/* Quieter than the advance: leaving early is allowed, not encouraged. */
.skip {
  border-color: #33383f;
  color: #79808f;
}

.skip:hover {
  border-color: #7d6a41;
  background: rgb(232 200 120 / 7%);
  color: #e8c878;
}

@media (prefers-reduced-motion: reduce) {
  .action {
    transition: none;
  }
}
</style>
