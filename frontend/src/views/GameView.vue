<script setup lang="ts">
/**
 * The game.
 *
 * The board is deliberately quiet — a procedural honeycomb on dark slate, no more. It only
 * ever says *where a plate may go*, so it should not compete with the plates. The colour
 * lives on the plates instead, where the actual decisions happen.
 *
 * A rectangular board that scrolls, and a floating 16-slot drawer at the bottom.
 * Tiles move freely between the two — reorder inside the drawer, play out onto the board,
 * pull back into the drawer — under one rule: nothing may sit on top of anything, anywhere.
 *
 * The header and help panel are DOM over the canvas. The *drawer* is not: its slots hold
 * live 3D tiles, and DOM sits above the canvas, so an opaque DOM drawer would cover its
 * own contents (docs/tech-spec.md, "UI chrome").
 *
 * Reached as `/game?id=…`. The id names a game whose settings were stored when it started, so a
 * refresh comes back as the same *kind* of game — singleplayer, classic, four plates a round —
 * rather than as a guess. The board itself still restarts; only the settings persist so far.
 *
 * An id that is missing or unreadable means there is no game to show, so the menu is the honest
 * destination. Settings are not yet wired into setup: rounds and drafting do not exist, and
 * `platesPerRound` is a round-supply figure, not the drawer's bay count, so binding it to
 * PLATE_SLOTS would be conflating two different numbers.
 */
import { mdiArrowDownLeftBold, mdiArrowDownRightBold } from '@mdi/js'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3 } from 'three'
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createDeck } from '@/game/deck'
import {
  canConfirmDraft,
  draftAttribute,
  draftStates as draftStatesOf,
  toggleDraftSelection,
  type DraftTile,
} from '@/game/draft'
import { hexRectangle } from '@/game/hex'
import { createTableau, type TileSpec } from '@/game/tableau'
import { IDLE, turnOptions, type TurnAction, type TurnPhase } from '@/game/turn'
import type { Axial } from '@/game/hex'
import BoardCamera from '@/scene/BoardCamera.vue'
import CellHighlight from '@/scene/CellHighlight.vue'
import DrawerChrome from '@/scene/DrawerChrome.vue'
import HexGridFloor from '@/scene/HexGridFloor.vue'
import SourceChrome from '@/scene/SourceChrome.vue'
import TileEnvironment from '@/scene/TileEnvironment.vue'
import TableauView from '@/scene/TableauView.vue'
import ActionBar from '@/ui/ActionBar.vue'
import {
  BOARD_HALF_COLS,
  BOARD_HALF_ROWS,
  COLORS,
  DRAWER_COLS,
  DRAWER_ROWS,
  PLATE_SLOTS,
  SOURCE_LOTS,
  SOURCE_TILES_PER_LOT,
} from '@/scene/constants'
import { createDrawerLayout } from '@/scene/drawerLayout'
import { modeInfo, type GameSettings } from '@/game/gameSettings'
import { useSavedGames } from '@/composables/useSavedGames'

const route = useRoute()
const router = useRouter()
const savedGames = useSavedGames()

const gameId = computed(() => {
  const id = route.query.id
  return typeof id === 'string' ? id : ''
})

/** Restored from storage on every load, including a refresh. */
const settings = shallowRef<GameSettings | null>(savedGames.get(gameId.value))

const modeLabel = computed(() => {
  const s = settings.value
  return s ? modeInfo(s.mode)?.label ?? s.mode : ''
})

onMounted(() => {
  // No id, or one we cannot read: there is no game here, so send them somewhere that works.
  if (!settings.value) void router.replace('/')
})

/**
 * A rectangular playfield of 1661 cells (~41 × 41). Panning is clamped so its edge is
 * unreachable, which is what makes it read as endless.
 */
const cells = hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS)
const DRAWER_SLOTS = DRAWER_COLS * DRAWER_ROWS

const tableau = createTableau({
  cells,
  drawerSlots: DRAWER_SLOTS,
  plateSlots: PLATE_SLOTS,
  sourceLots: SOURCE_LOTS,
  sourceTilesPerLot: SOURCE_TILES_PER_LOT,
})

