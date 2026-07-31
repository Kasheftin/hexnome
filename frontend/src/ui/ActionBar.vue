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
import {
  HEX_SIZE,
  STEM_SYMBOL_OFFSET_UP,
  STEM_SYMBOL_SCALE,
  STEM_TEXTURE_URL,
  SYMBOL_FIT,
  SYMBOL_TEXTURE_URLS,
  TILE_COLORS,
  TILE_SIZE,
  symbolOffsetUpFor,
  symbolScaleFor,
} from '@/scene/constants'

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

function colorOf(spec: { color: number }): string {
  return TILE_COLORS[spec.color]?.hex ?? '#888'
}

function symbolOf(spec: { value: number }): string {
  return SYMBOL_TEXTURE_URLS[Math.min(SYMBOL_TEXTURE_URLS.length, Math.max(1, spec.value)) - 1] ?? ''
}

/* ── chip geometry ─────────────────────────────────────────────────────────────
 *
 * A chip is a tile at 20px, so it is sized by the same rules the 3D tile is — the per-value
 * `SYMBOL_SCALE` and `SYMBOL_OFFSET_UP` the art is tuned against. Hard-coding one size for all six
 * meant the bar quietly disagreed with the board: a value-4 symbol is 1.52 there and was 1.0 here, so
 * the same tile read differently depending on where you looked at it.
 *
 * The one thing that cannot be mirrored exactly is the fit. `createSymbolPlane` fits by the image's
 * bounding-box **diagonal**; CSS `object-fit: contain` fits by its longer side. So the box below is the
 * square whose diagonal matches the 3D fit radius, which is right for a square image and a hair
 * generous for a tall one. At 20px that difference is sub-pixel; what matters is that both follow the
 * same tuning.
 */

/** Matches `.chip` in the stylesheet. Pointy-top, so the height is the 2/√3 taller one. */
const CHIP_WIDTH_PX = 20
const CHIP_HEIGHT_PX = 23

/** The chip is one tile wide, and a pointy-top hex's width is twice its apothem. */
const CHIP_APOTHEM_PX = CHIP_WIDTH_PX / 2
/** What one world unit of `HEX_SIZE` is worth in chip pixels, for the vertical nudge. */
const PX_PER_HEX_SIZE = CHIP_HEIGHT_PX / (2 * (TILE_SIZE / HEX_SIZE))

function boxFor(fitRadiusPx: number): string {
  return `${((fitRadiusPx * 2) / Math.SQRT2).toFixed(2)}px`
}

function liftPx(px: number): string {
  return px === 0 ? 'none' : `translateY(${(-px).toFixed(2)}px)`
}

/** A tile's nudge is in fractions of `HEX_SIZE`, so it converts through the chip's own scale. */
function liftBy(offsetUp: number): string {
  return liftPx(offsetUp * PX_PER_HEX_SIZE)
}

function symbolStyle(spec: { value: number }): Record<string, string> {
  const box = boxFor(CHIP_APOTHEM_PX * SYMBOL_FIT * symbolScaleFor(spec.value))
  return { width: box, height: box, transform: liftBy(symbolOffsetUpFor(spec.value)) }
}

/**
 * The stem chip carries the real emblem, at the proportions it has on the coin.
 *
 * It used to be a flat gold gradient — legible, but it did not look like the thing it stood for, and
 * the chip was a 20×23 *ellipse* because it kept the tile's box while rounding its corners.
 *
 * **Sized to the row, not to `STEM_RADIUS`.** On the table a coin is deliberately smaller than the tile
 * it displaces, but a chip is a label in a line of labels: matching the tile chip's height is what puts
 * them on one baseline and gives them equal weight. Scaling it down here only made the stem look like
 * the lesser item, which is not what it is.
 */
const STEM_CHIP_PX = CHIP_HEIGHT_PX

const stemChipStyle = {
  width: `${STEM_CHIP_PX.toFixed(2)}px`,
  height: `${STEM_CHIP_PX.toFixed(2)}px`,
}

const stemSymbolStyle = (() => {
  const radius = STEM_CHIP_PX / 2
  const box = boxFor(radius * STEM_SYMBOL_SCALE)
  // The coin's nudge is in fractions of its own radius, so it converts against the chip, not the tile.
  return { width: box, height: box, transform: liftPx(STEM_SYMBOL_OFFSET_UP * radius) }
})()

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
          <span
            v-for="(spec, i) in selection"
            :key="i"
            class="chip"
            :class="{ 'chip-plate': spec.plate }"
            :style="{ background: colorOf(spec) }"
          >
            <img
              :src="symbolOf(spec)"
              :style="symbolStyle(spec)"
              alt=""
            >
          </span>
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
          <span
            v-for="(spec, i) in paySelection"
            :key="i"
            class="chip"
            :class="{ 'chip-plate': spec.plate, 'chip-stem': spec.stem }"
            :style="spec.stem ? stemChipStyle : { background: colorOf(spec) }"
          >
            <img
              :src="spec.stem ? STEM_TEXTURE_URL : symbolOf(spec)"
              :style="spec.stem ? stemSymbolStyle : symbolStyle(spec)"
              alt=""
            >
          </span>
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

/* A hexagon, pointy-top, matching the tiles it stands for. */
.chip {
  display: grid;
  place-items: center;
  width: 20px;
  height: 23px;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

/* Size and vertical nudge are per value and come from the script — see "chip geometry". */
.chip img {
  object-fit: contain;
}

/*
 * A plate is drafted as its token, so its chip shows the same hexagon — ringed, because taking a plate
 * costs a bay rather than a tile slot and the player needs to see that at a glance when space is tight.
 */
.chip-plate {
  outline: 2px solid #b99b58;
  outline-offset: 1px;
}

/*
 * A stem's chip is the coin: round among the hexagons, carrying the same emblem the 3D coin does.
 *
 * The metal stays a gradient rather than a flat fill, because the emblem art is masked to a circle and
 * the rim showing around it is what makes the chip read as a coin rather than a sticker. Its diameter
 * comes from `STEM_RADIUS`, so the coin keeps the same size relative to a tile as it does on the table.
 */
.chip-stem {
  clip-path: none;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d8b25e, #7a6a3c);
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
