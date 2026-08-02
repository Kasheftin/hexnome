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
import type { FinalTally } from '@/game/groups'
import type { Tile } from '@/game/tableau'
import type { BoardDiagram } from '@/scene/boardDiagram'
import FinalScore from './FinalScore.vue'
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
  /** What each round scored, in order, for the closing summary. */
  banked: readonly number[]
  /** The finished board's groups. Only read once the game is over. */
  finalTally: FinalTally
}>()

defineEmits<{ next: [] }>()

const reveal = shallowRef<InstanceType<typeof ScoringReveal> | null>(null)
const finalReveal = shallowRef<InstanceType<typeof FinalScore> | null>(null)
const done = shallowRef(false)

/**
 * The final scoresheet is asked for, not dropped in.
 *
 * A player has just watched a round counted out; following it immediately with a second, larger
 * reckoning would bury it. So the game ends on a button, and the twelve rows then begin from a
 * standing start rather than halfway down a panel already full of the last round.
 */
const showingFinal = shallowRef(false)
const finalDone = shallowRef(false)

const roundsTotal = computed(() => props.banked.reduce((sum, points) => sum + points, 0))
const grandTotal = computed(() => roundsTotal.value + props.finalTally.total)

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
        {{ showingFinal ? 'Final score' : `Round ${props.round} results` }}
      </h2>

      <FinalScore
        v-if="showingFinal"
        ref="finalReveal"
        :tally="props.finalTally"
        :board="props.board"
        @done="finalDone = true"
      />
      <ScoringReveal
        v-else
        :key="revealKey"
        ref="reveal"
        :tally="props.tally"
        :board="props.board"
        @done="done = true"
      />

      <!-- The closing reckoning: the board's groups, then the rounds, then everything. -->
      <template v-if="showingFinal && finalDone">
        <ol class="rounds">
          <li
            v-for="(points, index) in props.banked"
            :key="index"
          >
            <span>Round {{ index + 1 }}</span>
            <strong>{{ points }}</strong>
          </li>
          <li class="rounds-total">
            <span>Rounds</span>
            <strong>{{ roundsTotal }}</strong>
          </li>
        </ol>
        <p class="grand">
          <span>Total score</span>
          <strong>{{ grandTotal }}</strong>
        </p>
        <RouterLink
          to="/"
          class="action next"
        >
          Back to menu
        </RouterLink>
      </template>

      <button
        v-else-if="showingFinal"
        type="button"
        class="action skip"
        @click="finalReveal?.skip()"
      >
        Skip
      </button>
      <button
        v-else-if="props.over"
        type="button"
        class="action next"
        @click="showingFinal = true"
      >
        Final score
      </button>
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

.rounds {
  display: grid;
  gap: 2px;
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid #2a2c33;
  list-style: none;
}

.rounds li {
  display: flex;
  justify-content: space-between;
  color: #79808f;
}

.rounds strong {
  color: #cfd4de;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.rounds-total {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid #22252b;
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