/**
 * The opening deal: fill the shared source, and leave the drawer empty.
 *
 * **The drawer starts empty on purpose.** A turn is either draft-from-source or place-from-drawer,
 * so with nothing in the drawer the only legal first move is a draft — which is exactly the rule,
 * expressed as a starting position rather than as a check.
 *
 * A lot is one plate dealt **face down**, with four loose tiles heaped on top of it. The plate's own
 * tile is not created at all while it is face down: the model has no hidden state to leak, so
 * nothing can accidentally read it (see `Plate.faceDown`).
 *
 * Everything comes off the top of the bags this id seeds (game/deck.ts), so the same link always
 * opens on the same lot — the same plate under the same four tiles, scattered the same way.
 *
 * Only one lot is filled so far. Filling all six, and refilling them between rounds, waits on the
 * round structure.
 */
const OPENING_LOTS = 1

{
  const deck = createDeck(gameId.value)
  let nextTile = 0

  for (let lot = 0; lot < Math.min(OPENING_LOTS, SOURCE_LOTS); lot++) {
    const dealt = deck.plates[lot]
    if (dealt) tableau.addPlate({ kind: 'source', lot }, { faceDown: true })

    for (let index = 0; index < SOURCE_TILES_PER_LOT; index++) {
      const spec = deck.tiles[nextTile++]
      if (!spec) break
      tableau.addTile(spec, { kind: 'source', lot, index })
    }
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
    // Only the player's own placements; a plate's own tile is part of the plate.
    placed: tiles.filter(t => t.location.kind === 'onPlate' && !t.fixed).length,
    platesOnBoard: plates.filter(p => p.location.kind === 'board').length,
    platesHeld: plates.filter(p => p.location.kind === 'plateSlot').length,
  }
})

/* ── the turn ──────────────────────────────────────────────────────────────────
 *
 * A turn is **one** action: draft from the source, place one item, or pass. The phase lives here
 * rather than in the scene because it governs both the board and the DOM bar, and because the rules
 * that decide what is legal are pure modules (game/turn.ts, game/draft.ts) that neither knows about.
 *
 * Nothing on the table is interactive while idle. That is not a cosmetic choice: a turn is a
 * commitment, and a drag that lands before the player has chosen "Put" would spend their turn for
 * them.
 */
const phase = shallowRef<TurnPhase>(IDLE)

/** Every tile in the shared source, as drafting sees it. */
const sourceTiles = computed<DraftTile[]>(() => {
  void revision.value
  return tableau.tiles()
    .filter(tile => tile.location.kind === 'source')
    .map(tile => ({ id: tile.id, color: tile.color, value: tile.value }))
})

const freeSlots = computed(() => {
  void revision.value
  return tableau.freeDrawerSlots()
})

const options = computed(() => turnOptions({
  sourceTiles: sourceTiles.value.length,
  drawerItems: counts.value.drawer + counts.value.platesHeld,
  freeDrawerSlots: freeSlots.value.length,
}))

const selectedIds = computed(() => phase.value.kind === 'taking' ? phase.value.selected : [])

/** Null unless drafting, which is what tells the scene to stop showing draft states at all. */
const draftStates = computed(() => phase.value.kind === 'taking'
  ? draftStatesOf(sourceTiles.value, selectedIds.value)
  : null)

/** The selected tiles in click order, for the bar to display. */
const selection = computed<TileSpec[]>(() => {
  const byId = new Map(sourceTiles.value.map(tile => [tile.id, tile]))
  return selectedIds.value.flatMap(id => {
    const tile = byId.get(id)
    return tile ? [{ color: tile.color, value: tile.value }] : []
  })
})

/**
 * A legal sweep *and* somewhere to put it.
 *
 * The room check matters: a four-tile draft into three free slots is a valid draft that cannot be
 * carried out, and lighting the button would be promising something we would then have to refuse.
 */
const canConfirm = computed(() => canConfirmDraft(sourceTiles.value, selectedIds.value)
  && selectedIds.value.length <= freeSlots.value.length)

const draftAttr = computed(() => draftAttribute(sourceTiles.value, selectedIds.value))

