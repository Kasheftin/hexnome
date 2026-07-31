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
import { createBag } from '@/game/bag'
import { createDeck, dealStartingPlates, type DealtPlate } from '@/game/deck'
import {
  canConfirmDraft,
  completedStrategies,
  draftAttribute,
  draftFits,
  draftStates as draftStatesOf,
  toggleDraftSelection,
  type DraftItem,
} from '@/game/draft'
import { hexRectangle } from '@/game/hex'
import {
  canConfirmPayment,
  paymentCost,
  paymentStates as paymentStatesOf,
  togglePayment,
  type Payer,
  type PaymentTarget,
} from '@/game/payment'
import { platesToReveal, pushLot, shouldRefill } from '@/game/source'
import { createTableau, type PlateLocation, type TileLocation } from '@/game/tableau'
import { DEFAULT_PLACEMENT_RULE } from '@/game/placement'
import {
  FIRST_TURN,
  IDLE,
  INFER_ACTIONS_FROM_GESTURES,
  nextTurn,
  turnOptions,
  type TurnAction,
  type TurnPhase,
} from '@/game/turn'
import type { Axial } from '@/game/hex'
import BoardCamera from '@/scene/BoardCamera.vue'
import CellHighlight from '@/scene/CellHighlight.vue'
import DrawerChrome from '@/scene/DrawerChrome.vue'
import HexGridFloor from '@/scene/HexGridFloor.vue'
import SourceChrome from '@/scene/SourceChrome.vue'
import TileEnvironment from '@/scene/TileEnvironment.vue'
import TableauView from '@/scene/TableauView.vue'
import ActionBar from '@/ui/ActionBar.vue'
import TurnAnnounce from '@/ui/TurnAnnounce.vue'
import {
  BOARD_HALF_COLS,
  BOARD_HALF_ROWS,
  COLORS,
  DRAWER_COLS,
  DRAWER_ROWS,
  PLATE_SLOTS,
  SOURCE_TILES_PER_LOT,
} from '@/scene/constants'
import { createDrawerLayout } from '@/scene/drawerLayout'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_STEM_COUNT,
  modeInfo,
  roundsOf,
  type GameSettings,
} from '@/game/gameSettings'
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
  if (!settings.value) {
    void router.replace('/')
    return
  }
  /*
   * The first turn is announced like any other. Its lot is dealt just before the card rather than behind
   * it — see `cardWork`. The board's starting plate and the player's stems are part of neither: they are
   * the tableau, not a deal.
   */
  beginTurn()
  announceTurn(count.value.turn)
})

/**
 * A rectangular playfield of 1661 cells (~41 × 41). Panning is clamped so its edge is
 * unreachable, which is what makes it read as endless.
 */
const cells = hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS)
const DRAWER_SLOTS = DRAWER_COLS * DRAWER_ROWS

/** Where the player's tableau starts. The board is a rectangle centred here. */
const BOARD_CENTRE = { q: 0, r: 0 } as const

/**
 * One source slot per plate the round deals.
 *
 * These are the same number by design rather than by coincidence: lots never leave the source, so the
 * column is exactly full when the round's plates run out and nothing can be pushed off the bottom
 * (game/source.ts).
 */
const platesPerRound = settings.value?.platesPerRound ?? DEFAULT_PLATES_PER_ROUND

const tableau = createTableau({
  cells,
  drawerSlots: DRAWER_SLOTS,
  plateSlots: PLATE_SLOTS,
  sourceLots: platesPerRound,
  sourceTilesPerLot: SOURCE_TILES_PER_LOT,
  placementRule: settings.value?.placementRule ?? DEFAULT_PLACEMENT_RULE,
})

/**
 * The bags this game's id seeds, and how far into them play has got.
 *
 * The *order* is a frozen contract derived from the id (game/deck.ts); the cursor is ordinary play state
 * that resets with the board. A restock draws one plate and a full heap of tiles off the top of each.
 */
const deck = createDeck(gameId.value)

/**
 * Each player's opening plate comes out of the bag before anything else.
 *
 * The dealer reads the shuffled bag in draw order and takes the first value-1 plate for the first
 * player, the next for the second, and so on (game/deck.ts). They are **removed**, so they can never
 * appear in the shared source — they are already on a board.
 *
 * One player for now. The seat count is capped at six by arithmetic rather than by policy: there is one
 * plate per (colour, value) pair, so exactly six carry value 1.
 */
