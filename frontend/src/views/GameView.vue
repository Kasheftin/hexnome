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
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createAgenda, roundAgenda, scoreTargets, tallyRound } from '@hexnome/rules/agenda'
import { openingPlateCodes } from '@hexnome/rules/deck'
import { createDesk as createLocalDesk, tileCode, tileFromCode } from '@hexnome/rules/desk'
import { finalTally, NOTHING_LEFT } from '@hexnome/rules/groups'
import {
  canConfirmDraft,
  completedStrategies,
  draftAttribute,
  draftFits,
  draftStates as draftStatesOf,
  toggleDraftSelection,
  type DraftItem,
} from '@hexnome/rules/draft'
import { hexRectangle } from '@hexnome/rules/hex'
import {
  canAffordPlacement,
  canConfirmPayment,
  paymentCost,
  paymentStates as paymentStatesOf,
  togglePayment,
  type Payer,
  type PaymentTarget,
} from '@hexnome/rules/payment'
import {
  applyCommand,
  createGame,
  draftItems,
  needsDeal,
  replayGame,
  type Command,
  type GameOptions,
} from '@hexnome/rules/game'
import { createDesk, rulesHealth, type Desk } from '@/composables/useDesk'
import type { RoundRecord } from '@/ui/roundRecord'
import {
  type PlateLocation,
  type Tableau,
  type TileLocation,
  type TileSpec,
} from '@hexnome/rules/tableau'
import { DEFAULT_PLACEMENT_RULE } from '@hexnome/rules/placement'
import {
  IDLE,
  INFER_ACTIONS_FROM_GESTURES,
  turnOptions,
  type TurnAction,
  type TurnOptions,
  type TurnPhase,
} from '@hexnome/rules/turn'
import type { Axial } from '@hexnome/rules/hex'
import { describeBoard, describeLeftovers, tilesInReadingOrder } from '@/scene/boardDiagram'
import BoardCamera from '@/scene/BoardCamera.vue'
import CellHighlight from '@/scene/CellHighlight.vue'
import DrawerChrome from '@/scene/DrawerChrome.vue'
import ExternalAnchors from '@/scene/ExternalAnchors.vue'
import HexGridFloor from '@/scene/HexGridFloor.vue'
import SourceChrome from '@/scene/SourceChrome.vue'
import TileEnvironment from '@/scene/TileEnvironment.vue'
import TableauView from '@/scene/TableauView.vue'
import ActionBar from '@/ui/ActionBar.vue'
import RoundResults from '@/ui/RoundResults.vue'
import TileChip from '@/ui/TileChip.vue'
import TurnAnnounce from '@/ui/TurnAnnounce.vue'
import {
  BOARD_HALF_COLS,
  BOARD_HALF_ROWS,
  COLORS,
  HEX_SIZE,
  SOURCE_TILES_PER_LOT,
} from '@/scene/constants'
import { createDrawerLayout, type DrawerShape } from '@/scene/drawerLayout'
import {
  DEFAULT_FINE_UNPLACED,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_REWARD_STEMS,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_SINGLEPLAYER_MODE,
  DEFAULT_TILE_COPIES,
  DEFAULT_PLATE_COPIES,
  DEFAULT_TILE_SLOTS,
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  effectiveStrictBonus,
  modeInfo,
  roundsOf,
  type GameSettings,
  defaultGameSettings,
} from '@hexnome/rules/gameSettings'
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

/**
 * What the player is told while the desks are being made, and if they cannot be.
 *
 * The bag is on the server now, so a game genuinely cannot start without it. Saying nothing would
 * leave an empty board with a starting plate on it and no explanation — which reads as a broken game
 * rather than an unreachable one.
 */
const dealing = shallowRef(true)
const deskTrouble = shallowRef<string | null>(null)

function reportDeskTrouble(error: unknown): void {
  deskTrouble.value = error instanceof Error ? error.message : 'The table is not answering.'
}

onMounted(async () => {
  // No id, or one we cannot read: there is no game here, so send them somewhere that works.
  if (!settings.value) {
    void router.replace('/')
    return
  }

  /*
   * Two desks, one per kind, told apart by their seed alone — the service has no idea which is which.
   * The plate desk is told to hold back the opening plates, which are already on the board.
   */
  try {
    const copies = {
      tiles: settings.value.tileCopies ?? DEFAULT_TILE_COPIES,
      plates: settings.value.plateCopies ?? DEFAULT_PLATE_COPIES,
    }
    ;[tileDesk, plateDesk] = await Promise.all([
      createDesk({ seed: `${seed.value}:tiles`, copies: copies.tiles }),
      createDesk({ seed: `${seed.value}:plates`, copies: copies.plates, exclude: opening }),
    ])
  } catch (error) {
    reportDeskTrouble(error)
    return
  } finally {
    dealing.value = false
  }

  void checkRules()

  /*
   * The first turn is announced like any other. Its lot is dealt just before the card rather than behind
   * it — see `cardWork`. The board's starting plate and the player's stems are part of neither: they are
   * the tableau, not a deal.
   */
  await beginTurn()
  announceRound(count.value.round)
})