/**
 * In singleplayer it is always your turn, so this is a status line. Multiplayer will put
 * "Player 2's turn" here and hide the actions.
 */
const turnLabel = computed(() => 'Your turn')

function chooseAction(action: TurnAction): void {
  if (action === 'take') phase.value = { kind: 'taking', selected: [] }
  else if (action === 'put') phase.value = { kind: 'putting' }
  else endTurn()
}

/** Back to the action list, with any part-built selection discarded. */
function cancelAction(): void {
  phase.value = IDLE
}

/**
 * End the turn.
 *
 * Singleplayer, so the same player goes again and this is just a return to the action list. Advancing
 * to another player — and to the next round — waits on the round structure.
 */
function endTurn(): void {
  phase.value = IDLE
}

function onSelectTile(id: string): void {
  const current = phase.value
  if (current.kind !== 'taking') return
  phase.value = {
    kind: 'taking',
    selected: toggleDraftSelection(sourceTiles.value, current.selected, id),
  }
}

function confirmTake(): void {
  if (!canConfirm.value) return
  const slots = freeSlots.value
  selectedIds.value.forEach((id, i) => {
    const slot = slots[i]
    if (slot !== undefined) tableau.moveTile(id, { kind: 'drawer', slot })
  })
  revision.value++
  endTurn()
}

/** A `put` turn is spent the moment something reaches the board. */
function onPlaced(): void {
  if (phase.value.kind === 'putting') endTurn()
}

function onTarget(cells: Axial[], valid: boolean): void {
  targetCells.value = cells
  targetValid.value = valid
}

function onDrawerTarget(tileSlot: number | null, plateSlot: number | null, valid: boolean): void {
  targetTileSlot.value = tileSlot
  targetPlateSlot.value = plateSlot
  targetValid.value = valid
}

/* ── rotate buttons ──────────────────────────────────────────────────────────────
 *
 * Real DOM <button>s over the canvas, not 3D meshes: they get focus, keyboard
 * activation and hover states for free, and stay crisp at any zoom.
 *
 * The drawer's layout is a pure function of the canvas size, and <TresCanvas
 * window-size> makes the canvas exactly the viewport — so the same function that
 * positions the 3D bays positions these buttons, and they cannot drift apart.
 */
