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
import { mdiChevronDown, mdiChevronRight } from '@mdi/js'
import { computed, onMounted, shallowRef, watch } from 'vue'
import type { FinalTally } from '@hexnome/rules/groups'
import FinalScore from './FinalScore.vue'
import type { RoundRecord } from './roundRecord'
import ScoringReveal from './ScoringReveal.vue'

/** One player, as the tab row shows them. */
export interface SeatTab {
  readonly seat: number
  readonly name: string
  /** Banked across every finished round, and what the finished board added — null until it is asked for. */
  readonly rounds: number
  readonly final: number | null
  /** `rounds` plus `final`, which is the number the game is decided on. */
  readonly total: number
  readonly viewed: boolean
}

const props = defineProps<{
  /** Every round finished so far, oldest first, each rebuilt from the game log — for one seat. */
  rounds: readonly RoundRecord[]
  /**
   * Everyone at the table, or empty for a solo game.
   *
   * The panel counts **one** board, because that is what a score is. At a table the interesting
   * question is how it compares, so the seats are tabs across the top and `rounds` is whichever of
   * them is selected — the parent re-derives it from the log rather than this panel holding several.
   */
  seats: readonly SeatTab[]
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
  /**
   * Whether the dialog keeps the keyboard inside itself. True everywhere but a replay.
   *
   * A replay stops on round endings, which is exactly when this panel is up — and its transport lives
   * outside the dialog, so a focus trap would leave the only controls that can move the game on
   * clickable but not tabbable. Declared rather than left to fall through onto the `v-dialog`,
   * because a prop that quietly works by attribute inheritance is a prop nobody knows is there.
   */
  retainFocus?: boolean
  /** The game this panel is the end of, so it can offer to play it back. */
  gameId?: string
  /** True when this *is* a replay, which is when there is nothing to offer to replay. */
  replaying?: boolean
  /** True while the server is dealing the repeat, so it cannot be asked for twice. */
  repeating?: boolean
}>()

const emit = defineEmits<{
  /** Deal this same game again — same bags, same opening, same targets. */
  again: []
  next: []
  select: [seat: number]
}>()

const reveal = shallowRef<InstanceType<typeof ScoringReveal> | null>(null)
const finalReveal = shallowRef<InstanceType<typeof FinalScore> | null>(null)
const done = shallowRef(false)

/** The round that just ended — the one the panel is really about. */
const latest = computed(() => props.rounds.at(-1) as RoundRecord | undefined)

/**
 * Whose sheet is on screen. 0 in a solo game, where there is nothing to switch between.
 *
 * It is part of every reveal's `key` below, and that is not decoration. `ScoringReveal` builds its
 * timeline once, on mount, and drives everything from a counter over it — so a `tally` that changes
 * underneath a mounted one leaves the *previous* seat's count on screen against the new seat's rows.
 * That is how Antimony's sheet came to show a round total of 2 above a fold header reading 1.
 */
const chosenSeat = computed(() => props.seats.find(tab => tab.viewed)?.seat ?? 0)

/*
 * Changing seat spends the count, exactly as opening another section does.
 *
 * The alternative — remounting and letting it count itself out again — is worse in both directions:
 * a player who came to compare has to sit through a second reveal, and one who had already watched it
 * finish would see a fresh count start under a footer that has moved on to *Next round*. The reveal
 * belongs to the round that just ended, for the seat that was on screen when it did.
 */
watch(chosenSeat, () => spendReveal())

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
/*
 * Where the panel opens, which is not always the newest round.
 *
 * `over` arriving true at mount means this page is *rebuilding* a game that has already ended and
 * whose player has already asked for the final score — a reload, not a game reaching its end. It
 * opens where they left it. Reading a prop into a local is normally how the two drift apart; here it
 * is deliberate, because after mount this is the player's to move and no longer the caller's.
 */
/**
 * Whether any round here scored targets.
 *
 * False in a one-round game with no agenda: every round fold would be an empty accounting of nothing,
 * and the only reckoning worth opening is the final one. Asked of the records rather than of the mode,
 * so this component still knows nothing about which modes exist.
 */
const scoresRounds = computed(() => props.rounds.some(record => record.tally.rows.length > 0))

const open = shallowRef<Section>(
  props.over || !scoresRounds.value ? 'final' : (props.rounds.at(-1)?.round ?? 1),
)

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
const showingFinal = shallowRef(props.over)
const finalDone = shallowRef(false)

/**
 * A round that scored nothing needs no acknowledging, so skip straight to the reckoning.
 *
 * Normally the game ends on a button: a player has just watched a round counted out, and following it
 * with a second, larger reckoning would bury it. In a one-round game there is no first count — the
 * fold would be an empty accounting of nothing, and the button would ask them to press past it.
 *
 * `advance()` rather than setting `showingFinal` directly, because that emit is also how the owner
 * learns the game is over. Skipping the press must not skip the ending.
 */
