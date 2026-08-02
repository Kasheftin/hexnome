<script setup lang="ts">
/**
 * A round's score, counted out rather than stated.
 *
 * A total on its own asks to be trusted. This shows where it came from: each target lights in turn, the
 * tiles that match it light on the board one at a time and fly into that row, and the row's counter
 * climbs as they land.
 *
 * ## Visual state is a function of one integer
 *
 * The driver owns exactly one piece of mutable state — how many timeline steps have been applied — and
 * everything on screen derives from the prefix that integer names. That is what makes the reveal
 * skippable **by construction**: `skip()` sets it to the end, and a half-played reveal and a skipped
 * one reach the same DOM by the same path. There is no animation state to unwind.
 *
 * The counters follow *landings*, not steps, so the number never runs ahead of the tile that caused it.
 *
 * ## The flyers are teleported
 *
 * `.chrome-panel` has a `backdrop-filter`, which makes it a containing block for fixed positioning, and
 * the rows list scrolls. Either would clip a tile flying out over the board, so the flyer layer is
 * teleported to `body` — outside every containing block on the way down.
 *
 * ## A tile can be counted twice
 *
 * A tile matching both a value and a colour target is paid for by both (`game/agenda.ts`). The board
 * therefore **never gives up its tile**: a copy flies, and the original stays put. A tile that flew away
 * and came back for the next row would read as a bug rather than as the rule. Tiles that scored more
 * than once end up wearing a pip each, and a footnote says so in words.
 */
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { RoundTally } from '@/game/agenda'
import {
  fitCadence,
  holdOf,
  scoringTimeline,
  type ScoringStep,
} from '@/game/scoringTimeline'
import type { Tile } from '@/game/tableau'
import type { BoardDiagram } from '@/scene/boardDiagram'
import { TILE_COLORS } from '@/scene/constants'
import BoardDiagramView, { type TileEmphasis } from './BoardDiagram.vue'
import TileChip from './TileChip.vue'

const props = defineProps<{
  tally: RoundTally<Tile>
  board: BoardDiagram
  /** Skip straight to the finished state — used when the reveal has nothing worth watching. */
  instant?: boolean
}>()

const emit = defineEmits<{ done: [] }>()

/** How long a tile takes to cross from the board to its row. */
const FLIGHT_MS = 300

const reduced = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Reduced motion keeps the sequence and drops the travel — the beat is the point, not the movement,
 * which is the line `TurnAnnounce` already takes. But it also runs to a much tighter budget: without
 * flights there is nothing to watch between beats, and holding a still frame for nine seconds is worse
 * than the animation it replaced.
 */
const REDUCED_BUDGET_MS = 2200

const timeline = computed(() => scoringTimeline(props.tally))
const cadence = computed(() =>
  fitCadence(timeline.value, reduced ? REDUCED_BUDGET_MS : undefined))

/** How many steps have been applied. The only mutable state the reveal has. */
const applied = shallowRef(0)
/** How many tiles have *landed* per row. Counters follow this, so a number never precedes its tile. */
const landed = shallowRef<readonly number[]>(props.tally.rows.map(() => 0))
const finished = shallowRef(false)

const steps = computed(() => timeline.value.slice(0, applied.value))

/** The row being counted: the most recent one opened, until the total arrives. */
const activeRow = computed(() => {
  if (finished.value) return null
  let row: number | null = null
  for (const step of steps.value) {
    if (step.kind === 'row') row = step.row
    if (step.kind === 'total') row = null
  }
  return row
})

/** Times each tile has been counted so far — drives both the board pips and the footnote. */
const counts = computed(() => {
  const map = new Map<string, number>()
  props.tally.rows.forEach((row, index) => {
    for (const tile of row.tiles.slice(0, landed.value[index] ?? 0)) {
      map.set(tile.id, (map.get(tile.id) ?? 0) + 1)
    }
  })
  return map
})

/**
 * How the board should treat each tile right now.
 *
 * Muting is per pass and never sticky: when a row finishes, its tiles go back to plain rather than to
 * some spent state. Nothing in the visual language may imply that a tile is used up, because it is not.
 */
const tileStates = computed(() => {
  const row = activeRow.value
  const map = new Map<string, TileEmphasis>()
  if (row === null) return map

  const matching = new Set(props.tally.rows[row]?.tiles.map(tile => tile.id) ?? [])
  for (const tile of props.board.tiles) {
    map.set(tile.id, matching.has(tile.id) ? 'active' : 'muted')
  }
  return map
})

const subtotalOf = (index: number): number =>
  (landed.value[index] ?? 0) * (props.tally.rows[index]?.target.points ?? 0)

const runningTotal = computed(() =>
  props.tally.rows.reduce((sum, _row, index) => sum + subtotalOf(index), 0))

/** Chips waiting for their flyer to arrive, keyed `row:index`. */
const inFlight = shallowRef<ReadonlySet<string>>(new Set())

const chipVisible = (row: number, index: number): boolean =>
  index < (landed.value[row] ?? 0) || inFlight.value.has(`${row}:${index}`)