/**
 * Say so if the server is running rules the browser is not.
 *
 * Vite recompiles `@hexnome/rules` on every edit; the server holds the copy it started with. The
 * symptom of a mismatch is the server refusing something the client just did, which reads exactly
 * like a logic bug and cost a whole debugging session once (docs/backend-attempt1.md). Comparing a
 * fingerprint turns it into a sentence.
 */
async function checkRules(): Promise<void> {
  const health = await rulesHealth()
  if (!health) return
  const mine = createLocalDesk('health-check', { copies: 1 })
  const expected = mine.ok ? mine.value.desk.slice(0, health.fingerprint.length) : []
  if (String(expected) !== String(health.fingerprint)) {
    deskTrouble.value = 'The server is running different rules from this page. Restart the backend.'
  }
}

/**
 * A rectangular playfield of 1661 cells (~41 × 41). Panning is clamped so its edge is
 * unreachable, which is what makes it read as endless.
 */
const cells = hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS)
/**
 * How many seats the drawer has, from the game's settings.
 *
 * One object, handed to the tableau *and* to both things that draw the panel, so the model's idea of
 * how many slots exist and the panel's idea of how wide it is cannot drift apart.
 */
const drawerShape: DrawerShape = {
  tileSlots: settings.value?.tileSlots ?? DEFAULT_TILE_SLOTS,
  plateSlots: settings.value?.plateSlots ?? DEFAULT_PLATE_SLOTS,
}

/**
 * One source slot per plate the round deals.
 *
 * These are the same number by design rather than by coincidence: lots never leave the source, so the
 * column is exactly full when the round's plates run out and nothing can be pushed off the bottom
 * (game/source.ts).
 */
const platesPerRound = settings.value?.platesPerRound ?? DEFAULT_PLATES_PER_ROUND

/**
 * What each round scores for, dealt from the game id.
 *
 * Derived once and never stored: both inputs already survive a reload, and a saved agenda could
 * outlive the code that produced it (game/agenda.ts).
 */
const agenda = createAgenda(gameId.value, settings.value?.mode ?? DEFAULT_SINGLEPLAYER_MODE)

/** Stems paid for enclosing a plate. Fixed for the game, so the tableau can hold it too. */
const stemsPerInternalAnchor =
  settings.value?.stemsPerInternalAnchor ?? DEFAULT_STEMS_PER_INTERNAL_ANCHOR

/** Stems paid for enclosing a bare cell the plates have wrapped. */
const stemsPerExternalAnchor =
  settings.value?.stemsPerExternalAnchor ?? DEFAULT_STEMS_PER_EXTERNAL_ANCHOR

/**
 * Extra stems when the enclosure is strict all the way round.
 *
 * Read through `effectiveStrictBonus` rather than straight off the settings, so the "zero under strict
 * placement" rule holds even for a stored game that predates it or was edited by hand.
 */
const strictEnclosureBonus = settings.value
  ? effectiveStrictBonus(settings.value)
  : DEFAULT_STRICT_ENCLOSURE_BONUS

/**
 * What the desks are dealt from. Stored with the game; the id is not it.
 *
 * A game saved before seeds existed comes back with its id here, which is what it was dealt from —
 * see `composables/useSavedGames.ts`.
 */
const seed = computed(() => settings.value?.seed || gameId.value)

/**
 * Everything the rules need to build a game, in one place.
 *
 * The settings are normalised on the way in — the drawer shape, the placement rule, the strict bonus
 * — so the state is built from what the game will actually run with rather than from whatever is
 * stored. `cells` is a scene decision and comes from here for that reason.
 */
const gameOptions: GameOptions = {
  settings: {
    ...(settings.value ?? defaultGameSettings(0, seed.value)),
    seed: seed.value,
    tileSlots: drawerShape.tileSlots,
    plateSlots: drawerShape.plateSlots,
    platesPerRound,
    placementRule: settings.value?.placementRule ?? DEFAULT_PLACEMENT_RULE,
    stemsPerInternalAnchor,
    stemsPerExternalAnchor,
    strictEnclosureBonus,
  },
  cells,
  sourceTilesPerLot: SOURCE_TILES_PER_LOT,
  agenda,
}

/**
 * The game: one shared source, one board and drawer per seat, and the log it is folded from.
 *
 * Changed only through `commit`, so the log is a complete account of what happened and
 * `replayGame(gameOptions, log)` rebuilds this exactly. That is what makes rolling back a command a
 * server refuses a matter of dropping it and folding again, rather than of writing an inverse for
 * every move.
 */
const log: Command[] = []
const state = createGame(gameOptions)

/**
 * Bumped on every committed move, so the readouts and the scene recompute.
 *
 * The state is plain mutable data — the tableaux are closures over maps — so this is the one signal
 * that anything changed. One counter for the whole game, because a command can touch the source and
 * a board at once.
 */
const revision = shallowRef(0)

/** Whose turn it is, read through `revision` so it follows the state rather than shadowing it. */
const activeIndex = computed(() => {
  void revision.value
  return state.activeSeat
})

