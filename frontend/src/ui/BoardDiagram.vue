<script setup lang="ts">
/**
 * A board, drawn flat and read-only, scaled to fit whatever contains it.
 *
 * **Why flat rather than a second 3D view.** The game is one full-window WebGL canvas, so a second
 * board means either a second context and lighting rig or a scissored viewport —
 * `docs/tech-spec.md` records why the scissored design was abandoned: a tile crossing between
 * coordinate systems has to be handed between them mid-motion. A tile flying from this board into a
 * DOM table row is that same problem. Flat SVG puts the board, the flyer and the table in one
 * coordinate space, and `getBoundingClientRect()` on an SVG child reports true screen pixels, so the
 * whole animation is ordinary DOM measurement.
 *
 * It is also the right register. This is an analysis view, not the table: the question it answers is
 * *which of these hexagons are threes*, and gloss is noise against that. The agenda column and the
 * action bar already name tiles with flat chips, so a flat board is the consistent thing — the
 * mismatch was pointing at round, lit tiles from a flat legend.
 *
 * **Fit is the viewBox**, not a measured transform. `preserveAspectRatio` refits on every container
 * change with no `ResizeObserver`, no layout thrash and no DPI loss — which is exactly the "scaled to
 * fit inside any container" the multiplayer opponent-board viewer will want.
 *
 * **A third drawing of a tile**, after the 3D mesh and `TileChip`. Everything geometric is derived
 * from `scene/constants.ts` — the same palette, the same `SYMBOL_FIT`, the same per-value scale and
 * lift — so the copies share their tuning and only their medium differs. Keep it that way.
 */
import { computed } from 'vue'
import { axialToWorld, hexApothem, type Axial } from '@/game/hex'
import type { BoardDiagram } from '@/scene/boardDiagram'
import {
  ANCHOR_EXTERNAL_PAD_R,
  ANCHOR_EXTERNAL_TINT,
  ANCHOR_RATIO,
  ANCHOR_SCALE,
  ANCHOR_TEXTURE_URLS,
  HEX_SIZE,
  PLATE_CELL_MARK_R,
  PLATE_CELL_RING_R,
  PLATE_TONES,
  SYMBOL_FIT,
  SYMBOL_TEXTURE_URLS,
  TILE_COLORS,
  TILE_SIZE,
  symbolOffsetUpFor,
  symbolScaleFor,
} from '@/scene/constants'

/** How a tile is being treated by whatever is driving the diagram. */
export type TileEmphasis = 'active' | 'counted' | 'muted'

const props = defineProps<{
  board: BoardDiagram
  /**
   * Per-tile emphasis. One map rather than several sets, because the states are exclusive: a tile is
   * being counted, or has been, or is not part of this pass.
   */
  states?: ReadonlyMap<string, TileEmphasis> | null
  /** How many times each tile has scored so far, for the pips that explain double-counting. */
  counts?: ReadonlyMap<string, number> | null
  /** Breathing room around the board, in cells. */
  padCells?: number
  /** Described to assistive technology; the diagram itself is decorative detail. */
  label?: string
}>()

/** Pointy-top hexagon centred on the origin, as an SVG path. Matches `hexPlateGeometry.ts`. */
function hexPath(size: number): string {
  const a = hexApothem(size)
  return `M0 ${-size}L${a} ${-size / 2}L${a} ${size / 2}L0 ${size}L${-a} ${size / 2}L${-a} ${-size / 2}Z`
}

const CELL_HEX = hexPath(HEX_SIZE)
const TILE_HEX = hexPath(TILE_SIZE)

function at(cell: Axial): string {
  const { x, z } = axialToWorld(cell, HEX_SIZE)
  return `translate(${x} ${z})`
}

/**
 * The frame, padded and never narrower than a single plate.
 *
 * The opening tableau is one flower; without a floor the viewBox would be tiny and `meet` would blow it
 * up to fill the panel, so a one-plate board would render with enormous tiles and a four-plate board
 * with small ones. Fixing a minimum keeps the scale roughly stable across a game.
 */
const MIN_SPAN = HEX_SIZE * 9

const viewBox = computed(() => {
  const pad = (props.padCells ?? 0.5) * HEX_SIZE * 2
  const { minX, maxX, minZ, maxZ } = props.board.bounds
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const w = Math.max(maxX - minX + pad, MIN_SPAN)
  const h = Math.max(maxZ - minZ + pad, MIN_SPAN)
  return `${cx - w / 2} ${cz - h / 2} ${w} ${h}`
})

const symbolFor = (value: number): string =>
  SYMBOL_TEXTURE_URLS[Math.min(SYMBOL_TEXTURE_URLS.length, Math.max(1, value)) - 1] ?? ''

/** The symbol's box, mirroring the 3D fit: a square whose half-diagonal is the fit radius. */
function symbolBox(value: number): { size: number, x: number, y: number } {
  const radius = hexApothem(TILE_SIZE) * SYMBOL_FIT * symbolScaleFor(value)
  const size = (radius * 2) / Math.SQRT2
  return { size, x: -size / 2, y: -size / 2 - symbolOffsetUpFor(value) * HEX_SIZE }
}

