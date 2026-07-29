<script setup lang="ts">
/**
 * The main game area.
 *
 * A rectangular plated board that scrolls, and a floating 16-slot drawer at the bottom.
 * Tiles move freely between the two — reorder inside the drawer, play out onto the board,
 * pull back into the drawer — under one rule: nothing may sit on top of anything, anywhere.
 *
 * The header and help panel are DOM over the canvas. The *drawer* is not: its slots hold
 * live 3D tiles, and DOM sits above the canvas, so an opaque DOM drawer would cover its
 * own contents (docs/tech-spec.md, "UI chrome").
 */
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3 } from 'three'
import { computed, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { hexRectangle } from '@/game/hex'
import { createTableau } from '@/game/tableau'
import type { Axial } from '@/game/hex'
import BoardCamera from '@/scene/BoardCamera.vue'
import CellHighlight from '@/scene/CellHighlight.vue'
import DrawerChrome from '@/scene/DrawerChrome.vue'
import HexGridFloor from '@/scene/HexGridFloor.vue'
import HexPlates from '@/scene/HexPlates.vue'
import TileEnvironment from '@/scene/TileEnvironment.vue'
import TableauView from '@/scene/TableauView.vue'
import {
  BOARD_HALF_COLS,
  BOARD_HALF_ROWS,
  COLORS,
  DRAWER_COLS,
  DRAWER_ROWS,
  PLATE_SLOTS,
} from '@/scene/constants'
import { TILE_COLORS } from '@/scene/tileMaterials'

/**
 * A rectangular playfield of 1661 cells (~41 × 41). Panning is clamped so its edge is
 * unreachable, which is what makes it read as endless.
 */
const cells = hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS)
const DRAWER_SLOTS = DRAWER_COLS * DRAWER_ROWS

const tableau = createTableau({ cells, drawerSlots: DRAWER_SLOTS, plateSlots: PLATE_SLOTS })

const randomTile = () => ({
  color: Math.floor(Math.random() * TILE_COLORS.length),
  value: 1 + Math.floor(Math.random() * 6),
})

function shuffled(n: number): number[] {
  const out = [...Array(n).keys()]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = out[i] as number
    out[i] = out[j] as number
    out[j] = swap
  }
  return out
}

/** Prefill half the tile slots, and both plate bays. */
{
  for (const slot of shuffled(DRAWER_SLOTS).slice(0, 8)) {
    tableau.addTile(randomTile(), { kind: 'drawer', slot })
  }
  // Each plate arrives with one random petal already filled and the other five empty.
  for (let slot = 0; slot < PLATE_SLOTS; slot++) {
    const plate = tableau.addPlate({ kind: 'plateSlot', slot })
    if (!plate) continue
    tableau.addTile(randomTile(), {
      kind: 'onPlate',
      plateId: plate.id,
      petal: Math.floor(Math.random() * 6),
    })
  }
}

const targetCells = shallowRef<Axial[]>([])
const targetValid = shallowRef(false)
const targetTileSlot = shallowRef<number | null>(null)
const targetPlateSlot = shallowRef<number | null>(null)
/** Bumped on every committed move, so the DOM readouts recompute. */
const revision = shallowRef(0)

const counts = computed(() => {
  void revision.value
  const tiles = tableau.tiles()
  const plates = tableau.plates()
  return {
    drawer: tiles.filter(t => t.location.kind === 'drawer').length,
    placed: tiles.filter(t => t.location.kind === 'onPlate').length,
    platesOnBoard: plates.filter(p => p.location.kind === 'board').length,
    platesHeld: plates.filter(p => p.location.kind === 'plateSlot').length,
  }
})

function onTarget(cells: Axial[], valid: boolean): void {
  targetCells.value = cells
  targetValid.value = valid
}

function onDrawerTarget(tileSlot: number | null, plateSlot: number | null, valid: boolean): void {
  targetTileSlot.value = tileSlot
  targetPlateSlot.value = plateSlot
  targetValid.value = valid
}

/** Key light from the upper left, matching the direction the tile art assumes. */
const KEY_LIGHT_POSITION = new Vector3(-7, 12, 5)
const FILL_LIGHT_POSITION = new Vector3(8, 5, -6)
</script>

<template>
  <div class="stage">
    <TresCanvas
      :clear-color="COLORS.canvasClear"
      :antialias="true"
      :dpr="[1, 2]"
      :tone-mapping="ACESFilmicToneMapping"
      :output-color-space="SRGBColorSpace"
      window-size
    >
      <BoardCamera />
      <TileEnvironment />
      <HexGridFloor />
      <HexPlates :cells="cells" />

      <CellHighlight
        :cells="targetCells"
        :valid="targetValid"
      />
      <DrawerChrome
        :target-slot="targetTileSlot"
        :target-plate-slot="targetPlateSlot"
        :target-valid="targetValid"
      />
      <TableauView
        :tableau="tableau"
        @target="onTarget"
        @drawer-target="onDrawerTarget"
        @changed="revision++"
      />

      <!--
        No ambient light: the environment map already supplies indirect light to the
        tiles, and the board plates are unlit. Strong key so a tile's *diffuse* colour is
        the dominant term.
      -->
      <TresDirectionalLight
        :position="KEY_LIGHT_POSITION"
        :intensity="2"
        :color="'#fff6e2'"
      />
      <TresDirectionalLight
        :position="FILL_LIGHT_POSITION"
        :intensity="0.45"
        :color="'#cfe0ff'"
      />
    </TresCanvas>

    <header class="chrome-panel top">
      <h1 class="chrome-title">
        hexnome
      </h1>
      <RouterLink
        to="/"
        class="back"
      >
        ← menu
      </RouterLink>
    </header>

    <aside class="chrome-panel help">
      <dl>
        <dt>Drag a plate out</dt>
        <dd>needs all 7 cells free</dd>
        <dt>Drag a tile</dt>
        <dd>only into an empty petal</dd>
        <dt>Drag empty board</dt>
        <dd>scroll · wheel zooms</dd>
      </dl>
      <p class="readout">
        <span>tiles in drawer</span>
        <strong>{{ counts.drawer }} / {{ DRAWER_SLOTS }}</strong>
      </p>
      <p class="readout">
        <span>tiles on plates</span>
        <strong>{{ counts.placed }}</strong>
      </p>
      <p class="readout">
        <span>plates</span>
        <strong>{{ counts.platesOnBoard }} placed · {{ counts.platesHeld }} held</strong>
      </p>
    </aside>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.stage :deep(canvas) {
  display: block;
}

.top {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  gap: 18px;
  align-items: baseline;
  padding: 9px 14px;
}

.back {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-decoration: none;
}

.help {
  position: absolute;
  top: 14px;
  right: 14px;
  min-width: 240px;
  padding: 12px 14px;
  font-size: 11px;
}

dl {
  margin: 0;
}

dt {
  color: #e8c878;
  letter-spacing: 0.06em;
}

dd {
  margin: 0 0 8px;
  color: #79808f;
}

.readout {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  margin: 0;
  padding-top: 7px;
  border-top: 1px solid #2a2c33;
  color: #79808f;
  font-variant-numeric: tabular-nums;
}

.readout strong {
  color: #cfd4de;
  font-weight: 500;
}
</style>