const chipArrived = (row: number, index: number): boolean =>
  index < (landed.value[row] ?? 0)

interface Flyer {
  readonly key: number
  readonly row: number
  /** `row:index`, matching the chip it is flying to. */
  readonly chipKey: string
  readonly color: number
  readonly value: number
  readonly from: DOMRect
  readonly to: DOMRect
  readonly repeat: boolean
}

const flyers = shallowRef<readonly Flyer[]>([])
const launched = new Set<number>()
const animations = new Set<Animation>()
let nextKey = 0
let timer: ReturnType<typeof setTimeout> | null = null

const boardEl = shallowRef<HTMLElement | null>(null)
const rowsEl = shallowRef<HTMLElement | null>(null)

function rectOf(root: HTMLElement | null, selector: string): DOMRect | null {
  const el = root?.querySelector(selector)
  return el ? el.getBoundingClientRect() : null
}

function markLanded(row: number): void {
  const next = [...landed.value]
  next[row] = (next[row] ?? 0) + 1
  landed.value = next
}

function release(key: string): void {
  const next = new Set(inFlight.value)
  next.delete(key)
  inFlight.value = next
}

/**
 * Send a copy of the board tile to its chip.
 *
 * Measured at the moment the step runs rather than up front: the rows list can scroll, and a rect read
 * before that is aimed at where the chip used to be. Every chip in a row is rendered from the start —
 * invisible until it lands — so the destinations do not reflow as siblings arrive.
 */
function fly(step: Extract<ScoringStep, { kind: 'tile' }>): void {
  const tile = props.tally.rows[step.row]?.tiles[step.indexInRow]
  const to = rectOf(rowsEl.value, `[data-chip="${step.row}:${step.indexInRow}"]`)
  const from = rectOf(boardEl.value, `[data-tile-id="${CSS.escape(step.tileId)}"]`)

  // No tile to point at, or nowhere to point it: count it anyway. The arithmetic is not the picture's.
  if (!tile || !to || !from) {
    markLanded(step.row)
    return
  }

  const chipKey = `${step.row}:${step.indexInRow}`
  inFlight.value = new Set(inFlight.value).add(chipKey)
  flyers.value = [...flyers.value, {
    key: nextKey++,
    row: step.row,
    chipKey,
    color: tile.color,
    value: tile.value,
    from,
    to,
    // A tile already counted in an earlier row leaves a little larger, so a repeat reads as deliberate.
    repeat: (counts.value.get(tile.id) ?? 0) > 0,
  }]
}

/** Start a flyer once Vue has put it in the document. */
function launch(el: Element | null, flyer: Flyer): void {
  if (!(el instanceof HTMLElement) || launched.has(flyer.key)) return
  launched.add(flyer.key)

  const dx = flyer.from.left - flyer.to.left
  const dy = flyer.from.top - flyer.to.top
  const scale = (flyer.to.width > 0 ? flyer.from.width / flyer.to.width : 1) * (flyer.repeat ? 1.15 : 1)

  const animation = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.9 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: FLIGHT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  )
  animations.add(animation)

  const arrive = (): void => {
    animations.delete(animation)
    // Count it and reveal the chip, then drop the flyer: the other order costs a frame of nothing.
    markLanded(flyer.row)
    release(flyer.chipKey)
    flyers.value = flyers.value.filter(f => f.key !== flyer.key)
  }
  // `finished` rejects with AbortError when an animation is cancelled — which skip does, en masse.
  animation.finished.then(arrive).catch(() => {})
}

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/** Cancel every flight and drop the layer. Safe to call twice. */
function clearFlyers(): void {
  for (const animation of animations) animation.cancel()
  animations.clear()
  flyers.value = []
  inFlight.value = new Set()
}

function finish(): void {
  stopTimer()
  clearFlyers()
  applied.value = timeline.value.length
  landed.value = props.tally.rows.map(row => row.tiles.length)
  finished.value = true
  emit('done')
}

function step(): void {
  if (applied.value >= timeline.value.length) {
    finish()
    return
  }
  const current = timeline.value[applied.value] as ScoringStep
  applied.value++

  if (current.kind === 'tile') {
    if (reduced) markLanded(current.row)
    else fly(current)
  }

  timer = setTimeout(step, holdOf(current, cadence.value))
}

defineExpose({ skip: finish })

onMounted(() => {
  // Nothing to watch: no targets, or none of them matched anything.
  if (props.instant || props.tally.rows.every(row => row.tiles.length === 0)) {
    finish()
    return
  }
  step()
})

onBeforeUnmount(() => {
  stopTimer()
  clearFlyers()
})

const nameOf = (row: RoundTally<Tile>['rows'][number]): string =>
  row.target.kind === 'value'
    ? `all ${row.target.value}s`
    : `all ${TILE_COLORS[row.target.color]?.name.toLowerCase() ?? 'tiles'}`

/** Only shown when it is true of this round, so it teaches rather than decorates. */
const doubleCounted = computed(() =>
  [...counts.value.values()].filter(times => times > 1).length)
