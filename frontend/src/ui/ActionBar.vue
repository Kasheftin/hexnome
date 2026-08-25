<script setup lang="ts">
/**
 * The action bar: whose turn it is, and the one action they are taking.
 *
 * DOM over the canvas, not geometry in the scene — it is text and buttons, so it gets focus,
 * keyboard activation and crisp type for free (docs/tech-spec.md, "UI chrome"). Positioned from the
 * same `createDrawerLayout` that places the drawer's 3D bays, so the two cannot drift apart.
 *
 * It has four faces. Three are the turn's phases:
 *
 * - **idle** — the three actions. Disabled ones stay visible rather than hidden, so the shape of a
 *   turn is legible even when most of it is unavailable.
 * - **taking** — what is selected so far, a confirm that only lights when the draft is a legal
 *   sweep, and a cancel.
 * - **putting** — where the item may go, and a cancel.
 *
 * The fourth is **watching**, for somebody with no seat at this table. It has no actions at all —
 * not disabled ones. A greyed Take still reads as *your* Take that has gone wrong somehow, which is
 * exactly how a page with no token came to look like a player; a bar with nothing to press is
 * unmistakable. What it shows instead is where the watcher is: the board on the left, the turn on the
 * right, because those two come apart and one sentence trying to say both has to pick a lie.
 *
 * The turn label is where "It's player 2's turn" will go in multiplayer. In singleplayer it is always
 * the local player's turn, so it reads as a status line rather than a wait.
 */
import { computed } from 'vue'
import type { TurnOptions, TurnPhase } from '@hexnome/rules/turn'
import TileChip from './TileChip.vue'
import { TILE_COLORS } from '@/scene/constants'

const props = defineProps<{
  /**
   * What passing is called here.
   *
   * Passing takes you out of the *round*, and in a game of four rounds that is what it means. In a
   * one-round game the round is the game, so "Pass" understates it — the word is the only thing that
   * changes, and the action stays `'pass'`, because the rules and the log are the same either way.
   */
  passLabel?: string
  phase: TurnPhase
  options: TurnOptions
  /** Items picked so far, in click order. A plate shows its own token. */
  selection: readonly { color: number, value: number, plate: boolean }[]
  /** What the placement costs, and what has been put towards it. */
  payCost: number
  paySelection: readonly { color: number, value: number, plate: boolean, stem: boolean }[]
  /** True when the payment is exactly right. */
  canApply: boolean
  /** True when the selection is a complete, legal draft *and* it fits the drawer. */
  canConfirm: boolean
  /** Whether the drawer has room for the selection. False is what "out of space" reports. */
  fits: boolean
  /** Which attribute the draft has settled on, or null while both are still live. */
  attribute: 'color' | 'value' | null
  /** Which strategies are fully swept. Either one being true is what makes the take legal. */
  completed: { color: boolean, value: boolean }
  /** Centre of the drawer and the y its top edge sits at, both in screen pixels. */
  anchorX: number
  anchorY: number
  turnLabel: string
  /**
   * Does this game have undo at all? Solo, and set up for it.
   *
   * Separate from {@link canUndo} because the two mean different things to a player. A game without
   * undo shows no button — a control that can never be pressed is clutter that has to be read and
   * dismissed every turn. A game with undo shows it greyed when there is nothing to take back, which
   * says the feature is there and this moment is not it.
   */
  offersUndo: boolean
  /** Is there a turn to take back right now? */
  canUndo: boolean
  /**
   * Which board is being watched, for a viewer with no seat — and null for a player.
   *
   * Non-null is what puts the bar in its fourth face. It carries the text rather than a boolean so
   * that naming the board stays with the view that knows the seats.
   */
  watchingLabel: string | null
}>()

defineEmits<{
  choose: [action: 'take' | 'put' | 'pass' | 'undo']
  confirm: []
  apply: []
  cancel: []
}>()

