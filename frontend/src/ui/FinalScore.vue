<script setup lang="ts">
/**
 * The finished board, scored group by group.
 *
 * Twelve categories — six colours, then six values — each holding whatever connected runs of three or
 * more the board formed. A category lights, each of its groups flies in whole, and the group's own
 * score lands beside it.
 *
 * **The unit is the group, not the tile.** Three touching greens are worth something the same three
 * scattered are not, so they travel together: a group that arrived a tile at a time would be showing
 * the wrong thing. Within a group the members are staggered slightly, which reads as one flock rather
 * than one object.
 *
 * Every category is listed whether it scored or not. A colour that formed no run is a fact about the
 * board, and a sheet that showed only the scoring ones would be a different twelve rows every game —
 * so "none" is printed deliberately.
 *
 * Sharing `BoardDiagram`, `useTileFlights` and the timeline with the round reveal is the point: the two
 * count different things, but a tile crossing the screen should look identical in both.
 */
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { FinalTally } from '@/game/groups'
import {
  fitCadence,
  finalTimeline,
  holdOf,
  type ScoringStep,
} from '@/game/scoringTimeline'
import type { BoardDiagram } from '@/scene/boardDiagram'
import { TILE_COLORS } from '@/scene/constants'
import BoardDiagramView, { type TileEmphasis } from './BoardDiagram.vue'
import TileChip from './TileChip.vue'
import TileFlights from './TileFlights.vue'
import { GROUP_STAGGER_MS, useTileFlights } from './useTileFlights'

const props = defineProps<{
  tally: FinalTally
  board: BoardDiagram
}>()

const emit = defineEmits<{ done: [] }>()

const reduced = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** Twelve rows of groups is a long sheet, so reduced motion runs to a tighter budget still. */
const REDUCED_BUDGET_MS = 3000

const timeline = computed(() => finalTimeline(props.tally))
const cadence = computed(() =>
  fitCadence(timeline.value, reduced ? REDUCED_BUDGET_MS : undefined))

const applied = shallowRef(0)
/** Chip keys — `row:group:index` — that have landed. Everything counted derives from this. */
const arrived = shallowRef<ReadonlySet<string>>(new Set())
const finished = shallowRef(false)

const steps = computed(() => timeline.value.slice(0, applied.value))

const chipKey = (row: number, group: number, index: number): string => `${row}:${group}:${index}`

/** The category being counted, and within it the group currently in the air. */
const active = computed(() => {
  if (finished.value) return { row: null as number | null, group: null as number | null }
  let row: number | null = null
  let group: number | null = null
  for (const step of steps.value) {
    if (step.kind === 'row') { row = step.row; group = null }
    if (step.kind === 'group') group = step.groupIndex
    if (step.kind === 'rowDone') group = null
    if (step.kind === 'total') { row = null; group = null }
  }
  return { row, group }
})

const groupLanded = (row: number, index: number): boolean => {
  const group = props.tally.categories[row]?.groups[index]
  if (!group) return false
  return group.tiles.every((_tile, at) => arrived.value.has(chipKey(row, index, at)))
}

/** A category's running score: only groups that have fully arrived. */
const subtotalOf = (row: number): number =>
  (props.tally.categories[row]?.groups ?? [])
    .reduce((sum, group, index) => sum + (groupLanded(row, index) ? group.points : 0), 0)

const endScore = computed(() =>
  props.tally.categories.reduce((sum, _category, row) => sum + subtotalOf(row), 0))

/** Times each tile has been paid for so far — at most twice, once per attribute. */
const counts = computed(() => {
  const map = new Map<string, number>()
  props.tally.categories.forEach((category, row) => {
    category.groups.forEach((group, index) => {
      group.tiles.forEach((tile, at) => {
        if (arrived.value.has(chipKey(row, index, at))) {
          map.set(tile.id, (map.get(tile.id) ?? 0) + 1)
        }
      })
    })
  })
  return map
})

/**
 * The board's emphasis: only the group in the air is lit.
 *
 * Everything else is muted, including other groups of the same colour — "one by one" is the whole
 * point, and lighting a colour's every group at once would lose which one is being counted.
 */
