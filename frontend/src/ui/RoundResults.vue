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
import type { FinalTally } from '@/game/groups'
import FinalScore from './FinalScore.vue'
import type { RoundRecord } from './roundRecord'
import ScoringReveal from './ScoringReveal.vue'

const props = defineProps<{
  /** Every round finished so far, oldest first, each rebuilt from the game journal. */
  rounds: readonly RoundRecord[]
  /** True on the last round of the game, which changes what the button offers. */
  final: boolean
  /**
   * Set once the last round has been banked: the same panel becomes the end of the game.
   *
   * The final round's working is still the most useful thing on screen at that moment, so it stays and
   * the footer changes rather than replacing one panel with another the player has to read afresh.
   */
  over: boolean
  /** The finished board's groups. Only read once the game is over. */
  finalTally: FinalTally
}>()

const emit = defineEmits<{ next: [] }>()

const reveal = shallowRef<InstanceType<typeof ScoringReveal> | null>(null)
const finalReveal = shallowRef<InstanceType<typeof FinalScore> | null>(null)
const done = shallowRef(false)

/** The round that just ended — the one the panel is really about. */
const latest = computed(() => props.rounds.at(-1) as RoundRecord | undefined)

/**
 * Which section is open — a round number, `'final'`, or nothing.
 *
 * One at a time: each section holds a whole board diagram, and two open would push the buttons off
 * the screen. Opening one closes the other.
 *
 * Earlier rounds open **settled**, without re-running their count. The reveal belongs to the round
 * that just happened; replaying it every time somebody checks an old score would make the panel
 * tiring to use.
 */
type Section = number | 'final'
const open = shallowRef<Section>(props.rounds.at(-1)?.round ?? 1)

/**
 * Whether the count has had its one showing.
 *
 * The reveal is a thing that happens **once**. Touching the accordion ends it: the player has said they
 * would rather look around than watch, and a count that restarts every time they come back to the row
 * turns a one-off explanation into a recurring toll.
 */
const revealSpent = shallowRef(false)
const finalSpent = shallowRef(false)

function spendReveal(): void {
  if (!revealSpent.value) {
    reveal.value?.skip()
    revealSpent.value = true
    // Set directly rather than waiting for the reveal's own event: it may not be mounted to fire one,
    // and the footer must not be left offering Skip with nothing to skip.
    done.value = true
  }

  /*
   * The final sheet counts once too — but only mark it spent while leaving it, never before it has
   * been opened. Setting `finalDone` early would print the closing total the instant the sheet
   * appeared, and the twelve categories would never be counted at all.
   */
  if (open.value === 'final' && !finalSpent.value) {
    finalReveal.value?.skip()
    finalSpent.value = true
    finalDone.value = true
  }
}

/**
 * Open a section. There is no closing.
 *
 * Something is always expanded: a panel collapsed to nothing but headers would be a scoresheet showing
 * no score, reachable in one click from every state. So pressing the open section does nothing at all
 * — and its header is disabled to say so, rather than inviting a press that is quietly ignored.
 *
 * A press that changes nothing also leaves the count alone. Only moving *away* from the running reveal
 * spends it.
 */
const toggle = (section: Section): void => {
  if (open.value === section) return
  spendReveal()
  open.value = section
}

/** The round whose reveal counts itself out — none, once it has been spent. */
const animated = computed(() => (revealSpent.value ? -1 : latest.value?.round ?? -1))

/**
 * Bank the round, and on the last one go straight to the sheet.
 *
 * There is nothing to see between the two: banking the final round changes no pixel except the
 * button's own label, so splitting it into a second press would be a click that does nothing.
 */
function advance(): void {
  emit('next')
  if (!props.final) return
  showingFinal.value = true
  open.value = 'final'
}

/**
 * The final scoresheet is asked for, not dropped in.
 *
 * A player has just watched a round counted out; following it immediately with a second, larger
 * reckoning would bury it. So the game ends on a button, and the twelve rows then begin from a
 * standing start rather than halfway down a panel already full of the last round.
 */
const showingFinal = shallowRef(false)
const finalDone = shallowRef(false)