</script>

<template>
  <div class="reveal">
    <div
      ref="boardEl"
      class="board"
    >
      <BoardDiagramView
        :board="props.board"
        :states="tileStates"
        :counts="counts"
        label="The board being scored"
      />
    </div>

    <!--
      The animated side is hidden from assistive technology: a counter ticking under `aria-live` would
      be read out on every increment. The complete tally is in the DOM below from the first frame.
    -->
    <div
      ref="rowsEl"
      class="tally"
      aria-hidden="true"
    >
      <ol class="rows">
        <li
          v-for="(row, index) in props.tally.rows"
          :key="index"
          class="row"
          :class="{ active: activeRow === index, done: chipArrived(index, row.tiles.length - 1) }"
        >
          <span class="what">{{ nameOf(row) }}</span>
          <span class="tiles">
            <span
              v-for="(tile, at) in row.tiles"
              :key="at"
              class="slot"
              :class="{ shown: chipVisible(index, at), arrived: chipArrived(index, at) }"
              :data-chip="`${index}:${at}`"
            >
              <TileChip
                :color="tile.color"
                :value="tile.value"
              />
            </span>
            <span
              v-if="row.tiles.length === 0"
              class="none"
            >none</span>
          </span>
          <span class="sum">
            <span class="each">{{ landed[index] ?? 0 }} × {{ row.target.points }}</span>
            <strong>{{ subtotalOf(index) }}</strong>
          </span>
        </li>
      </ol>

      <p class="total">
        <span>Round total</span>
        <strong>{{ runningTotal }}</strong>
      </p>

      <p
        v-if="finished && doubleCounted > 0"
        class="note"
      >
        {{ doubleCounted === 1 ? 'One tile matched' : `${doubleCounted} tiles matched` }}
        two targets and {{ doubleCounted === 1 ? 'scores' : 'score' }} for both — marked with a dot.
      </p>
      <p
        v-if="finished && props.tally.total === 0"
        class="note"
      >
        Nothing on the board matched this round's targets.
      </p>
    </div>

    <!-- The same table again, complete and static, for a screen reader. -->
    <ul class="sr-only">
      <li
        v-for="(row, index) in props.tally.rows"
        :key="index"
      >
        {{ nameOf(row) }}: {{ row.tiles.length }} tiles, {{ row.points }} points.
      </li>
      <li>Round total {{ props.tally.total }}.</li>
    </ul>

    <!-- Outside the panel's containing block and its scroll, or a flight would be clipped. -->
    <Teleport to="body">
      <div
        v-if="flyers.length"
        class="flyers"
        aria-hidden="true"
      >
        <div
          v-for="flyer in flyers"
          :key="flyer.key"
          :ref="el => launch(el as Element | null, flyer)"
          class="flyer"
          :style="{
            left: `${flyer.to.left}px`,
            top: `${flyer.to.top}px`,
            width: `${flyer.to.width}px`,
            height: `${flyer.to.height}px`,
          }"
        >
          <TileChip
            :color="flyer.color"
            :value="flyer.value"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.reveal {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 22px;
  align-items: start;
}

/* Squarish, so a wide board and a tall one both land somewhere sensible. */
.board {
  aspect-ratio: 1 / 1;
  min-height: 240px;
  padding: 8px;
  border: 1px solid #2a2c33;
  border-radius: 3px;
  background: rgb(10 11 14 / 60%);
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 92px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 6px;
  border-top: 1px solid #2a2c33;
  border-radius: 3px;
  transition: background-color 200ms ease;
}

/* The pass being counted. Mint, the same "this is the target" the board uses. */
.row.active {
  background: rgb(143 230 192 / 8%);
}

.row.active .what {
  color: #8fe6c0;
}

.what {
  color: #79808f;
  letter-spacing: 0.04em;
}

.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}

/*
 * Every chip is rendered from the start and merely invisible, so the row's width is settled before the
 * first flight. Inserting them as they land would reflow the row and every measured destination with it.
 */
.slot {
  opacity: 0;
  transition: opacity 120ms ease;
}

.slot.shown {
  opacity: 1;
}

.none {
  color: #4d535e;
  font-style: italic;
}

.sum {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: flex-end;
}

.each {
  color: #6b7382;
  font-variant-numeric: tabular-nums;
}

.sum strong {
  min-width: 28px;
  color: #cfd4de;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.total {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid #3a3222;
  color: #79808f;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.total strong {
  color: #e8c878;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 8px 0 0;
  color: #6b7382;
  font-size: 11px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (width <= 860px) {
  .reveal {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .row,
  .slot {
    transition: none;
  }
}
</style>

<style>
/*
 * Unscoped: the layer is teleported to `body`, so a scoped attribute would not reach it.
 * `pointer-events: none` is mandatory — the layer covers the viewport, and without it it would swallow
 * the click that skips the reveal.
 */
.flyers {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
}

.flyers .flyer {
  position: fixed;
  display: grid;
  place-items: center;
}
</style>