const tileStates = computed(() => {
  const map = new Map<string, TileEmphasis>()
  const { row, group } = active.value
  if (row === null || group === null) return map

  const lit = new Set(props.tally.categories[row]?.groups[group]?.tiles.map(t => t.id) ?? [])
  for (const tile of props.board.tiles) {
    map.set(tile.id, lit.has(tile.id) ? 'active' : 'muted')
  }
  return map
})

const boardEl = shallowRef<HTMLElement | null>(null)
const rowsEl = shallowRef<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function rectOf(root: HTMLElement | null, selector: string): DOMRect | null {
  const el = root?.querySelector(selector)
  return el ? el.getBoundingClientRect() : null
}

function markArrived(key: string): void {
  const next = new Set(arrived.value)
  next.add(key)
  arrived.value = next
}

const flights = useTileFlights(markArrived)

const chipVisible = (row: number, group: number, index: number): boolean => {
  const key = chipKey(row, group, index)
  return arrived.value.has(key) || flights.pending.value.has(key)
}

/** Send a whole group across, its members a beat apart so it reads as one flock. */
function fly(step: Extract<ScoringStep, { kind: 'group' }>): void {
  const group = props.tally.categories[step.row]?.groups[step.groupIndex]
  if (!group) return

  group.tiles.forEach((tile, at) => {
    const key = chipKey(step.row, step.groupIndex, at)
    const to = rectOf(rowsEl.value, `[data-chip="${key}"]`)
    const from = rectOf(boardEl.value, `[data-tile-id="${CSS.escape(tile.id)}"]`)
    // Nowhere to fly from or to: still count it. The arithmetic does not depend on the picture.
    if (!to || !from) {
      markArrived(key)
      return
    }
    flights.send({
      key,
      color: tile.color,
      value: tile.value,
      from,
      to,
      delay: at * GROUP_STAGGER_MS,
      emphasise: (counts.value.get(tile.id) ?? 0) > 0,
    })
  })
}

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function finish(): void {
  stopTimer()
  flights.clear()
  applied.value = timeline.value.length
  const all = new Set<string>()
  props.tally.categories.forEach((category, row) => {
    category.groups.forEach((group, index) => {
      group.tiles.forEach((_tile, at) => all.add(chipKey(row, index, at)))
    })
  })
  arrived.value = all
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

  if (current.kind === 'group') {
    if (reduced) {
      const group = props.tally.categories[current.row]?.groups[current.groupIndex]
      group?.tiles.forEach((_tile, at) => markArrived(chipKey(current.row, current.groupIndex, at)))
    } else {
      fly(current)
    }
  }

  timer = setTimeout(step, holdOf(current, cadence.value))
}

defineExpose({ skip: finish })

onMounted(() => {
  // Nothing formed a group: there is no counting to watch, only a sheet of noughts.
  if (props.tally.categories.every(category => category.groups.length === 0)) {
    finish()
    return
  }
  step()
})

onBeforeUnmount(() => {
  stopTimer()
  flights.clear()
})

/** "green" for a colour, "3s" for a value — short, because there are twelve of them. */
function nameOf(row: number): string {
  const category = props.tally.categories[row]
  if (!category) return ''
  return category.attribute === 'color'
    ? TILE_COLORS[category.key]?.name.toLowerCase() ?? 'tiles'
    : `${category.key}s`
}

const doubleCounted = computed(() =>
  [...counts.value.values()].filter(times => times > 1).length)
</script>