const roundsTotal = computed(() =>
  props.rounds.reduce((sum, record) => sum + record.tally.total, 0))
const grandTotal = computed(() => roundsTotal.value + props.finalTally.total)

</script>

<template>
  <div class="backdrop">
    <section
      class="chrome-panel results"
      role="dialog"
      aria-modal="true"
      :aria-label="showingFinal ? 'Final score' : `Round ${latest?.round} results`"
    >
      <h2 class="chrome-title">
        {{ showingFinal ? 'Final score' : `Round ${latest?.round} results` }}
      </h2>

      <!--
        Every finished round, oldest first, each collapsible. A closed one still states what it scored,
        so the sheet reads as a running account without anything being opened.
      -->
      <section
        v-for="record in props.rounds"
        :key="record.round"
        class="fold"
        :class="{ open: open === record.round }"
      >
        <button
          type="button"
          class="fold-head"
          :aria-expanded="open === record.round"
          :disabled="open === record.round"
          @click="toggle(record.round)"
        >
          <span
            class="caret"
            aria-hidden="true"
          >{{ open === record.round ? '▾' : '▸' }}</span>
          <span class="fold-name">Round {{ record.round }}</span>
          <strong class="fold-score">{{ record.tally.total }}</strong>
        </button>
        <div
          v-if="open === record.round"
          class="fold-body"
        >
          <!--
            A function ref, not `ref="reveal"`: a string ref inside `v-for` collects an *array* of
            instances, so `skip()` threw — which left the reveal unfinished and silently stopped the
            round from ever advancing.
          -->
          <ScoringReveal
            v-if="record.round === animated"
            :ref="el => { reveal = el as InstanceType<typeof ScoringReveal> | null }"
            :tally="record.tally"
            :board="record.board"
            @done="done = true"
          />
          <!-- A past round: shown complete, with no count to sit through. -->
          <ScoringReveal
            v-else
            :key="record.round"
            :tally="record.tally"
            :board="record.board"
            instant
          />
        </div>
      </section>

      <section
        v-if="showingFinal"
        class="fold"
        :class="{ open: open === 'final' }"
      >
        <button
          type="button"
          class="fold-head"
          :aria-expanded="open === 'final'"
          :disabled="open === 'final'"
          @click="toggle('final')"
        >
          <span
            class="caret"
            aria-hidden="true"
          >{{ open === 'final' ? '▾' : '▸' }}</span>
          <span class="fold-name">Final scoring</span>
          <strong class="fold-score">{{ props.finalTally.total }}</strong>
        </button>
        <div
          v-if="open === 'final'"
          class="fold-body"
        >
          <FinalScore
            ref="finalReveal"
            :tally="props.finalTally"
            :board="latest?.board ?? props.rounds[0]!.board"
            :instant="finalSpent"
            @done="finalDone = true"
          />
        </div>
      </section>

      <!-- The closing reckoning: the board's groups, then the rounds, then everything. -->
      <template v-if="showingFinal && finalDone">
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
        v-else-if="done"
        type="button"
        class="action next"
        @click="advance"
      >
        {{ props.final ? 'Calculate final score' : 'Next round' }}
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

/* ── the accordion ─────────────────────────────────────────────────────────── */

.fold + .fold {
  margin-top: 4px;
}

/*
 * A closed round is a line of account: its number is legible without opening anything, which is what
 * makes the panel readable as a running total rather than as a stack of drawers.
 */
.fold-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: rgb(255 255 255 / 2%);
  color: #79808f;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms, color 140ms;
}

.fold-head:hover:not(:disabled) {
  background: rgb(232 200 120 / 7%);
  color: #e8c878;
}

/* The open one keeps the brass of a live section, but is plainly not something to press. */
.fold-head:disabled {
  cursor: default;
}

.fold.open .fold-head {
  background: rgb(232 200 120 / 6%);
  color: #e8c878;
}

.caret {
  width: 10px;
  color: #6b7382;
}

.fold-name {
  flex: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fold-score {
  color: #cfd4de;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.fold.open .fold-score {
  color: #e8c878;
}

.fold-body {
  padding: 14px 2px 6px;
}

.fold-head:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
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