/**
 * Which seat's board and drawer are on screen.
 *
 * A player is a **viewport**, not a slice of the truth: everyone holds the same state and differs
 * only in what they are looking at. Null means *follow whoever is playing*, which is what a hot-seat
 * game wants — otherwise every turn would begin with a click that carries no meaning. Clicking a seat
 * in the score panel pins the view there, to see what somebody else is building.
 */
const pinnedSeat = shallowRef<number | null>(null)
const viewedSeat = computed(() => {
  const pinned = pinnedSeat.value
  return pinned !== null && pinned < state.seats.length ? pinned : activeIndex.value
})

/** The seat being looked at, and the column everyone drafts from. */
const board = (): Tableau => (state.seats[viewedSeat.value] ?? state.seats[0]!).tableau
const source = (): Tableau => state.source

/** Watching somebody else's turn: the table is live, but not for you. */
const watching = computed(() => viewedSeat.value !== activeIndex.value)

/** Every seat, for the score panel: who is playing, who has passed, what they have banked. */
const seatRows = computed(() => {
  void revision.value
  return state.seats.map(seat => ({
    seat: seat.seat,
    name: seat.name,
    passed: seat.passed,
    total: seat.banked.reduce((sum, points) => sum + points, 0),
    active: seat.seat === state.activeSeat,
    viewed: seat.seat === viewedSeat.value,
  }))
})

/** Look at a seat, or go back to following the turn. */
function viewSeat(seat: number): void {
  pinnedSeat.value = pinnedSeat.value === seat ? null : seat
}

/**
 * The seats as the results panel wants them, with what each has banked.
 *
 * The panel counts one board at a time, so these are tabs across it — and carrying the totals means
 * the comparison, which is the whole reason to look, needs no clicking.
 */
const seatTabs = computed(() => seatRows.value.map(row => ({
  seat: row.seat,
  name: row.name,
  total: row.total,
  viewed: row.viewed,
})))

/**
 * Show a seat's score, without the toggle the seat list has.
 *
 * Deliberately not `viewSeat`: pressing the tab that is already open would unpin, and the panel would
 * snap to whoever is due to play next — which is not what pressing your own name should do.
 */
function showSeat(seat: number): void {
  pinnedSeat.value = seat
}

/*
 * Changing seat changes every piece on the table, and the scene only rebuilds when `revision` moves.
 * Without this the meshes of the seat you *were* looking at stay on screen: two boards that differ in
 * the model and not on the screen, which is the failure mode this whole design exists to avoid.
 */
watch(viewedSeat, () => { revision.value++ })

/**
 * The codes the plate desk must hold back: the players' opening plates.
 *
 * Chosen from the seed rather than drawn, because finding "the first value-1 plate in the bag" means
 * being able to see the bag. `createGame` puts them on the boards from the same list, so the two
 * cannot disagree about which plates never entered the desk.
 */
const opening = openingPlateCodes(seed.value, gameOptions.settings.players)

/**
 * The two desks, once the server has made them.
 *
 * Null until then, and the game does not start until they exist — there is no local bag any more, so
 * without these there is nothing to deal. `onMounted` builds them; `dealing` and `deskError` are what
 * the player sees in the meantime.
 *
 * They are **not** stored. The board resets on reload, so a returning player starts the game again,
 * and two fresh desks from the same seed deal exactly what they dealt before. Keeping their ids would
 * resume a half-drawn bag against an empty board, which is a different game.
 */
let tileDesk: Desk | null = null
let plateDesk: Desk | null = null

/** A code from the wire, as the model wants it. */
function specOf(code: number): TileSpec {
  const spec = tileFromCode(code)
  if (!spec) throw new Error(`the desk dealt ${code}, which is not a tile`)
  return spec
}

/**
 * The one command whose payload comes from outside: what the desk dealt.
 *
 * Everything else a command needs the state already knows, which is what makes a replay possible. A
 * deal cannot be worked out, so the codes are asked for once and carried, and the fold never asks
 * again.
 *
 * **Room is checked before anything is drawn**, because a drawn tile is gone from the server's desk
 * whether or not it lands anywhere, and nothing on this side could put it back. `needsDeal` is that
 * precondition, and asking it first is the whole guard.
 *
 * A desk with nothing left is the end of the supply rather than a failure: the round simply stops
 * restocking. The server refuses a draw it cannot cover rather than answering short, so the two would
 * otherwise arrive as the same rejection — asking what it last said is left is what tells them apart.
 */
async function dealLot(): Promise<boolean> {
  if (!tileDesk || !plateDesk) return false
  if (!needsDeal(state)) return false
  if (plateDesk.remaining() < 1) return false
  if (tileDesk.remaining() < SOURCE_TILES_PER_LOT) return false

  let plate: TileSpec
  let tiles: TileSpec[]
  try {
    plate = specOf((await plateDesk.draw(1))[0] as number)
    tiles = (await tileDesk.draw(SOURCE_TILES_PER_LOT)).map(specOf)
  } catch (error) {
    reportDeskTrouble(error)
    return false
  }
  return commit({ kind: 'deal', plate, tiles })
}