<template>
  <div class="final">
    <div
      ref="boardEl"
      class="board"
    >
      <BoardDiagramView
        :board="props.board"
        :states="tileStates"
        :counts="counts"
        label="The finished board"
      />
    </div>

    <div
      ref="rowsEl"
      class="sheet"
      aria-hidden="true"
    >
      <ol class="rows">
        <li
          v-for="(category, row) in props.tally.categories"
          :key="row"
          class="row"
          :class="{ active: active.row === row, split: row === 6 }"
        >
          <span class="what">
            <TileChip
              v-if="category.attribute === 'color'"
              :color="category.key"
            />
            <TileChip
              v-else
              :value="category.key"
            />
            <span class="name">{{ nameOf(row) }}</span>
          </span>

          <span class="groups">
            <span
              v-for="(group, index) in category.groups"
              :key="index"
              class="group"
              :class="{ lit: active.row === row && active.group === index }"
            >
              <span
                v-for="(tile, at) in group.tiles"
                :key="at"
                class="slot"
                :class="{ shown: chipVisible(row, index, at) }"
                :data-chip="chipKey(row, index, at)"
              >
                <TileChip
                  :color="tile.color"
                  :value="tile.value"
                />
              </span>
              <span
                class="pts"
                :class="{ shown: groupLanded(row, index) }"
              >{{ group.points }}</span>
            </span>
            <span
              v-if="category.groups.length === 0"
              class="none"
            >none</span>
          </span>

          <span class="sum"><strong>{{ subtotalOf(row) }}</strong></span>
        </li>
      </ol>

      <p class="total">
        <span>End score</span>
        <strong>{{ endScore }}</strong>
      </p>
      <p
        v-if="finished && doubleCounted > 0"
        class="note"
      >
        {{ doubleCounted === 1 ? 'One tile scored' : `${doubleCounted} tiles scored` }}
        in a colour group and a value group both — marked with a dot.
      </p>
    </div>

    <ul class="sr-only">
      <li
        v-for="(category, row) in props.tally.categories"
        :key="row"
      >
        {{ nameOf(row) }}: {{ category.groups.length }} groups, {{ category.points }} points.
      </li>
      <li>End score {{ props.tally.total }}.</li>
    </ul>

    <TileFlights
      :flyers="flights.flyers.value"
      :launch="flights.launch"
    />
  </div>
</template>

<style scoped>
.final {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 22px;
  align-items: start;
}

.board {
  position: sticky;
  top: 0;
  aspect-ratio: 1 / 1;
  min-height: 260px;
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
  grid-template-columns: 84px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 5px 6px;
  border-top: 1px solid #2a2c33;
  border-radius: 3px;
  transition: background-color 200ms ease;
}

/* Colours above, values below: a heavier rule marks where the sheet changes question. */
.row.split {
  margin-top: 6px;
  border-top: 1px solid #3a3222;
}

.row.active {
  background: rgb(143 230 192 / 8%);
}

.row.active .name {
  color: #8fe6c0;
}

.what {
  display: flex;
  gap: 7px;
  align-items: center;
}

.name {
  color: #79808f;
  letter-spacing: 0.04em;
}

.groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  align-items: center;
}

/* A group is one visual unit: its tiles, then what they came to. */
.group {
  display: flex;
  gap: 3px;
  align-items: center;
  padding: 2px 5px 2px 2px;
  border: 1px solid transparent;
  border-radius: 3px;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.group.lit {
  border-color: rgb(143 230 192 / 45%);
  background: rgb(143 230 192 / 8%);
}

/*
 * Chips are rendered from the start and merely invisible, so a row's width is settled before the first
 * flight — inserting them on arrival would reflow the row and every rect measured against it.
 */
.slot {
  opacity: 0;
  transition: opacity 120ms ease;
}

.slot.shown {
  opacity: 1;
}

/* The group's score lands only once all of its tiles have. */
.pts {
  margin-left: 3px;
  opacity: 0;
  color: #e8c878;
  font-variant-numeric: tabular-nums;
  transition: opacity 160ms ease;
}

.pts.shown {
  opacity: 1;
}

.none {
  color: #4d535e;
  font-style: italic;
}

.sum strong {
  min-width: 26px;
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

@media (width <= 900px) {
  .final {
    grid-template-columns: minmax(0, 1fr);
  }

  .board {
    position: static;
  }
}

@media (prefers-reduced-motion: reduce) {
  .row,
  .slot,
  .pts,
  .group {
    transition: none;
  }
}
</style>