const viewport = shallowRef({ w: window.innerWidth, h: window.innerHeight })
function onResize(): void {
  viewport.value = { w: window.innerWidth, h: window.innerHeight }
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const drawerLayout = computed(() => createDrawerLayout(viewport.value.w, viewport.value.h))

/** Bay whose plate is hovered in the 3D scene. */
const hoveredPlateSlot = shallowRef<number | null>(null)
/** True while the pointer is over the buttons themselves. */
const overButtons = shallowRef(false)
/** Last bay to be hovered, so the buttons keep a position while the pointer is on them. */
const activePlateSlot = shallowRef<number | null>(null)

function onHoverPlateSlot(slot: number | null): void {
  hoveredPlateSlot.value = slot
  if (slot !== null) activePlateSlot.value = slot
}

/**
 * Moving onto a button leaves the canvas, which ends the 3D hover — so the buttons would
 * vanish the moment you reached for them. They stay while the pointer is on them.
 */
const rotateControls = computed(() => {
  const slot = hoveredPlateSlot.value ?? (overButtons.value ? activePlateSlot.value : null)
  if (slot === null) return null
  const centre = drawerLayout.value.plateSlotCentre(slot)
  const plate = tableau.plates().find(
    p => p.location.kind === 'plateSlot' && p.location.slot === slot,
  )
  if (!plate) return null
  return { slot, plateId: plate.id, x: centre.x, y: centre.y }
})

function rotate(steps: number): void {
  const controls = rotateControls.value
  if (!controls) return
  if (tableau.rotatePlate(controls.plateId, steps)) revision.value++
}

/**
 * Rotation glyphs. `@mdi/js` exports each icon as a bare SVG path string on a 24×24 grid,
 * so they inline as `<path d>` with no icon component and no font — and being named ESM
 * exports, only the two used get bundled.
 *
 * Down-left reads as sweeping counter-clockwise, down-right as clockwise, which matches the
 * side each button sits on.
 */
const ROTATE_ICONS = {
  counterClockwise: mdiArrowDownLeftBold,
  clockwise: mdiArrowDownRightBold,
} as const

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

      <CellHighlight
        :cells="targetCells"
        :valid="targetValid"
      />
      <SourceChrome />
      <DrawerChrome
        :target-slot="targetTileSlot"
        :target-plate-slot="targetPlateSlot"
        :target-valid="targetValid"
      />
      <TableauView
        :tableau="tableau"
        :game-id="gameId"
        :draggable="phase.kind === 'putting'"
        :draft-states="draftStates"
        @select-tile="onSelectTile"
        @placed="onPlaced"
        @target="onTarget"
        @drawer-target="onDrawerTarget"
        @hover-plate-slot="onHoverPlateSlot"
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

    <!--
      Positioned over the plate bay that is hovered. The wrapper ignores pointer events so
      it never steals a drag from the board; only the buttons themselves accept them.
    -->
    <div
      v-if="rotateControls"
      class="rotate-controls"
      :style="{ left: `${rotateControls.x}px`, top: `${rotateControls.y}px` }"
      @pointerenter="overButtons = true"
      @pointerleave="overButtons = false"
    >
      <button
        type="button"
        class="rotate-button left"
        title="Rotate counter-clockwise (Q while dragging)"
        aria-label="Rotate plate counter-clockwise"
        @click="rotate(-1)"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path :d="ROTATE_ICONS.counterClockwise" />
        </svg>
      </button>
      <button
        type="button"
        class="rotate-button right"
        title="Rotate clockwise (E while dragging)"
        aria-label="Rotate plate clockwise"
        @click="rotate(1)"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path :d="ROTATE_ICONS.clockwise" />
        </svg>
      </button>
    </div>

    <ActionBar
      :phase="phase"
      :options="options"
      :selection="selection"
      :can-confirm="canConfirm"
      :attribute="draftAttr"
      :anchor-x="drawerLayout.left + drawerLayout.width / 2"
      :anchor-y="drawerLayout.top"
      :turn-label="turnLabel"
      @choose="chooseAction"
      @confirm="confirmTake"
      @cancel="cancelAction"
    />

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
      <p
        v-if="settings"
        class="game-id"
      >
        {{ modeLabel }} · {{ settings.platesPerRound }} plates/round
      </p>
    </header>

    <aside class="chrome-panel help">
      <dl>
        <dt>Drag a plate out</dt>
        <dd>needs all 7 cells free</dd>
        <dt>Drag a tile</dt>
        <dd>only into an empty petal</dd>
        <dt>Rotate a plate</dt>
        <dd>arrows in the bay · Q / E while dragging</dd>
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

.game-id {
  margin: 0;
  padding-left: 14px;
  border-left: 1px solid #3a3222;
  color: #79808f;
  font-size: 11px;
  letter-spacing: 0.06em;
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

.rotate-controls {
  position: absolute;
  /* Centred on the bay, so the two buttons sit in its empty upper corners. */
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/*
 * Tucked into the bay's empty upper corners, just outboard of the two upper petals.
 *
 * Deliberately still touching the plate rather than floating clear above the drawer: the
 * buttons are shown by hovering the plate, so any gap between plate and button would let
 * the hover lapse while the pointer crossed it, and they would vanish as you reached.
 */
.rotate-button {
  position: absolute;
  top: -57px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #4a3f28;
  border-radius: 50%;
  background: rgb(14 18 22 / 92%);
  color: #e8c878;
  cursor: pointer;
  transition: border-color 120ms, background-color 120ms, transform 120ms;
  pointer-events: auto;
}

.rotate-button svg {
  width: 15px;
  height: 15px;
  /* The glyph inherits the button's colour, so hover restyles both at once. */
  fill: currentcolor;
}

.rotate-button.left {
  left: -71px;
}

.rotate-button.right {
  left: 45px;
}

.rotate-button:hover {
  border-color: #8fe6c0;
  background: rgb(24 34 30 / 96%);
  color: #8fe6c0;
}

.rotate-button:active {
  transform: scale(0.9);
}

.rotate-button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}
</style>