/**
 * What the draft is being described as — and, when it cannot be confirmed, why not.
 *
 * Reads from the **completed strategies**, not from the pinned attribute. Those differ in the case that
 * matters: a single tile unique in its colour has finished the colour sweep while the symbol reading is
 * still live and unpinned, so there is a sweep to name even though nothing has been decided.
 *
 * The greyed-out cases matter as much. Saying "all red" beside a disabled Take would have the bar
 * contradicting itself — the player would read the selection as done and the button as broken — so an
 * unfinished sweep says so.
 */
/**
 * What the placement still owes.
 *
 * A free placement says so outright rather than showing "0 of 0", which reads as a broken counter. The
 * running count matters more than the total once picking starts, so it leads with what is left.
 */
const paySummary = computed(() => {
  if (props.payCost === 0) return 'free — nothing to pay'
  const left = props.payCost - props.paySelection.length
  if (left > 0) return `spend ${left} more of ${props.payCost}`
  return props.canApply ? 'paid' : 'that will not do'
})

const draftSummary = computed(() => {
  const first = props.selection[0]
  if (!first) return 'pick a tile'

  /*
   * Out of space beats everything else worth saying.
   *
   * The sweep may be perfectly legal and still impossible — a colour sweep drags the plate along with
   * the tiles, and the plate bays can be full. Naming the sweep here would leave the player staring at a
   * finished-looking selection and a dead button with no explanation.
   */
  if (!props.fits) return 'out of space'

  const colourName = TILE_COLORS[first.color]?.name ?? 'colour'
  const { color, value } = props.completed

  // Unique in both: either sweep is this one tile, so there is no criterion worth naming.
  if (color && value) return 'nothing else matches'
  if (color) return `all ${colourName}`
  if (value) return `all ${first.value}s`

  // Nothing swept yet. Name the criterion only once it has actually pinned.
  if (props.attribute === 'color') return `more ${colourName} to take`
  if (props.attribute === 'value') return `more ${first.value}s to take`
  return 'colour or symbol'
})
</script>

<template>
  <div
    class="bar chrome-panel"
    :style="{ left: `${anchorX}px`, top: `${anchorY}px` }"
  >
    <p class="turn">
      {{ watchingLabel ?? turnLabel }}
    </p>
    <span
      class="rule"
      aria-hidden="true"
    />

    <!-- Watching: no actions, and the turn moves over into their place. -->
    <p
      v-if="watchingLabel"
      class="turn"
    >
      {{ turnLabel }}
    </p>

    <!-- Choosing -->
    <template v-else-if="phase.kind === 'idle'">
      <v-btn
        color="primary"
        variant="outlined"
        class="action"
        :disabled="!options.take"
        @click="$emit('choose', 'take')"
      >
        Take
      </v-btn>
      <v-btn
        color="primary"
        variant="outlined"
        class="action"
        :disabled="!options.put"
        @click="$emit('choose', 'put')"
      >
        Put
      </v-btn>
      <v-btn
        class="action"
        :disabled="!options.pass"
        @click="$emit('choose', 'pass')"
      >
        {{ props.passLabel ?? 'Pass' }}
      </v-btn>
      <span
        v-if="offersUndo"
        class="rule"
        aria-hidden="true"
      />
      <v-btn
        v-if="offersUndo"
        class="action"
        :disabled="!canUndo"
        :title="canUndo ? 'Take the last turn back' : 'Nothing to take back this round'"
        @click="$emit('choose', 'undo')"
      >
        Undo
      </v-btn>
    </template>

    <!-- Drafting -->
    <template v-else-if="phase.kind === 'taking'">
      <span class="verb">Take</span>
      <span
        v-if="selection.length"
        class="chips"
      >
        <TileChip
          v-for="(spec, i) in selection"
          :key="i"
          :color="spec.color"
          :value="spec.value"
          :plate="spec.plate"
        />
      </span>
      <span class="hint">{{ draftSummary }}</span>
      <v-btn
        color="primary"
        variant="outlined"
        class="action"
        :disabled="!canConfirm"
        @click="$emit('confirm')"
      >
        Take
      </v-btn>
      <v-btn
        class="action"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
    </template>

    <!-- Placing -->
    <template v-else-if="phase.kind === 'putting'">
      <span class="verb">Put</span>
      <span class="hint">drag a plate or tile onto the board</span>
      <v-btn
        class="action"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
    </template>

    <!-- Paying -->
    <template v-else>
      <span class="verb">Pay</span>
      <span
        v-if="paySelection.length"
        class="chips"
      >
        <TileChip
          v-for="(spec, i) in paySelection"
          :key="i"
          :color="spec.stem ? undefined : spec.color"
          :value="spec.stem ? undefined : spec.value"
          :plate="spec.plate"
          :stem="spec.stem"
        />
      </span>
      <span class="hint">{{ paySummary }}</span>
      <v-btn
        color="primary"
        variant="outlined"
        class="action"
        :disabled="!canApply"
        @click="$emit('apply')"
      >
        Apply
      </v-btn>
      <v-btn
        class="action"
        @click="$emit('cancel')"
      >
        Cancel
      </v-btn>
    </template>
  </div>