const PLAYERS = 1
const opening = dealStartingPlates(deck.plates, PLAYERS)

const plateBag = createBag(opening.remaining)
const tileBag = createBag(deck.tiles)

/** Plates dealt into the source this round. The round is over as a supply once this reaches its quota. */
const platesDealt = shallowRef(0)

/**
 * The token each face-down plate is carrying, held outside the tableau.
 *
 * The model deliberately does not store it — see `Plate.faceDown` — so this is where it waits until the
 * plate turns over. In multiplayer this is the server's job; keeping it here rather than in the model
 * means moving it there later changes one file, not the shape of the game state.
 */
const dealtTokens = new Map<string, DealtPlate>()

/**
 * Push a fresh lot onto the top of the source, drawing from the bags.
 *
 * The opening deal and every later restock both come through here, so the first lot cannot drift from
 * the rest. Draws the plate first and checks it: with no plate there is no lot, and dealing the tiles
 * anyway would leave a heap floating over an empty slot.
 */
function dealLot(): boolean {
  const dealt = plateBag.take(1)[0]
  if (!dealt) return false
  if (!pushLot(tableau, tileBag.take(tableau.sourceTilesPerLot))) return false

  // pushLot puts the new plate at the top of the stack; remember what it is carrying until it flips.
  const plate = tableau.plateInSourceLot(0)
  if (plate) dealtTokens.set(plate.id, dealt)
  platesDealt.value++
  return true
}