/**
 * The single way the game changes: apply, append, and settle up with the desks.
 *
 * A refusal is reported rather than thrown. The view and the rules can disagree about what is legal —
 * a stale button, a phase the player has left — and the rules are the ones that are right.
 *
 * Spent and swept material goes back to the pile, which lives on the server. Not awaited: it has
 * already left the board, the desk queues the request behind whatever is in flight, and a slow round
 * trip should not hold up the turn.
 */
function commit(command: Command): boolean {
  const result = applyCommand(state, command)
  if (!result.ok) {
    console.warn(`[hexnome] ${command.kind} refused: ${result.error}`)
    return false
  }
  log.push(command)
  revision.value++

  void tileDesk?.discard(result.toDesk.tiles.map(tileCode)).catch(reportDeskTrouble)
  void plateDesk?.discard(result.toDesk.plates.map(tileCode)).catch(reportDeskTrouble)
  return true
}

const targetCells = shallowRef<Axial[]>([])
const targetValid = shallowRef(false)
const targetTileSlot = shallowRef<number | null>(null)
const targetPlateSlot = shallowRef<number | null>(null)

/**
 * What the current round has earned so far — what would be banked if it ended now.
 *
 * Counts the whole board, `fixed` tiles included, which is why it reads `tilesOnBoard()` rather than
 * the `counts.placed` figure beside it: that one deliberately counts only the player's own placements.
 */
const roundPoints = computed(() => {
  void revision.value
  return scoreTargets(roundAgenda(agenda, count.value.round) ?? [], board().tilesOnBoard())
})

/**
 * What a round has scored: its banked total once it is over, its live total while it is being played,
 * and nothing at all before it starts.
 *
 * An em dash rather than a zero for a round not yet reached — zero is a result, and a round that has
 * not happened has not got one.
 */
function scoreOf(index: number): string {
  const finished = banked.value[index]
  if (finished !== undefined) return String(finished)
  return index + 1 === count.value.round ? String(roundPoints.value) : '—'
}

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
 * Which round, and which turn of it — read off the state rather than counted here.
 *
 * The rules advance both, because they are what a command does. A second counter kept in step by
 * hand is exactly the drift the fold exists to make impossible.
 */
const count = computed(() => {
  void revision.value
  return { round: state.round, turn: state.turn }
})

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
  return draftItems(state)
})

const freeSlots = computed(() => {
  void revision.value
  return board().freeDrawerSlots()
})

const freeBays = computed(() => {
  void revision.value
  return board().freePlateSlots()
})

/**
 * What the bar may offer.
 *
 * Everything closes while watching another seat. The rules would refuse the command anyway — a turn
 * belongs to one seat — but a live button that is answered with a refusal is a worse way to say so.
 */