</template>

<style scoped>
/*
 * **Everything in the bar is a direct child of it, on one rhythm.**
 *
 * It used to be three nested flex boxes — the label, a `.doing` group at 10px, an `.actions` group at
 * 8px, all inside the bar at 18px. Nothing looked evenly spaced because nothing was: the rule after
 * the turn label sat in the bar's 18px while the rule before Undo sat in `.actions`' 8px plus its own
 * margin, so two dividers doing the same job stood at two different distances from what they divided.
 *
 * One container and one gap means every item is spaced the same, and a divider needs no offset of its
 * own — the gap already puts 8px on each side of it. `.chips` stays a group because a run of tiles is
 * one item, not several, and reads as a cluster rather than at arm's length.
 */
.bar {
  position: absolute;
  /* Anchored by its bottom-centre on the drawer's top edge. */
  display: flex;
  gap: 16px;
  height: 56px;
  align-items: center;
  padding: 16px;
  transform: translate(-50%, calc(-100% - 10px));
}

.turn {
  margin: 0;
  color: rgb(var(--v-theme-muted-dim));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
  white-space: nowrap;
}

/*
 * What the button does not decide: how tall it is.
 *
 * The bar's height follows this row, and a control four grid steps tall makes the bar taller than the
 * strip it floats over. Everything else — the brass on brass for a committing move, the slate hairline
 * on a quiet one, hover, disabled, the focus ring — is now said by the props: `color="primary"
 * variant="outlined"` for the first, the house default for the rest.
 *
 * That is 65 lines of hand-drawn button gone, including the `::before` ring, which mattered most here:
 * these sit in a row whose height the bar is sized to, so an edge counted as content was an edge that
 * moved the bar. A `v-btn` has an explicit height, so its border is absorbed rather than added.
 */
.action {
  height: auto;
  min-height: 0;
  padding: 8px 16px;
}

/*
 * The divider between two groups of items, used twice: after the turn label, and before Undo.
 *
 * Undo is the one that has to be argued for. Take, Put and Pass are the turn — one of them is what you
 * are here to choose — while Undo is about the turn *before*, so sitting in the same run of buttons
 * invites it to be read as a fourth way to play. The rule says: these three, and then something else.
 *
 * No margin of its own. The bar's gap already puts 8px on each side, and an extra margin here is
 * exactly what made the two rules sit at different distances when they lived in different containers.
 */
.rule {
  flex: none;
  width: 0;
  height: 24px;
  border-left: 1px solid rgb(var(--v-theme-border));
}

.verb {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
}

.hint {
  color: rgb(var(--v-theme-muted));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  white-space: nowrap;
}

.chips {
  display: flex;
  gap: 4px;
}

</style>