onMounted(() => {
  if (!scoresRounds.value && !showingFinal.value) advance()
})

/**
 * What a round actually banked: its targets, plus anchors, less the first-pass fine.
 *
 * The same arithmetic `ScoringReveal` prints at the foot of each round, and the same figure the
 * scoring panel lists down its side. Summing `tally.total` alone read the targets only, so a game
 * with anchors in it closed on a total lower than the rounds it was made of — visibly so, since the
 * panel shows both.
 */
const bankedIn = (record: RoundRecord): number =>
  record.tally.total + record.anchors - record.fine

const roundsTotal = computed(() =>
  props.rounds.reduce((sum, record) => sum + bankedIn(record), 0))
const grandTotal = computed(() => roundsTotal.value + props.finalTally.total)

</script>

<template>
  <!--
    **`persistent`**, which is the whole reason this is not the same dialog as the others.
    
    A round has ended and the score is the thing that just happened; the only ways on are the buttons
    at the foot — reveal it, skip the reveal, take the next round, leave. Dismissing it by pressing
    Escape or clicking beside it would put the player back on a board that has already moved on, with
    no way to read what changed.

    Mounted only while it is wanted (`v-if` in GameView), so the model value is simply true: there is
    no closed state for this panel to be in.
  -->
  <v-dialog
    :model-value="true"
    :max-width="1100"
    :retain-focus="props.retainFocus ?? true"
    persistent
    scrollable
    :aria-label="showingFinal ? 'Final score' : `Round ${latest?.round} results`"
  >
    <v-card class="results">
      <h2 class="chrome-title chrome-title--offset">
        {{ showingFinal ? 'Final score' : `Round ${latest?.round} results` }}
      </h2>

      <!--
        Whose score this is, and what everyone else came to.

        Tabs rather than a list of every board at once: the working takes a whole board diagram, and
        four of those is a scroll. The totals are on the tabs, so the comparison — which is the actual
        question at a table — needs no clicking at all.
      -->
      <div
        v-if="props.seats.length > 1"
        class="seat-tabs"
        role="tablist"
      >
        <v-btn
          v-for="tab in props.seats"
          :key="tab.seat"
          :border="false"
          :active="tab.viewed"
          :color="tab.viewed ? 'primary' : 'muted'"
          density="comfortable"
          role="tab"
          class="seat-tab"
          :class="{ chosen: tab.viewed }"
          :aria-selected="tab.viewed"
          @click="emit('select', tab.seat)"
        >
          <span class="seat-tab-name">{{ tab.name }}</span>
          <!--
            Once the closing reckoning is in, the tab shows the sum rather than its answer. This is
            where a table compares, and "9" beside "5" invites the question the working answers.
          -->
          <span
            v-if="tab.final !== null"
            class="seat-tab-sum"
          >{{ tab.rounds }} + {{ tab.final }} =</span>
          <strong class="seat-tab-total">{{ tab.total }}</strong>
        </v-btn>
      </div>

      <!--
        Every finished round, oldest first, each collapsible. A closed one still states what it scored,
        so the sheet reads as a running account without anything being opened.
      -->
      <section
        v-for="record in (scoresRounds ? props.rounds : [])"
        :key="record.round"
        class="fold"
        :class="{ open: open === record.round }"
      >
        <v-btn
          :border="false"
          variant="text"
          density="comfortable"
          class="fold-head"
          :aria-expanded="open === record.round"
          :disabled="open === record.round"
          @click="toggle(record.round)"
        >
          <v-icon
            :icon="open === record.round ? mdiChevronDown : mdiChevronRight"
            size="small"
            class="caret"
          />
          <span class="fold-name">Round {{ record.round }}</span>
          <strong class="fold-score">{{ bankedIn(record) }}</strong>
        </v-btn>
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
            :key="`${record.round}:${chosenSeat}`"
            :ref="el => { reveal = el as InstanceType<typeof ScoringReveal> | null }"
            :tally="record.tally"
            :board="record.board"
            :anchors="record.anchors"
            :fine="record.fine"
            @done="done = true"
          />
          <!-- A past round: shown complete, with no count to sit through. -->
          <ScoringReveal
            v-else
            :key="`${record.round}:${chosenSeat}`"
            :tally="record.tally"
            :board="record.board"
            :anchors="record.anchors"
            :fine="record.fine"
            instant
          />
        </div>
      </section>

      <section
        v-if="showingFinal"
        class="fold"
        :class="{ open: open === 'final' }"
      >
        <v-btn
          :border="false"
          variant="text"
          density="comfortable"
          class="fold-head"
          :aria-expanded="open === 'final'"
          :disabled="open === 'final'"
          @click="toggle('final')"
        >
          <v-icon
            :icon="open === 'final' ? mdiChevronDown : mdiChevronRight"
            size="small"
            class="caret"
          />
          <span class="fold-name">Final scoring</span>
          <strong class="fold-score">{{ props.finalTally.total }}</strong>
        </v-btn>
        <div
          v-if="open === 'final'"
          class="fold-body"
        >
          <FinalScore
            :key="chosenSeat"
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
        <!--
          Two ways out of a finished game. Away first and louder, because the commoner answer to "that
          is your score" is another game — watching this one back is the second thought, offered
          quietly beneath it.

          Only when the game is being read live: in a replay you are already watching it, and the
          transport is right there for another look.
        -->
        <div class="ended">
          <v-btn
            to="/"
            color="success"
            variant="outlined"
            class="action"
          >
            Back to menu
          </v-btn>
          <!--
            Two things to do with a game that is over, beyond leaving. Watching it back is reading;
            playing it again is answering. The second deals the identical game — the same bags in the
            same order, the same opening, the same targets — which is what makes a score worth
            comparing rather than a different game with a familiar shape.
          -->
          <v-btn
            v-if="props.gameId && !props.replaying"
            :to="{ path: '/game', query: { id: props.gameId, replay: '1' } }"
            color="muted"
            variant="outlined"
            class="action"
          >
            Replay the game
          </v-btn>
          <v-btn
            v-if="props.gameId"
            :loading="props.repeating"
            color="muted"
            variant="outlined"
            class="action"
            @click="emit('again')"
          >
            Play this deal again
          </v-btn>
        </div>
      </template>

      <v-btn
        v-else-if="showingFinal"
        color="muted"
        class="action skip"
        @click="finalReveal?.skip()"
      >
        Skip
      </v-btn>
      <v-btn
        v-else-if="done"
        color="success"
        variant="outlined"
        class="action next"
        @click="advance"
      >
        {{ props.final ? 'Calculate final score' : 'Next round' }}
      </v-btn>
      <v-btn
        v-else
        color="muted"
        class="action skip"
        @click="reveal?.skip()"
      >
        Skip
      </v-btn>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/*
 * The dialog and the card draw the frame, the scrim and the scrolling; what is left is the panel's
 * own width and the working inside it.
 *
 * Wider than any other dialog in the app on purpose: the reveal is a board diagram beside its
 * arithmetic, and at a normal panel width the two stop fitting side by side.
 */