const options = computed<TurnOptions>(() => watching.value
  ? { take: false, put: false, pass: false }
  : turnOptions({
    sourceTiles: sourceItems.value.filter(item => item.kind === 'tile').length,
    sourcePlates: sourceItems.value.filter(item => item.kind === 'plate').length,
    placeableItems: placeable.value.size,
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
  INFER_ACTIONS_FROM_GESTURES
  && phase.value.kind === 'idle'
  && announcing.value === null
  && !showResults.value
  && !gameOver.value)

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
/** The name of whoever is playing, for the bar and the header. */
const activeName = computed(() => {
  void revision.value
  return state.seats[state.activeSeat]?.name ?? ''
})

/**
 * Whose turn the bar is announcing.
 *
 * While you are looking at somebody else's board the bar names them instead, because every control on
 * it would act for the player whose turn it is — and pressing Take while reading another board is not
 * something anybody means to do.
 */
const turnLabel = computed(() =>
  watching.value ? `Waiting for ${activeName.value}` : 'Your turn')

function chooseAction(action: TurnAction): void {
  if (action === 'take') phase.value = { kind: 'taking', selected: [], inferred: false }
  else if (action === 'put') phase.value = { kind: 'putting' }
  else endRoundByPassing()
}

/**
 * Passing takes you out of the round — it is not a skipped turn.
 *
 * A player who passes is done until the round ends; the round ends once **everyone** has. With one
 * seat that is the same moment, so a single Pass finishes the round outright. When there are more
 * seats this becomes a set of who has passed and a check that it holds everyone, but the rule is
 * already the one written here rather than a singleplayer shortcut.
 *
 * It is a choice, not a detection. It usually happens when nothing can be drafted and nothing placed,
 * but a player may pass with moves left, so nothing passes on their behalf.
 */
/**
 * Pass: out of the round, not a skipped turn.
 *
 * The rules decide what that means — the others play on, and the round closes only once the last of
 * them has passed, sweeping the source and banking every board. So this says what the player did and
 * then looks at what happened.
 */
function endRoundByPassing(): void {
  const before = state.round
  phase.value = IDLE
  if (!commit({ kind: 'pass', seat: activeIndex.value })) return
  if (state.round !== before || state.finished) showResults.value = true
  else announceTurn(count.value.turn, beginTurn)
}

/* ── the end of a round ───────────────────────────────────────────────────────── */

/** Rounds closed so far. Every seat banks together, so any seat's tally answers. */
const roundsFinished = computed(() => {
  void revision.value
  return state.seats[0]?.banked.length ?? 0
})
/** Whether the results panel is up. Separate from the count, since it closes on Next round. */
const showResults = shallowRef(false)

/**
 * A finished round, rebuilt from the log.
 *
 * The board **as it stood when that round closed**, not as it stands now — which is the whole reason
 * the log is the primary record. Memoised because a replay walks the whole prefix and a round's past
 * never changes, but that is only an optimisation: the record is a pure function of the log.
 *
 * Keyed by seat as well as round, because every player has their own board and the panel shows the
 * one being looked at.
 */
const derived = new Map<string, RoundRecord>()

function roundRecord(round: number, seat = viewedSeat.value): RoundRecord {
  const key = `${seat}:${round}`
  const cached = derived.get(key)
  if (cached) return cached

  const asThen = replayGame(gameOptions, log, { throughRound: round })
  const asItWas = (asThen.seats[seat] ?? asThen.seats[0]!).tableau
  const record: RoundRecord = {
    round,
    board: describeBoard(asItWas, HEX_SIZE),
    /*
     * Reading order, and the tally's filter preserves it — so every row of the reveal sweeps down the
     * board instead of hopping about in the order things happened to be placed.
     */
    tally: tallyRound(roundAgenda(agenda, round) ?? [], tilesInReadingOrder(asItWas)),
    leftovers: describeLeftovers(asItWas),
  }
  derived.set(key, record)
  return record
}

const roundRecords = computed<readonly RoundRecord[]>(() =>
  Array.from({ length: roundsFinished.value }, (_, index) => roundRecord(index + 1)))

/** What each finished round scored for the seat on screen, in order. */
const banked = computed<readonly number[]>(() => {
  void revision.value
  return [...(state.seats[viewedSeat.value]?.banked ?? [])]
})

const totalScore = computed(() => banked.value.reduce((sum, points) => sum + points, 0))

/**
 * The finished board's connected groups.
 *
 * Read off the last round's board, so the sheet and the picture beside it cannot disagree about what
 * was there. Only consulted once the game is over.
 */
const finalGroups = computed(() => {
  const last = roundRecords.value.at(-1)
  return finalTally(
    last?.board.tiles ?? [],
    {
      minGroupSize: settings.value?.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE,
      groupBonuses: settings.value?.groupBonuses ?? DEFAULT_GROUP_BONUSES,
      fineUnplaced: settings.value?.fineUnplaced ?? DEFAULT_FINE_UNPLACED,
      rewardStems: settings.value?.rewardStems ?? DEFAULT_REWARD_STEMS,
    },
    last?.leftovers ?? NOTHING_LEFT,
  )
})

const isFinalRound = computed(() => count.value.round >= (totalRounds.value || 1))

/**
 * Put the results panel away and start playing again.
 *
 * The round itself already turned over — the rules did it when the last player passed, sweeping the
 * source and banking every board. Nothing is decided here; the panel is simply dismissed and the new
 * round announced, with its first lot dealt behind the card.
 */
function startNextRound(): void {
  if (!showResults.value) return

  if (state.finished) {
    // The panel stays up and becomes the end of the game — see RoundResults' `over`.
    gameOver.value = true
    return
  }

  showResults.value = false
  /*
   * Let go of whatever seat the results panel was showing. Play follows the turn; staying pinned to
   * the player whose score you were reading would start the next round watching somebody else.
   */
  pinnedSeat.value = null
  announceRound(count.value.round, beginTurn)
}

const gameOver = shallowRef(false)

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

interface Announcement {
  readonly label: string
  readonly n: number
  /** Run once this card is fully up, and awaited before the hold starts. See `cardWork`. */
  readonly work?: () => void | Promise<void>
}

/** What the card is announcing, or null while play is live. */
const announcing = shallowRef<Announcement | null>(null)
/** Flipped false to start the exit; `announcing` clears when the exit reports itself finished. */
const cardVisible = shallowRef(false)

/**
 * Cards still to show, in order.
 *
 * A round opens with two — "ROUND 2" then "TURN 1" — and they have to be sequential rather than
 * simultaneous, so this is a queue rather than a single slot. Everything else pushes one.
 */
let cardQueue: Announcement[] = []

let cardTimers: ReturnType<typeof setTimeout>[] = []

function clearCardTimers(): void {
  for (const timer of cardTimers) clearTimeout(timer)
  cardTimers = []
}

/** This card is done. Show the next if there is one, otherwise hand the table back to the player. */
function finishAnnouncement(): void {
  clearCardTimers()
  cardWork = null
  cardVisible.value = false
  const next = cardQueue.shift()
  if (next) {
    showCard(next)
    return
  }
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
let cardWork: (() => void | Promise<void>) | null = null

/**
 * Which card is up, as a number that only ever increases.
 *
 * The work behind a card is a network round trip now, so it can finish after its card has already been
 * given up on — `CARD_SAFETY_MS` moves on regardless, and an unmount clears everything. Comparing the
 * token on the way back is what stops a late answer restarting a card that has gone.
 */
let cardToken = 0

function showCard(card: Announcement): void {
  clearCardTimers()
  cardToken++
  cardWork = card.work ?? null
  announcing.value = card
  cardVisible.value = true
  cardTimers.push(setTimeout(finishAnnouncement, CARD_SAFETY_MS))
}

/** Announce these in order, replacing anything queued. */
function announce(cards: readonly Announcement[]): void {
  const [first, ...rest] = cards
  if (!first) return
  cardQueue = rest
  showCard(first)
}

/** A turn card, optionally restocking behind it once it is up. */
function announceTurn(turn: number, work?: () => void | Promise<void>): void {
  announce([{ label: 'Turn', n: turn, work }])
}

/**
 * A round card, then the first turn of it.
 *
 * Two beats rather than one: a new round is a bigger event than a new turn, and saying so takes the
 * time to say it. The restock rides on the *turn* card, which is the one the player is watching when
 * the new lot needs to appear.
 */
function announceRound(round: number, work?: () => void | Promise<void>): void {
  announce([{ label: 'Round', n: round }, { label: 'Turn', n: 1, work }])
}

/**
 * The card is fully up. Restock behind it, then start the hold.
 *
 * Restocking here rather than on a timer is what makes the new lot *arrive* on screen instead of having
 * always been there: the card is opaque, the plate and its tiles appear underneath it, and the card
 * then leaves to reveal them.
 */
async function onCardShown(): Promise<void> {
  const work = cardWork
  const mine = cardToken
  cardWork = null

  // Awaited, so the hold begins once the lot is actually there. The restock is a request now, and
  // starting the clock before it lands would let the card leave over an empty slot.
  await work?.()
  if (mine !== cardToken) return

  cardTimers.push(setTimeout(() => { cardVisible.value = false }, CARD_HOLD_MS))
  cardTimers.push(setTimeout(finishAnnouncement, CARD_HOLD_MS + CARD_LEAVE_MS))
}

onBeforeUnmount(clearCardTimers)

function endTurn(): void {
  phase.value = IDLE
  announceTurn(count.value.turn, beginTurn)
}

onBeforeUnmount(clearCardTimers)

/**
 * The start of a turn: restock the source if it wants restocking.
 *
 * `needsDeal` owns the conditions — newest lot touched, round has a plate left, room to shift into —
 * and `dealLot` asks the desk for the one thing the state cannot work out for itself.
 */
async function beginTurn(): Promise<void> {
  await dealLot()
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
  // Which slot each takes is the rules' business: the draft crosses from the source's model into this
  // seat's, and only one of them can decide where things land.
  if (commit({ kind: 'draft', seat: activeIndex.value, ids: [...selectedIds.value] })) endTurn()
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
  const spec = p.item.kind === 'tile' ? board().tile(p.item.id) : board().plateToken(p.item.id)
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
  const out: Payer[] = board().tiles()
    .filter(tile => tile.location.kind === 'drawer')
    .map(tile => ({ id: tile.id, kind: 'tile' as const, color: tile.color, value: tile.value }))

  for (const plate of board().plates()) {
    if (plate.location.kind !== 'plateSlot') continue
    const token = board().plateToken(plate.id)
    if (token) out.push({ id: plate.id, kind: 'plate', color: token.color, value: token.value })
  }
  for (const stem of board().stems()) out.push({ id: stem.id, kind: 'stem' })
  return out
})

/**
 * Drawer items that could actually be placed — those whose price this drawer can meet.
 *
 * A stem is never in here: it cannot go on the board at all, so "can you afford it" does not arise.
 * The purse for each candidate excludes the candidate itself, since placing it takes it out of the
 * drawer before anything is paid.
 */
const placeable = computed(() => {
  void revision.value
  const all = purse.value
  const ids = new Set<string>()
  for (const item of all) {
    if (item.kind === 'stem' || item.color === undefined || item.value === undefined) continue
    const rest = all.filter(other => other.id !== item.id)
    if (canAffordPlacement({ color: item.color, value: item.value }, rest)) ids.add(item.id)
  }
  return ids
})

/**
 * Drawer items to show as unavailable, or null when nothing should be marked.
 *
 * Shown while placing, and while idle with anything placeable in hand — deliberately *not* gated on
 * something being affordable. When nothing is, everything dims and the disabled Put button has a
 * visible reason; gating on affordability would leave that case with an undimmed drawer and a dead
 * button, which is the state hardest to explain.
 *
 * Null the rest of the time. Outside a turn the drawer is just your hand, and dimming half of it
 * would be answering a question nobody asked.
 */
const unaffordable = computed(() => {
  const holdsCandidate = purse.value.some(item => item.kind !== 'stem')
  if (!(phase.value.kind === 'putting' || (inferring.value && holdsCandidate))) return null
  const dim = new Set<string>()
  for (const item of purse.value) {
    if (item.kind !== 'stem' && !placeable.value.has(item.id)) dim.add(item.id)
  }
  return dim
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
/**
 * Pay for the provisional placement, which is what commits the turn.
 *
 * The placement is on the board already, so the player can see what they are buying — but the log
 * records **committed turns**, and a `put` carries the placement and its payment together. So the
 * provisional move is put back first and the rules do the whole thing: otherwise the live path and a
 * replay would start from different boards, and only one of them could be right.
 *
 * Undoing and immediately redoing it is invisible — the piece is already where it is going — and it
 * means there is one description of a placement rather than two that could drift.
 */
function applyPayment(): void {
  const current = phase.value
  if (current.kind !== 'paying' || !canApply.value) return

  const item = current.item
  const to = item.kind === 'tile'
    ? board().tile(item.id)?.location
    : board().plate(item.id)?.location
  if (!to) return

  // Back where it came from, so the command starts from the board the rules expect.
  if (item.kind === 'tile') board().moveTile(item.id, current.origin as TileLocation)
  else board().movePlate(item.id, current.origin as PlateLocation)

  const played = commit({
    kind: 'put',
    seat: activeIndex.value,
    item,
    to,
    paying: [...current.selected],
  })
  if (!played) {
    // Refused after all: put it back where the player left it rather than silently undoing their move.
    if (item.kind === 'tile') board().moveTile(item.id, to as TileLocation)
    else board().movePlate(item.id, to as PlateLocation)
    revision.value++
    return
  }
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
    board().moveTile(current.item.id, current.origin as TileLocation)
  } else {
    board().movePlate(current.item.id, current.origin as PlateLocation)
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

const drawerLayout = computed(() =>
  createDrawerLayout(viewport.value.w, viewport.value.h, drawerShape))

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
  const plate = board().plates().find(
    p => p.location.kind === 'plateSlot' && p.location.slot === slot,
  )
  if (!plate) return null
  return { slot, plateId: plate.id, x: centre.x, y: centre.y }
})

function rotate(steps: number): void {
  const controls = rotateControls.value
  if (!controls) return
  if (board().rotatePlate(controls.plateId, steps)) revision.value++
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
      <ExternalAnchors
        :tableau="board()"
        :revision="revision"
      />
      <SourceChrome
        :drawer="drawerShape"
        :lots="platesPerRound"
        :live="phase.kind === 'taking' || canStartTake"
      />
      <DrawerChrome
        :drawer="drawerShape"
        :target-slot="targetTileSlot"
        :target-plate-slot="targetPlateSlot"
        :target-valid="targetValid"
        :live="phase.kind === 'putting' || phase.kind === 'paying'"
      />
      <TableauView
        :tableau="board()"
        :source="source()"
        :drawer="drawerShape"
        :game-id="gameId"
        :may-place="phase.kind === 'putting' || canStartPut"
        :unaffordable="unaffordable"
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
        v-if="announcing === null && !showResults && !gameOver"
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

    <RoundResults
      v-if="showResults && roundRecords.length"
      :rounds="roundRecords"
      :seats="seatTabs"
      :final="isFinalRound"
      :over="gameOver"
      :final-tally="finalGroups"
      @select="showSeat"
      @next="startNextRound"
    />

    <TurnAnnounce
      :announcing="announcing"
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
      <!--
        Whose board this is. Only worth saying at a table: with one seat it is always yours, and a
        label that never changes is furniture.
      -->
      <p
        v-if="seatRows.length > 1"
        class="viewing"
        :class="{ watching }"
      >
        <span class="viewing-label">Board</span>
        <strong>{{ seatRows[viewedSeat]?.name }}</strong>
        <span
          v-if="watching"
          class="viewing-note"
        >watching</span>
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

    <!--
      The plan for the whole game, and what it has been worth so far.

      Top right, where the drag hints used to be. Those had become scenery for anyone past their first
      game; this has to be read every round. It cannot go under the title, where it belongs by subject:
      the shared source is a column down the left edge starting just below the header, and a panel
      there would sit on the one part of the screen you draft from.
    -->
    <section class="chrome-panel agenda">
      <h2 class="chrome-title">
        Scoring
      </h2>
      <ol>
        <li
          v-for="(round, index) in agenda"
          :key="index"
          :class="{ now: index + 1 === count.round }"
        >
          <span class="round-no">R{{ index + 1 }}</span>
          <span class="targets">
            <span
              v-for="(target, at) in round"
              :key="at"
              class="target"
            >
              <TileChip
                :color="target.kind === 'color' ? target.color : undefined"
                :value="target.kind === 'value' ? target.value : undefined"
              />
              <span class="per">{{ target.points }}</span>
            </span>
          </span>
          <!--
            A finished round shows what it banked; the round in progress shows what it is worth *right
            now* — which is what the old "points this round" readout said in a panel of its own. On its
            own row it needs no label.
          -->
          <span
            class="earned"
            :class="{ live: index + 1 === count.round && banked[index] === undefined }"
          >{{ scoreOf(index) }}</span>
        </li>
      </ol>
      <p class="so-far">
        <span>banked</span>
        <strong>{{ totalScore }}</strong>
      </p>

      <!--
        Everyone at the table, and which of them you are looking at.

        The view follows whoever is playing, so in an ordinary hot-seat turn this reads rather than
        being clicked. Clicking a seat pins the view to it — to see what somebody else is building —
        and clicking it again lets go and follows the turn once more.
      -->
      <ul
        v-if="seatRows.length > 1"
        class="seats"
      >
        <li
          v-for="row in seatRows"
          :key="row.seat"
        >
          <button
            type="button"
            :class="{ active: row.active, viewed: row.viewed }"
            :aria-pressed="row.viewed"
            @click="viewSeat(row.seat)"
          >
            <span class="seat-mark">{{ row.active ? '▸' : '' }}</span>
            <span class="seat-name">{{ row.name }}</span>
            <span class="seat-note">{{ row.passed ? 'passed' : '' }}</span>
            <span class="seat-score">{{ row.total }}</span>
          </button>
        </li>
      </ul>
    </section>

    <!--
      The desks are made before the game can start, and said so plainly if they cannot be.

      An unreachable table used to be impossible: the bag was local, so a game either ran or the page
      was broken. Now it is an ordinary thing that can happen — the server is not started, or it is
      running rules this page is not — and neither reads as anything at all without being said.
    -->
    <div
      v-if="dealing || deskTrouble"
      class="table-state"
      role="status"
    >
      <p v-if="deskTrouble">
        {{ deskTrouble }}
      </p>
      <p v-else>
        Dealing…
      </p>
      <RouterLink
        v-if="deskTrouble"
        to="/"
        class="table-back"
      >
        Back to the menu
      </RouterLink>
    </div>
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
 * Live figures, so they get their own group rather than being folded into the settings line beside
 * them. That line is fixed for the whole game; these move.
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

/*
 * The plan for the whole game, not just the round in progress: the targets are worth playing toward
 * several rounds early, and a panel showing only the current one would hide that.
 *
 * Top right, in the corner the drag hints used to hold — so it no longer needs an offset measured
 * against a card above it, which was the fragile part of the old arrangement.
 */
.agenda {
  position: absolute;
  top: 14px;
  right: 14px;
  min-width: 247px;
  padding: 10px 12px;
  font-size: 11px;
}

.agenda ol {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.agenda li {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 3px 0;
  color: #6b7382;
}

/* The round in progress, in the same brass the header's live figures use. */
.agenda li.now {
  color: #e8c878;
}

.round-no {
  width: 20px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
}

.targets {
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: center;
}

/* What the round actually scored, or is scoring. Right-aligned so the column reads as a column. */
.earned {
  min-width: 22px;
  color: #cfd4de;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* Still moving, so it is stated more quietly than a figure that has been banked. */
.earned.live {
  color: #8fe6c0;
}

.so-far {
  display: flex;
  justify-content: space-between;
  margin: 7px 0 0;
  padding-top: 7px;
  border-top: 1px solid #2a2c33;
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.so-far strong {
  color: #e8c878;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.target {
  display: flex;
  gap: 3px;
  align-items: center;
}

/* Points per matching tile. Dim, because the chip beside it is what is being read. */
.per {
  color: #6b7382;
  font-variant-numeric: tabular-nums;
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

/* ── waiting for the table ─────────────────────────────────────────────────── */

/*
 * Over the board rather than beside it, because until the desks exist the board is not a game yet —
 * a starting plate and nothing to draft. Quiet while it is only slow; it is usually gone in a blink.
 */
.table-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  z-index: 30;
  background: rgb(12 14 18 / 88%);
  color: #cfd4de;
  font-size: 14px;
  letter-spacing: 0.08em;
  text-align: center;
}

.table-state p {
  max-width: 34ch;
  margin: 0;
  line-height: 1.6;
}

.table-back {
  color: #e8c878;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

/* ── who is playing, and whose board this is ──────────────────────────────────── */

.viewing {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0;
}

.viewing-label {
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.viewing strong {
  color: #cfd4de;
  font-weight: 500;
  font-size: 12px;
}

/* Amber while you are reading somebody else's board, so it never passes for your own. */
.viewing.watching strong {
  color: #e8c878;
}

.viewing-note {
  color: #7d6a41;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.seats {
  margin: 12px 0 0;
  padding: 10px 0 0;
  border-top: 1px solid #22252b;
  list-style: none;
}

.seats button {
  display: flex;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.seats button:hover {
  border-color: #33383f;
  color: #cfd4de;
}

/* Whose turn it is, and which board is on screen: two different facts, so two different marks. */
.seats button.active .seat-name {
  color: #cfd4de;
}

.seats button.viewed {
  border-color: #3a3222;
  background: rgb(232 200 120 / 6%);
}

.seats button.viewed .seat-name {
  color: #e8c878;
}

.seat-mark {
  width: 8px;
  color: #8fe6c0;
}

.seat-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-note {
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.seat-score {
  color: #cfd4de;
  font-variant-numeric: tabular-nums;
}

.seats button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 1px;
}
</style>
