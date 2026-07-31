<script setup lang="ts">
/**
 * The action bar: whose turn it is, and the one action they are taking.
 *
 * DOM over the canvas, not geometry in the scene — it is text and buttons, so it gets focus,
 * keyboard activation and crisp type for free (docs/tech-spec.md, "UI chrome"). Positioned from the
 * same `createDrawerLayout` that places the drawer's 3D bays, so the two cannot drift apart.
 *
 * It has three faces, one per turn phase:
 *
 * - **idle** — the three actions. Disabled ones stay visible rather than hidden, so the shape of a
 *   turn is legible even when most of it is unavailable.
 * - **taking** — what is selected so far, a confirm that only lights when the draft is a legal
 *   sweep, and a cancel.
 * - **putting** — where the item may go, and a cancel.
 *
 * The turn label is where "It's player 2's turn" will go in multiplayer. In singleplayer it is always
 * the local player's turn, so it reads as a status line rather than a wait.
 */
import { computed } from 'vue'
import type { TurnOptions, TurnPhase } from '@/game/turn'
import TileChip from './TileChip.vue'
import { TILE_COLORS } from '@/scene/constants'

const props = defineProps<{
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
}>()

defineEmits<{
  choose: [action: 'take' | 'put' | 'pass']
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
      {{ turnLabel }}
    </p>

    <!-- Choosing -->
    <template v-if="phase.kind === 'idle'">
      <div class="actions">
        <button
          type="button"
          class="action"
          :disabled="!options.take"
          @click="$emit('choose', 'take')"
        >
          Take
        </button>
        <button
          type="button"
          class="action"
          :disabled="!options.put"
          @click="$emit('choose', 'put')"
        >
          Put
        </button>
        <button
          type="button"
          class="action quiet"
          :disabled="!options.pass"
          @click="$emit('choose', 'pass')"
        >
          Pass
        </button>
      </div>
    </template>

    <!-- Drafting -->
    <template v-else-if="phase.kind === 'taking'">
      <div class="doing">
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
      </div>
      <div class="actions">
        <button
          type="button"
          class="action"
          :disabled="!canConfirm"
          @click="$emit('confirm')"
        >
          Take
        </button>
        <button
          type="button"
          class="action quiet"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </template>

    <!-- Placing -->
    <template v-else-if="phase.kind === 'putting'">
      <div class="doing">
        <span class="verb">Put</span>
        <span class="hint">drag a plate or tile onto the board</span>
      </div>
      <div class="actions">
        <button
          type="button"
          class="action quiet"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </template>

    <!-- Paying -->
    <template v-else>
      <div class="doing">
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
      </div>
      <div class="actions">
        <button
          type="button"
          class="action"
          :disabled="!canApply"
          @click="$emit('apply')"
        >
          Apply
        </button>
        <button
          type="button"
          class="action quiet"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bar {
  position: absolute;
  /* Anchored by its bottom-centre on the drawer's top edge. */
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 8px 12px;
  transform: translate(-50%, calc(-100% - 10px));
}

.turn {
  margin: 0;
  padding-right: 14px;
  border-right: 1px solid #2a2c33;
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 8px;
}

.action {
  padding: 7px 16px;
  border: 1px solid #7d6a41;
  border-radius: 3px;
  background: transparent;
  color: #e8c878;
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, color 140ms;
}

.action:hover:not(:disabled) {
  background: rgb(232 200 120 / 14%);
}

/* Reuses the mint the board already uses to mean "this is the committing move". */
.action:not(.quiet):not(:disabled) {
  border-color: #8fe6c0;
  color: #8fe6c0;
}

.action:not(.quiet):hover:not(:disabled) {
  background: rgb(143 230 192 / 14%);
}

.action.quiet {
  border-color: #33383f;
  color: #cfd4de;
}

.action:disabled {
  border-color: #24272d;
  color: #575d68;
  cursor: not-allowed;
}

.doing {
  display: flex;
  gap: 10px;
  align-items: center;
}

.verb {
  color: #cfd4de;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.hint {
  color: #79808f;
  font-size: 11px;
  white-space: nowrap;
}

.chips {
  display: flex;
  gap: 4px;
}

:is(.action):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .action {
    transition: none;
  }
}
</style>