function anchorBox(kind: 'internal' | 'external'): { w: number, h: number, x: number, y: number } {
  const r = HEX_SIZE * ANCHOR_SCALE * (kind === 'external' ? ANCHOR_EXTERNAL_PAD_R : 1) * 0.5
  const w = r * 2
  const h = w / ANCHOR_RATIO
  return { w, h, x: -w / 2, y: -h / 2 }
}

const tileFill = (color: number): string => TILE_COLORS[color]?.hex ?? '#888'
</script>

<template>
  <svg
    class="diagram"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="props.label ?? 'The board'"
  >
    <!-- Plate slabs first: seven cells of bare brass under everything else. -->
    <g class="plates">
      <g
        v-for="plate in props.board.plates"
        :key="plate.id"
      >
        <path
          v-for="(cell, i) in plate.cells"
          :key="i"
          :d="CELL_HEX"
          :transform="at(cell)"
          :fill="PLATE_TONES.slab"
        />
      </g>
    </g>

    <!--
      Empty sockets are information, not decoration: they are why the score is what it is, so a player
      counting along can see the petals that stayed unfilled.
    -->
    <g class="sockets">
      <g
        v-for="plate in props.board.plates"
        :key="plate.id"
      >
        <template
          v-for="(cell, i) in plate.cells"
          :key="i"
        >
          <circle
            :transform="at(cell)"
            :r="HEX_SIZE * PLATE_CELL_MARK_R"
            :fill="PLATE_TONES.socket"
          />
          <circle
            :transform="at(cell)"
            :r="HEX_SIZE * PLATE_CELL_RING_R[1]"
            fill="none"
            :stroke="PLATE_TONES.socket"
            stroke-width="0.02"
          />
        </template>
      </g>
    </g>

    <g class="anchors">
      <image
        v-for="(anchor, i) in props.board.anchors"
        :key="i"
        :transform="at(anchor.cell)"
        :href="anchor.lit ? ANCHOR_TEXTURE_URLS.on : ANCHOR_TEXTURE_URLS.off"
        :x="anchorBox(anchor.kind).x"
        :y="anchorBox(anchor.kind).y"
        :width="anchorBox(anchor.kind).w"
        :height="anchorBox(anchor.kind).h"
        :opacity="anchor.lit ? 0.95 : 0.5"
        :style="anchor.kind === 'external' ? { filter: `drop-shadow(0 0 0.02px ${ANCHOR_EXTERNAL_TINT})` } : undefined"
        preserveAspectRatio="xMidYMid meet"
      />
    </g>

    <g class="tiles">
      <g
        v-for="tile in props.board.tiles"
        :key="tile.id"
        :data-tile-id="tile.id"
        :transform="at(tile.cell)"
        :class="['tile', props.states?.get(tile.id) ?? '']"
      >
        <path
          :d="TILE_HEX"
          :fill="tileFill(tile.color)"
        />
        <image
          :href="symbolFor(tile.value)"
          :x="symbolBox(tile.value).x"
          :y="symbolBox(tile.value).y"
          :width="symbolBox(tile.value).size"
          :height="symbolBox(tile.value).size"
          preserveAspectRatio="xMidYMid meet"
        />
        <!--
          A hairline, so the ring stays the same weight however small the tiles get. On a 36-plate
          board this is what carries the reveal when a tile is barely a dozen pixels across.
        -->
        <path
          class="ring"
          :d="TILE_HEX"
          fill="none"
          stroke="#8fe6c0"
          stroke-width="3"
          vector-effect="non-scaling-stroke"
        />
        <!-- One pip per time this tile has scored. Two pips is the visible answer to "why is the total higher than the tiles I counted?" -->
        <circle
          v-for="pip in (props.counts?.get(tile.id) ?? 0) > 1 ? (props.counts?.get(tile.id) ?? 0) : 0"
          :key="pip"
          class="pip"
          :cx="hexApothem(TILE_SIZE) * 0.44 + (pip - 1) * HEX_SIZE * 0.2"
          :cy="-TILE_SIZE * 0.52"
          :r="HEX_SIZE * 0.08"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.diagram {
  display: block;
  width: 100%;
  height: 100%;
}

/* The default state is plain: a board nobody is counting yet reads normally. */
.tile {
  transition: opacity 180ms ease;
}

.tile .ring {
  opacity: 0;
  transition: opacity 140ms ease;
}

/* Being counted right now. */
.tile.active .ring {
  opacity: 1;
}

/*
 * Not part of the pass being counted. Dimmed rather than hidden — the board has to stay readable as a
 * board, and a tile that vanished during the green pass would look like it had been taken.
 */
.tile.muted {
  opacity: 0.28;
}

.pip {
  fill: #e8c878;
  stroke: #1a1c22;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

@media (prefers-reduced-motion: reduce) {
  .tile,
  .tile .ring {
    transition: none;
  }
}
</style>