.results {
  padding: 18px 20px;
}

/*
 * A scrim, so the panel is legible over whatever the board happens to look like — and so it is obvious
 * that play has stopped. It takes pointer events: the round is over, and a stray click on the board
 * should land on nothing rather than on a tile.
 */
/*
 * Much wider than a list of rows needs, because it now holds a board as well. At 36 plates the diagram
 * is the constraint: any narrower and the tiles stop being legible as tiles.
 */
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
  align-items: center;
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
  flex: none;
  color: rgb(var(--v-theme-muted-dim));
}

/*
 * The row's own spacing, said on `.v-btn__content` rather than on `.fold-head`.
 *
 * A `v-btn` wraps its children in that element, so a `gap` on the button never reaches them — the
 * chevron, the name and the score ran together as one word. The width has to be stated too, because
 * the content box is an inline-flex that shrinks to its text, and `.fold-name`'s `flex: 1` has
 * nothing to grow into until it does.
 */
.fold-head :deep(.v-btn__content) {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
}

.fold-name {
  flex: 1;
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
  text-transform: uppercase;
}

.grand strong {
  color: #8fe6c0;
  font-size: var(--text-lg);
  line-height: var(--text-lg-line);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 8px 0 0;
  color: #6b7382;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

/* The advance and the way past it; both full width, the colour said by props. */
.action {
  width: 100%;
  margin-top: 16px;
}

/*
 * The two ways out of a finished game, stacked rather than side by side.
 *
 * `.action` is full-width, and the panel is a column of full-width things — a row of two halves here
 * would be the only place in it that is not, and would read as a different kind of choice than it is.
 */
.ended {
  display: flex;
  flex-direction: column;
}

/* Quieter than the advance: leaving early is allowed, not encouraged. */
@media (prefers-reduced-motion: reduce) {
  .action {
    transition: none;
  }
}

/* ── whose score ──────────────────────────────────────────────────────────────── */

.seat-tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 14px;
}

/*
 * A tab carries its own total, so the comparison the panel exists for is readable without pressing
 * anything. Pressing one changes whose working is shown below.
 */
.seat-tab {
  display: flex;
  flex: 1 1 0;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  cursor: pointer;
  transition: border-color 140ms, color 140ms, background-color 140ms;
}

.seat-tab:hover {
  border-color: #7d6a41;
  color: #cfd4de;
}

.seat-tab.chosen {
  border-color: #7d6a41;
  background: rgb(232 200 120 / 8%);
  color: #e8c878;
}

.seat-tab-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The working, quieter than the answer it leads to. */
.seat-tab-sum {
  color: #6b7382;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.seat-tab-total {
  color: #cfd4de;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.seat-tab.chosen .seat-tab-total {
  color: #e8c878;
}

.seat-tab:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .seat-tab {
    transition: none;
  }
}
</style>