/**
 * The opening position: one plate at the centre of the board, the player's stems in the drawer, and one
 * lot in the source.
 *
 * **The starting plate goes straight to the board.** It is where the player's tableau grows from — every
 * later plate has to connect to it, and every drafted tile needs an empty petal to sit in, so without it
 * the board is unplayable and *Put* has nowhere to go.
 *
 * **Stems take ordinary tile slots**, so they are a cost as well as a gift: three stems is three fewer
 * places to put a drafted tile until they are spent. `freeDrawerSlots` counts them as taken without
 * knowing what they are, so the drawer's capacity rules need no special case.
 *
 * Everything here happens once, before the first turn.
 */
{
  const start = opening.starting[0]
  const centre = tableau.addPlate({ kind: 'board', hole: BOARD_CENTRE })
  if (start && centre) {
    // `fixed`: the plate's own tile, part of the plate and never separable from it.
    tableau.addTile(
      { color: start.color, value: start.value },
      { kind: 'onPlate', plateId: centre.id, petal: start.petal },
      { fixed: true },
    )
  }

  const stems = settings.value?.initialStems ?? DEFAULT_STEM_COUNT
  for (let i = 0; i < stems; i++) {
    const slot = tableau.freeDrawerSlots()[0]
    if (slot === undefined) break
    tableau.addStem(slot)
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

/**
 * Which round, and which turn of it.
 *
 * The round is stuck on 1: advancing it needs the round structure — when a round ends, what refills,
 * what resets — none of which is designed. `nextRound` exists in game/turn.ts and already resets the
 * turn count, so wiring it up is one call, not a decision.
 */
const count = shallowRef(FIRST_TURN)

/** Rounds the chosen mode plays, so the header can read "1 / 4" rather than a bare number. */
const totalRounds = computed(() => {
  const s = settings.value
  return s ? roundsOf(s.mode) : 0
})

/**
 * Everything in the shared source that can be drafted: the loose tiles, plus any **revealed** plate,
 * which enters as its own token.
 *
 * Face-down plates are absent on purpose. Their token is unknown, and an unknown cannot be matched
 * against a colour or a symbol — so they are not draftable until the lot they sit under is picked clean
 * and they turn over.
 */
const sourceItems = computed<DraftItem[]>(() => {
  void revision.value
  const items: DraftItem[] = tableau.tiles()
    .filter(tile => tile.location.kind === 'source')
    .map(tile => ({ id: tile.id, kind: 'tile' as const, color: tile.color, value: tile.value }))

  for (let lot = 0; lot < tableau.sourceLots; lot++) {
    const plate = tableau.plateInSourceLot(lot)
    if (!plate || plate.faceDown) continue
    const token = tableau.plateToken(plate.id)
    if (token) {
      items.push({ id: plate.id, kind: 'plate', color: token.color, value: token.value })
    }
  }
  return items
})

const freeSlots = computed(() => {
  void revision.value
  return tableau.freeDrawerSlots()
})

const freeBays = computed(() => {
  void revision.value
  return tableau.freePlateSlots()
})

const options = computed(() => turnOptions({
  sourceTiles: sourceItems.value.filter(item => item.kind === 'tile').length,
  sourcePlates: sourceItems.value.filter(item => item.kind === 'plate').length,
  drawerItems: counts.value.drawer + counts.value.platesHeld,
  freeDrawerSlots: freeSlots.value.length,
  freePlateSlots: freeBays.value.length,
}))

const selectedIds = computed(() => phase.value.kind === 'taking' ? phase.value.selected : [])

/**
 * Non-null whenever the source may be **touched** — while drafting, and while idle with a draft still
 * open to the player. Null otherwise, which is what tells the scene the source is inert.
 *
 * Covering the idle case here is what makes drafting self-starting: the scene reports the click either
 * way, and `onSelectTile` turns the first one into the action.
 */
/**
 * Is the turn in a state where a gesture may name its own action? Governed by
 * {@link INFER_ACTIONS_FROM_GESTURES}, so turning that off restores choose-then-act everywhere at once.
 */
const inferring = computed(() =>
  INFER_ACTIONS_FROM_GESTURES && phase.value.kind === 'idle' && announcing.value === null)

const canStartTake = computed(() => inferring.value && options.value.take)
const canStartPut = computed(() => inferring.value && options.value.put)

const draftStates = computed(() => phase.value.kind === 'taking' || canStartTake.value
  ? draftStatesOf(sourceItems.value, selectedIds.value)
  : null)

/** The selected items in click order, for the bar to display. */
const selection = computed(() => {
  const byId = new Map(sourceItems.value.map(item => [item.id, item]))
  return selectedIds.value.flatMap(id => {
    const item = byId.get(id)
    return item ? [{ color: item.color, value: item.value, plate: item.kind === 'plate' }] : []
  })
})

/**
 * Does the selection fit? Tiles and plates are counted against their own homes.
 *
 * A sweep can drag a plate along with the tiles, so "the drawer has four free slots" is not the
 * question — a draft of three tiles and a plate needs three tile slots *and* a bay.
 */
const fits = computed(() => draftFits(sourceItems.value, selectedIds.value, {
  tiles: freeSlots.value.length,
  plates: freeBays.value.length,
}))

/**
 * A legal sweep *and* somewhere to put it.
 *
 * Kept separate from {@link fits} so the bar can say *why* it is refusing: an incomplete sweep and a
 * sweep that will not fit are different problems and deserve different words.
 */
const canConfirm = computed(() =>
  canConfirmDraft(sourceItems.value, selectedIds.value) && fits.value)

const draftAttr = computed(() => draftAttribute(sourceItems.value, selectedIds.value))

/** Which sweeps are finished — what the bar names, and what makes Take legal. */
const completed = computed(() => completedStrategies(sourceItems.value, selectedIds.value))

/**
 * In singleplayer it is always your turn, so this is a status line. Multiplayer will put
 * "Player 2's turn" here and hide the actions.
 */
const turnLabel = computed(() => 'Your turn')

function chooseAction(action: TurnAction): void {
  if (action === 'take') phase.value = { kind: 'taking', selected: [], inferred: false }
  else if (action === 'put') phase.value = { kind: 'putting' }
  else endTurn()
}

/** Back to the action list, with any part-built selection discarded. */
function cancelAction(): void {
  if (phase.value.kind === 'paying') {
    cancelPayment()
    return
  }
  phase.value = IDLE
}

/**
 * End the turn.
 *
 * Singleplayer, so the same player goes again and this is just a return to the action list. Advancing
 * to another player — and to the next round — waits on the round structure.
 *
 * Every completed action lands here, a pass included, which is what makes this the one place the turn
 * count advances. Cancelling deliberately does not: an abandoned action was not a turn.
 */
/* ── the turn card ────────────────────────────────────────────────────────────── */

/**
 * How long the card holds once it has actually arrived.
 *
 * The only duration left in JavaScript. Entering and leaving are timed by CSS in TurnAnnounce.vue and
 * reported back as events, so nothing here has to guess how long an animation took — which matters most
 * on the first turn, when the scene is starting up behind the card and animations run late while timers
 * do not.
 */
const CARD_HOLD_MS = 620

/**
 * Slightly longer than the leave transition in TurnAnnounce.vue, so the bar returns to a clear screen.
 *
 * A timer rather than the `after-leave` event, which sounds like the more honest signal and is not.
 * Vue falls back to a duration-derived timer when `transitionend` does not arrive, and measured on the
 * page's frame clock that fallback fired while the card was still fully opaque — the bar came back on
 * top of it. Anchoring the *start* of the sequence on `after-enter` is what makes a plain timer safe
 * here: by then the scene work is done and the main thread is free, so the clock and the animation agree.
 */
const CARD_LEAVE_MS = 440

/**
 * A backstop, not a schedule.
 *
 * If a transition event never arrives — element torn down mid-flight, a browser that skips the
 * animation entirely — the sequence would stall with the bar hidden and the turn unplayable. This ends
 * it regardless. Generously long, because reaching it at all means something unexpected happened.
 */
const CARD_SAFETY_MS = 4000

/** The turn the card is announcing, or null while play is live. */
const announcing = shallowRef<number | null>(null)
/** Flipped false to start the exit; `announcing` clears when the exit reports itself finished. */
const cardVisible = shallowRef(false)

let cardTimers: ReturnType<typeof setTimeout>[] = []

function clearCardTimers(): void {
  for (const timer of cardTimers) clearTimeout(timer)
  cardTimers = []
}

function finishAnnouncement(): void {
  clearCardTimers()
  cardWork = null
  cardVisible.value = false
  announcing.value = null
}

/**
 * Work to run once the card is up, if any. Cleared as soon as it runs, so it cannot run twice.
 *
 * A field rather than a parameter of `onCardShown` because the card decides *when*, and only the caller
 * knows *what* — and one caller has nothing for it to do. The opening turn deals its lot before
 * announcing rather than behind the card: the first deal is much the heaviest (a plate, four tiles and
 * their textures, all cold) and its jank outlasted the hold, so the card was still fading out when the
 * bar came back. Doing it first costs nothing visible — the scene eases pieces into place, so they still
 * arrive while the card is fading in — and leaves the card's whole life on an unblocked main thread.
 */
let cardWork: (() => void) | null = null

/** Announce a turn, optionally restocking behind the card once it is up. */
function announceTurn(turn: number, work?: () => void): void {
  clearCardTimers()
  cardWork = work ?? null
  announcing.value = turn
  cardVisible.value = true
  cardTimers.push(setTimeout(finishAnnouncement, CARD_SAFETY_MS))
}

/**
 * The card is fully up. Restock behind it, then start the hold.
 *
 * Restocking here rather than on a timer is what makes the new lot *arrive* on screen instead of having
 * always been there: the card is opaque, the plate and its tiles appear underneath it, and the card
 * then leaves to reveal them.
 */
function onCardShown(): void {
  cardWork?.()
  cardWork = null
  cardTimers.push(setTimeout(() => { cardVisible.value = false }, CARD_HOLD_MS))
  cardTimers.push(setTimeout(finishAnnouncement, CARD_HOLD_MS + CARD_LEAVE_MS))
}

onBeforeUnmount(clearCardTimers)

function endTurn(): void {
  revealEmptiedLots()
  count.value = nextTurn(count.value)
  phase.value = IDLE
  announceTurn(count.value.turn, beginTurn)
}

/**
 * Turn over any plate whose lot has been picked clean.
 *
 * The token comes from `dealtTokens`, not from the model — a face-down plate genuinely has no token in
 * the tableau, which is what stops anything reading one before it is turned over. This map is the local
 * stand-in for the server that will hand out reveals in multiplayer.
 */
function revealEmptiedLots(): void {
  let revealed = false
  for (const plate of platesToReveal(tableau)) {
    const dealt = dealtTokens.get(plate.id)
    if (!dealt) continue
    if (tableau.revealPlate(plate.id, { color: dealt.color, value: dealt.value }, dealt.petal)) {
      dealtTokens.delete(plate.id)
      revealed = true
    }
  }
  if (revealed) revision.value++
}

/**
 * The start of a turn: restock the source if its newest lot has been drafted from.
 *
 * `shouldRefill` owns the conditions — newest lot touched, round has a plate left, room to shift into.
 * Once the round's plates are gone the source only shrinks, which is what makes a round finite.
 */
function beginTurn(): void {
  if (!shouldRefill(tableau, { platesDealt: platesDealt.value, platesPerRound })) return
  if (dealLot()) revision.value++
}

/**
 * A source item was clicked.
 *
 * From `idle` this *is* the choice to draft — the player has said what they are doing by doing it, so
 * the phase follows the gesture rather than the other way round. Nothing is committed: the click only
 * selects, and Take is still a separate press.
 */
function onSelectTile(id: string): void {
  const current = phase.value
  const taking = current.kind === 'taking'
  if (!taking && !canStartTake.value) return

  const inferred = taking ? current.inferred : true
  const selected = toggleDraftSelection(sourceItems.value, taking ? current.selected : [], id)

  /*
   * Unclicking the last tile of an inferred draft ends it.
   *
   * The click was the only thing that said "I am drafting", so taking it back should leave nothing
   * behind — otherwise the player is stranded in a mode they never asked for and has to find Cancel to
   * escape a state they thought they had already undone. An explicitly chosen draft is left alone.
   */
  phase.value = selected.length === 0 && inferred
    ? IDLE
    : { kind: 'taking', selected, inferred }
}

function confirmTake(): void {
  if (!canConfirm.value) return
  const slots = [...freeSlots.value]
  const bays = [...freeBays.value]

  for (const id of selectedIds.value) {
    // A selected id is either a loose tile or a revealed plate; the plate carries its token with it.
    if (tableau.plate(id)) {
      const bay = bays.shift()
      if (bay !== undefined) tableau.movePlate(id, { kind: 'plateSlot', slot: bay })
    } else {
      const slot = slots.shift()
      if (slot !== undefined) tableau.moveTile(id, { kind: 'drawer', slot })
    }
  }
  revision.value++
  endTurn()
}

/**
 * Something reached the board: the placement is made, but not yet bought.
 *
 * The item stays where it landed so the player can see what they are paying for, and `origin` is kept
 * so Cancel can put it back exactly. The turn does not end here — it ends when the price is paid.
 */
function onPlaced(
  item: { kind: 'tile' | 'plate', id: string },
  origin: TileLocation | PlateLocation,
): void {
  /*
   * Straight from `idle` too: dragging out of the drawer onto the board is the choice to place, and the
   * scene only reports it once the item has actually landed there.
   *
   * Guarded on `inferring` rather than `canStartPut`, and the difference matters. By the time this
   * runs the item has *already left the drawer*, so `options.put` may have just gone false — if that
   * were the test, placing your last drawer item would be refused here and the tile would be stranded
   * on the board with no payment to settle.
   */
  if (phase.value.kind !== 'putting' && !inferring.value) return
  phase.value = { kind: 'paying', item, origin, selected: [] }
}

/* ── paying for a placement ───────────────────────────────────────────────────── */

/** What is being placed, described by colour and value — a plate by its own token. */
const payTarget = computed<PaymentTarget | null>(() => {
  void revision.value
  const p = phase.value
  if (p.kind !== 'paying') return null
  const spec = p.item.kind === 'tile' ? tableau.tile(p.item.id) : tableau.plateToken(p.item.id)
  return spec ? { color: spec.color, value: spec.value } : null
})

/**
 * Everything in the drawer that could pay: loose tiles, plates in bays, and stems.
 *
 * A plate offers itself rather than its token, because spending it spends the whole plate — the same
 * reason a plate drafts as one object.
 */
const purse = computed<Payer[]>(() => {
  void revision.value
  const out: Payer[] = tableau.tiles()
    .filter(tile => tile.location.kind === 'drawer')
    .map(tile => ({ id: tile.id, kind: 'tile' as const, color: tile.color, value: tile.value }))

  for (const plate of tableau.plates()) {
    if (plate.location.kind !== 'plateSlot') continue
    const token = tableau.plateToken(plate.id)
    if (token) out.push({ id: plate.id, kind: 'plate', color: token.color, value: token.value })
  }
  for (const stem of tableau.stems()) out.push({ id: stem.id, kind: 'stem' })
  return out
})

const paySelected = computed(() => phase.value.kind === 'paying' ? phase.value.selected : [])

/** Null unless paying, which is what tells the scene to stop marking the drawer. */
const payStates = computed(() => {
  const target = payTarget.value
  return target ? paymentStatesOf(target, purse.value, paySelected.value) : null
})

const payCost = computed(() => payTarget.value ? paymentCost(payTarget.value) : 0)

const canApply = computed(() => {
  const target = payTarget.value
  return target !== null && canConfirmPayment(target, purse.value, paySelected.value)
})

/** The payers picked so far, for the bar to show. Stems have no face, so they show as such. */
const paySelection = computed(() => {
  const byId = new Map(purse.value.map(payer => [payer.id, payer]))
  return paySelected.value.flatMap(id => {
    const payer = byId.get(id)
    if (!payer) return []
    return [{
      color: payer.color ?? 0,
      value: payer.value ?? 0,
      plate: payer.kind === 'plate',
      stem: payer.kind === 'stem',
    }]
  })
})

function onSelectPayment(id: string): void {
  const current = phase.value
  const target = payTarget.value
  if (current.kind !== 'paying' || !target) return
  phase.value = {
    ...current,
    selected: togglePayment(target, purse.value, current.selected, id),
  }
}

/**
 * Pay up and end the turn.
 *
 * Spent items are **destroyed**, not moved: they leave the game rather than going anywhere, which is
 * what discarding means. Plates and stems go with the tiles.
 */
function applyPayment(): void {
  const current = phase.value
  if (current.kind !== 'paying' || !canApply.value) return
  for (const id of current.selected) tableau.discard(id)
  revision.value++
  endTurn()
}

/**
 * Undo the placement entirely.
 *
 * The item goes back exactly where it came from and nothing is spent, so an abandoned placement costs
 * the player nothing — including their turn, since `endTurn` is not called.
 */
function cancelPayment(): void {
  const current = phase.value
  if (current.kind !== 'paying') return
  if (current.item.kind === 'tile') {
    tableau.moveTile(current.item.id, current.origin as TileLocation)
  } else {
    tableau.movePlate(current.item.id, current.origin as PlateLocation)
  }
  revision.value++
  phase.value = IDLE
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
      <SourceChrome
        :lots="platesPerRound"
        :live="phase.kind === 'taking' || canStartTake"
      />
      <DrawerChrome
        :target-slot="targetTileSlot"
        :target-plate-slot="targetPlateSlot"
        :target-valid="targetValid"
        :live="phase.kind === 'putting' || phase.kind === 'paying'"
      />
      <TableauView
        :tableau="tableau"
        :game-id="gameId"
        :may-place="phase.kind === 'putting' || canStartPut"
        :may-move-placed="phase.kind === 'putting'"
        :draft-states="draftStates"
        :pay-states="payStates"
        :revision="revision"
        @select-payment="onSelectPayment"
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

    <Transition name="bar">
      <ActionBar
        v-if="announcing === null"
        :phase="phase"
        :options="options"
        :selection="selection"
        :can-confirm="canConfirm"
        :fits="fits"
        :pay-cost="payCost"
        :pay-selection="paySelection"
        :can-apply="canApply"
        :attribute="draftAttr"
        :completed="completed"
        :anchor-x="drawerLayout.left + drawerLayout.width / 2"
        :anchor-y="drawerLayout.top"
        :turn-label="turnLabel"
        @choose="chooseAction"
        @confirm="confirmTake"
        @apply="applyPayment"
        @cancel="cancelAction"
      />
    </Transition>

    <TurnAnnounce
      :turn="announcing"
      :visible="cardVisible"
      @shown="onCardShown"
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
      <dl class="counters">
        <dt>Round</dt>
        <dd>
          {{ count.round }}<span
            v-if="totalRounds"
            class="of"
          > / {{ totalRounds }}</span>
        </dd>
        <dt>Turn</dt>
        <dd>{{ count.turn }}</dd>
      </dl>
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
/*
 * The action bar fades in when a turn becomes the player's.
 *
 * Also insurance. The bar returns on a timer, and at page load the browser is still compiling shaders
 * and decoding textures, which can stall the turn card's exit animation past the moment the timer
 * expects it to have finished — measured, roughly 300ms of it. A hard swap would show the bar popping in
 * over a card still visibly fading; a crossfade of the same two things looks deliberate. Mid-game, where
 * the thread is free and the two do not overlap at all, this is simply a soft arrival.
 */
.bar-enter-active {
  transition: opacity 240ms ease-out;
}

.bar-enter-from {
  opacity: 0;
}

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

/*
 * Live figures, so they get the label-over-value treatment the help panel's readouts use rather than
 * being folded into the settings line beside them. That line is fixed for the whole game; these move.
 */
.counters {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0;
  padding-left: 14px;
  border-left: 1px solid #3a3222;
}

.counters dt {
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.counters dd {
  margin: 0 6px 0 0;
  color: #e8c878;
  font-size: 12px;
  /* Tabular, so the header does not shift as the turn ticks past 9. */
  font-variant-numeric: tabular-nums;
}

.counters .of {
  color: #6b7382;
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
