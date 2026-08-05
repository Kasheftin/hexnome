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
 * **Not a route.** `GameView` is, and it mounts this only once it has fetched a game. Everything here
 * is therefore built synchronously from props, exactly as it was when the game came out of
 * localStorage — which is the point of the split, because making 1700 lines wait on a network call
 * would have meant making all of them conditional.
 *
 * The board is **restored, not restarted**: `props.commands` is the server's whole log, replayed into
 * the tableau before the recorder wraps it. A turn is played locally the instant the player makes it
 * and submitted afterwards; what comes back is only the part the server added, because this side
 * already has its own. The deck is not here at all — it belongs to the server, which is what makes a
 * face-down plate genuinely unknown.
 */
import { mdiArrowDownLeftBold, mdiArrowDownRightBold } from '@mdi/js'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3 } from 'three'
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { createAgenda, roundAgenda, scoreTargets, tallyRound } from '@hexnome/rules/agenda'
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
  applyEntry,
  createGameLog,
  entriesThroughRound,
  recordingTableau,
  replayTableau,
  type LogEntry,
} from '@hexnome/rules/gameLog'
import type { RoundRecord } from '@/ui/roundRecord'
import { sourceContents } from '@hexnome/rules/source'
import {
  type Anchor,
  type PlateLocation,
  type TableauOptions,
  type TileLocation,
} from '@hexnome/rules/tableau'
import { watchHead, type HeadWatch } from '@/composables/useHeadWatch'
import { seatView } from '@hexnome/rules/seatView'
import { tableauOptionsFor } from '@hexnome/rules/setup'
import {
  IDLE,
  INFER_ACTIONS_FROM_GESTURES,
  nextRound,
  nextTurn,
  turnOptions,
  type TurnAction,
  type TurnCount,
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
  DEFAULT_TILE_SLOTS,
  modeInfo,
  roundsOf,
  type GameSettings,
} from '@hexnome/rules/gameSettings'
import type { GameSync } from '@/composables/useGameSync'
import { replayOf, SERVER_SEAT, type CommandView, type GameView } from '@hexnome/rules/wire'

/**
 * The game, already fetched.
 *
 * Props rather than a lookup, because everything below is built synchronously at setup and there is
 * nothing sensible to build without them. `GameView` does the waiting and only mounts this once it
 * has a game — and remounts it, by changing its key, if the two ever disagree.
 */
const props = defineProps<{
  game: GameView
  /** Every command the server has recorded, oldest first. The opening position is the first of them. */
  commands: readonly CommandView[]
  /**
   * The seat this browser holds, or null for somebody who only has the link.
   *
   * A spectator is not a special case: with no seat of their own it is never their turn, so every
   * gate that asks "is this mine?" answers no without being told about spectators at all.
   */
  mySeat: number | null
  /** Whose board is on screen. Starts as `mySeat`, or seat 0 for someone just watching. */
  viewedSeat: number
  sync: GameSync
}>()

/** Raised when the board can no longer trust itself; `GameView` reloads and rebuilds. */
const emit = defineEmits<{ diverged: [] }>()

const settings = computed<GameSettings | null>(() => props.game.settings)

/**
 * What generates this game, as distinct from what finds it.
 *
 * The deck, the agenda, the reshuffles and the loose-tile scatter all come from the **seed**; the id
 * only says which game this is. Two games may share a seed — that is how the same board gets played
 * twice — so anything derived must read this and never `gameId`.
 */
const seed = computed(() => props.game.seed)

const modeLabel = computed(() => {
  const s = settings.value
  return s ? modeInfo(s.mode)?.label ?? s.mode : ''
})

/**
 * Other players' turns, arriving while this one waits.
 *
 * Applied to the **inner** tableau, not the recording one: they already happened and are already in
 * the server's log, so journalling them would send the whole table's moves back as if this browser
 * had made them.
 *
 * `watchHead` nudges on a socket message or a poll tick, and `catchUp` decides whether there was
 * anything to it. Both are allowed to fire for nothing.
 */
let watching: HeadWatch | null = null

async function absorbOthers(): Promise<void> {
  const arrived = await props.sync.catchUp()
  if (arrived.length === 0) return
  for (const command of arrived) {
    for (const entry of replayOf(command)) applyEntry(unrecorded, entry)
  }
  revision.value++
}

onBeforeUnmount(() => watching?.stop())

onMounted(() => {
  watching = watchHead(props.game.id, () => { void absorbOthers() })

  /*
   * Every arrival is announced, including a reload — the two cards are how the board introduces
   * itself, and coming back to a game deserves that as much as starting one.
   *
   * What matters is that they tell the truth. `announceRound` used to hardcode its turn card to 1,
   * which is right for a new round — rounds begin at one — and a lie for a board five turns in. It
   * takes the number now, so a resumed game says where it actually is.
   *
   * Nothing is dealt here. The opening lot arrives in the server's genesis command and is already on
   * the board by the time this runs.
   */
  announceRound(count.value.round, count.value.turn)
})

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
const agenda = createAgenda(seed.value, settings.value?.mode ?? DEFAULT_SINGLEPLAYER_MODE)

/**
 * Built by the rules package, not here.
 *
 * The server derives the same options from the same settings to replay the log; two derivations would
 * be free to disagree, and the disagreement would show up as a replay that quietly produces a
 * different board rather than as an error. So there is exactly one, and it lives in `rules/setup.ts`.
 *
 * The other branch is **not** a second derivation and must not be maintained as one. Settings are
 * missing only for a game that cannot be read, and `onMounted` navigates away from those before a
 * turn begins — so this tableau is never played on. It exists because the setup below needs
 * *something* to construct, and it only has to be valid.
 */
const tableauOptions: TableauOptions = settings.value
  ? tableauOptionsFor(settings.value)
  : { cells, drawerSlots: drawerShape.tileSlots, plateSlots: drawerShape.plateSlots }

/**
 * Everything that happens to the board, written down.
 *
 * The whole game is the journal: any earlier position is rebuilt by replaying a prefix of it, which is
 * what lets the results panel show round 1 beside *the board as it was then*. Nothing is snapshotted.
 *
 * The tableau is **wrapped** rather than instrumented at each call site, because the board is mutated
 * from two very different places — here, and the drag handling inside `TableauView` — and a journal
 * with a hole in it is worse than none. Wrapping makes missing a site impossible.
 */
const log = createGameLog()

/**
 * Everything a turn has done, waiting to be sent.
 *
 * Filled by the same recorder that fills the journal, and drained when the turn ends. A turn is one
 * command on the server, so the batch boundary and the turn boundary are the same boundary.
 */
let batch: LogEntry[] = []

/**
 * The board, restored from the server's log and then recording again.
 *
 * The order matters and is the trap this is written to avoid: the history is replayed into the
 * **inner** tableau, before the recorder wraps it. Replaying through the wrapper would journal every
 * restored entry a second time and send the whole game back to the server as if it had just been
 * played.
 */
/** Everything that has happened, flattened — which is all a board needs. */
const history = props.commands.flatMap(replayOf)

const unrecorded = replayTableau(history, tableauOptions)

/** Every mutation, journalled and gathered into the turn being built. */
const recording = recordingTableau(unrecorded, (entry) => {
  log.append(entry)
  batch.push(entry)
})

/**
 * The board this screen is about — one seat's view of the whole game.
 *
 * The state above holds every player's board and drawer; this decides which of them the scene is
 * asking about. Pointed at your own seat it is writable, and at anybody else's it refuses every
 * mutation, so watching another player is the *real* renderer rather than a picture of one, and
 * nothing downstream has to remember it is only looking.
 *
 * Fixed for the lifetime of this component. Changing which seat you are watching remounts the board
 * — `GameView` keys on it — which costs one replay and keeps the hundred call sites below reading a
 * plain constant instead of a reactive one.
 */
const tableau = seatView(recording, props.viewedSeat, props.viewedSeat === props.mySeat)

/** True when this is your own board and you may act on it at all. Turn order is a separate gate. */
const isMyBoard = computed(() => props.viewedSeat === props.mySeat)

/*
 * The journal starts where the server's log ends, not empty. The results accordion replays a prefix
 * of it to show each finished round beside the board as it stood then, and a journal that began at
 * the refresh would show the game starting halfway through.
 */
for (const entry of history) log.append(entry)

/**
 * The bags this game's id seeds, and how far into them play has got.
 *
 * The *order* is a frozen contract derived from the id (game/deck.ts); the cursor is ordinary play state
 * that resets with the board. A restock draws one plate and a full heap of tiles off the top of each.
 */
/**
 * What the server has dealt and this board has yet to show.
 *
 * The deck lives on the server now — see `rules/dealer.ts`. A turn's acknowledgement carries the
 * server's answer to it: a plate turning over, a fresh lot on the source. Those entries are held here
 * rather than applied on arrival, because they should appear *behind the turn card*, at the same
 * moment the old local deal used to happen. `beginTurn` spends them.
 */
let dealtByServer: LogEntry[] = []

const targetCells = shallowRef<Axial[]>([])
const targetValid = shallowRef(false)
const targetTileSlot = shallowRef<number | null>(null)
const targetPlateSlot = shallowRef<number | null>(null)
/** Bumped on every committed move, so the DOM readouts recompute. */
const revision = shallowRef(0)

/**
 * What the current round has earned so far — what would be banked if it ended now.
 *
 * Counts the whole board, `fixed` tiles included, which is why it reads `tilesOnBoard()` rather than
 * the `counts.placed` figure beside it: that one deliberately counts only the player's own placements.
 */
const roundPoints = computed(() => {
  void revision.value
  return scoreTargets(roundAgenda(agenda, count.value.round) ?? [], tableau.tilesOnBoard())
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
 * Which round, and which turn of it — recovered from the log rather than started at one.
 *
 * Both are countable because the log is grouped into commands: a round ends at an `endRound` entry,
 * and one command is one turn. Deriving them is what stops a refresh mid-game from redrawing a board
 * six turns in under the heading "turn 1", which is the sort of wrong that makes a player distrust
 * everything else on the screen.
 *
 * The server's own commands are not turns and are not counted — only what a seat submitted.
 */
function countFromLog(commands: readonly CommandView[]): TurnCount {
  let round = 1
  let turn = 1
  for (const command of commands) {
    if (command.effects.some(e => e.op === 'endRound') || command.response.some(e => e.op === 'endRound')) {
      round++
      turn = 1
      continue
    }
    if (command.author !== SERVER_SEAT) turn++
  }
  return { round, turn }
}

const count = shallowRef(countFromLog(props.commands))

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

/**
 * Whether this browser may act at all right now.
 *
 * Two questions, and they are genuinely different: *is this my board* — watching another player is a
 * view of the real thing, not a picture, so it has to refuse — and *is it my turn*. A spectator fails
 * the first without spectators being mentioned anywhere, because a seat of `null` matches nobody.
 *
 * The model refuses anyway: `tableau` is a read-only view unless this is your own seat. This is the
 * same answer said early enough to grey a button instead of swallowing a click.
 */
const canAct = computed(() =>
  isMyBoard.value && props.sync.head().awaiting === props.mySeat)

const options = computed(() => turnOptions({
  sourceTiles: sourceItems.value.filter(item => item.kind === 'tile').length,
  sourcePlates: sourceItems.value.filter(item => item.kind === 'plate').length,
  placeableItems: placeable.value.size,
  freeDrawerSlots: freeSlots.value.length,
  freePlateSlots: freeBays.value.length,
}))

/** Nothing is offered when it is not yours to do. `waitingFor` says why, in the bar's own words. */
const liveOptions = computed(() =>
  canAct.value ? options.value : { take: false, put: false, pass: false })

/** Whose turn it is, named, or empty when it is yours. */
const waitingFor = computed(() => {
  if (canAct.value) return ''
  if (!isMyBoard.value) {
    const seat = props.game.seats[props.viewedSeat]
    return `Watching ${seat?.name || `Player ${props.viewedSeat + 1}`}`
  }
  const awaiting = props.sync.head().awaiting
  if (awaiting === null) return 'The game is over'
  const seat = props.game.seats[awaiting]
  return `Waiting for ${seat?.name || `Player ${awaiting + 1}`}`
})

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
  // Nothing is inferred from a gesture when there is nothing you may do. The action bar being
  // greyed is not enough: touching the source *is* a way to begin a draft, so it has to refuse too.
  && canAct.value
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
/**
 * The bar's headline: what you may do, or who everyone is waiting for.
 *
 * "Your turn" was the only possibility when there was one player. Now it is the *exception* — most
 * of a four-player game is spent watching — so the bar says whose turn it is by name, and offers
 * nothing while it is not yours.
 */
const turnLabel = computed(() => waitingFor.value || 'Your turn')

/*
 * Every route into a turn checks `canAct` for itself, rather than trusting the buttons to be
 * disabled. There are three of them — the bar, a gesture on the source, a drag out of the drawer —
 * and a disabled button is a statement about a button, not about the game.
 */
function chooseAction(action: TurnAction): void {
  if (!canAct.value) return
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
 * Close the round by writing a bookmark, and nothing else.
 *
 * The score is not computed here and the board is not copied: both are *derived* from the journal
 * whenever the panel asks. Marking the boundary at the moment the player passes is what makes the
 * derivation right — the sweep of the source happens later, and a prefix cut here does not include it.
 */
async function endRoundByPassing(): Promise<void> {
  if (props.mySeat === null) return
  phase.value = IDLE

  /*
   * A pass is submitted like any other turn, and that is the fix for a bug that was quietly there in
   * singleplayer too: the bookmark used to be appended straight to the local journal, so it never
   * reached the server and a refresh lost every round boundary the panel draws.
   *
   * **The server decides whether the round is over**, not this. One seat passing ends a solo game's
   * round and ends nothing in a four-player one, and only the side that knows about all the seats can
   * tell the difference. What comes back is `endRound` — or nothing, and the turn simply moves on.
   */
  batch.push({ op: 'pass', seat: props.mySeat })
  await endTurn()
}

/* ── the end of a round ───────────────────────────────────────────────────────── */

/** Rounds closed so far. The one reactive fact about the journal the template needs. */
const roundsFinished = shallowRef(0)
/** Whether the results panel is up. Separate from the count, since it closes on Next round. */
const showResults = shallowRef(false)

/**
 * A finished round, rebuilt from the journal.
 *
 * Memoised because a replay walks the whole prefix and a round's past never changes — but memoising is
 * only an optimisation. The record is a pure function of the journal, so a game restored from a stored
 * log would rebuild exactly these without having kept anything else.
 */
const derived = new Map<number, RoundRecord>()

function roundRecord(round: number): RoundRecord {
  const cached = derived.get(round)
  if (cached) return cached

  const asItWas = replayTableau(entriesThroughRound(log.entries, round), tableauOptions)
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
  derived.set(round, record)
  return record
}

const roundRecords = computed<readonly RoundRecord[]>(() =>
  Array.from({ length: roundsFinished.value }, (_, index) => roundRecord(index + 1)))

/** What each finished round scored, in order — derived, not banked. */
const banked = computed<readonly number[]>(() =>
  roundRecords.value.map(record => record.tally.total))

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
 * Sweep the shared source into the piles: a round's leftovers do not carry over.
 *
 * Also a fix, not only a rule. Restocking needs `hasRoomToShift` — the *bottom* lot free — so a round
 * that ended with anything still in the bottom lot (the usual way a round ends: nothing left is
 * affordable) would leave the next round unable to push a lot at all.
 *
 * Loose tiles are discarded separately from the plate they are heaped on. A source tile is
 * `kind: 'source'`, not `onPlate`, so discarding the plate does *not* take it.
 */
function clearSource(): void {
  const { tiles: loose, plates: standing } = sourceContents(tableau)
  // Discarding is all this does now; where the pieces go afterwards is the server's business, and it
  // reads these same entries to find out. A face-down plate is swept without ever being looked at.
  for (const tile of loose) tableau.discard(tile.id)
  for (const plate of standing) tableau.discard(plate.id)
}

/**
 * Bank the round and move on.
 *
 * The drawer is deliberately **not** cleared: tiles nobody could pay for are still yours next round,
 * which is most of why a drawer accumulates awkward tiles at all. The source *is* cleared, and behind
 * the round card, so the player never sees the old lots blink out — the server sees the `endRound`
 * entry, reopens the quota, and deals the new round's first lot into the empty column.
 */
function startNextRound(): void {
  if (!showResults.value) return

  if (isFinalRound.value) {
    // The panel stays up and becomes the end of the game — see RoundResults' `over`.
    gameOver.value = true
    return
  }

  showResults.value = false
  count.value = nextRound(count.value)
  announceRound(count.value.round, count.value.turn, () => {
    // Behind the card, and in this order: empty the column before the new round's quota is opened.
    clearSource()
    revision.value++
    beginTurn()
  })
}

/** True once the last round has been banked. The game is over; nothing further is playable. */
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
  /** Run once this card is fully up. See `cardWork`. */
  readonly work?: () => void
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
let cardWork: (() => void) | null = null

function showCard(card: Announcement): void {
  clearCardTimers()
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
function announceTurn(turn: number, work?: () => void): void {
  announce([{ label: 'Turn', n: turn, work }])
}

/**
 * A round card, then the turn card for whichever turn is about to be played.
 *
 * The turn is passed rather than assumed to be one. It *is* one whenever a round begins, but this is
 * also how a reloaded game announces itself, and there the number is whatever the log says.
 *
 * Two beats rather than one: a new round is a bigger event than a new turn, and saying so takes the
 * time to say it. The restock rides on the *turn* card, which is the one the player is watching when
 * the new lot needs to appear.
 */
function announceRound(round: number, turn: number, work?: () => void): void {
  announce([{ label: 'Round', n: round }, { label: 'Turn', n: turn, work }])
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

async function endTurn(): Promise<void> {
  phase.value = IDLE

  /*
   * The turn is already on the board — it was played optimistically, move by move — so this is the
   * server catching up, not the board waiting for it. The card animation runs regardless; by the time
   * it lifts, `dealtByServer` normally holds the answer.
   */
  const turn = batch
  batch = []
  const answer = await props.sync.submit(turn)
  if (answer === null) {
    emit('diverged')
    return
  }
  /*
   * The turn number advances only once the server has taken the command, and that ordering is a bug
   * fixed rather than a preference: incrementing first meant a refused turn still moved the counter,
   * so a player waiting their turn could press Take, achieve nothing, and watch the round number
   * climb anyway.
   */
  count.value = nextTurn(count.value)
  dealtByServer = [...answer]

  /*
   * The round closed. Everything the answer holds is the bookmark, so it is applied at once rather
   * than behind a turn card — there is no next turn to announce, and the results panel is what
   * happens instead.
   */
  if (answer.some(entry => entry.op === 'endRound')) {
    for (const entry of dealtByServer) log.append(entry)
    dealtByServer = []
    roundsFinished.value = log.rounds()
    showResults.value = true
    return
  }

  announceTurn(count.value.turn, beginTurn)
}

/**
 * The start of a turn: show whatever the server dealt in answer to the last one.
 *
 * The client no longer decides *whether* a lot is due — `shouldRefill` is the server's question now,
 * asked where the deck is. All that is left here is putting the answer on the table.
 *
 * Applied to the **inner** tableau, so the entries are not journalled and sent straight back as if
 * this client had invented them.
 */
function beginTurn(): void {
  if (dealtByServer.length === 0) return
  for (const entry of dealtByServer) applyEntry(unrecorded, entry)
  dealtByServer = []
  revision.value++
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
  if (!canAct.value) return
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
 * Anchors that have already paid out. Each pays once, ever.
 *
 * Enclosure itself is derived and therefore reversible — that is what lets the emblem light up under a
 * provisional placement and go dark again on cancel. Payment must not be: without this an anchor could
 * be emptied and refilled to mint stems indefinitely.
 */
const paidAnchors = new Set<string>()

/**
 * A name for an anchor that survives the board moving underneath it.
 *
 * An internal anchor is named by its **plate**, not its cell, because a plate can be picked up and put
 * down elsewhere — and an anchor that has been paid for should not pay again just because it is now at
 * different coordinates. An external anchor has no owner to be named by, so its cell is all there is;
 * it is also a hole in the plates, which only closes, so it does not travel.
 */
function anchorKey(anchor: Anchor): string {
  if (anchor.kind === 'external') return `external:${anchor.cell.q},${anchor.cell.r}`
  return `internal:${tableau.coverageAt(anchor.cell)?.plateId ?? `${anchor.cell.q},${anchor.cell.r}`}`
}

/**
 * Hand out stems for any anchor enclosed by the move just settled.
 *
 * Run on payment rather than on the placement landing, because until the price is paid the placement is
 * only provisional — the anchor lights up to show what is on offer, but cancelling has to leave the
 * player with nothing gained.
 *
 * Every board plate is checked rather than just the one that was touched. It costs nothing at this
 * scale and it means the award cannot be missed by whatever future move encloses a plate some other
 * way. `canPlaceTile` has already refused any placement whose reward would not fit, so the slots are
 * there.
 */
function awardEnclosedAnchors(): void {
  for (const anchor of tableau.anchors()) {
    const key = anchorKey(anchor)
    if (paidAnchors.has(key) || !tableau.anchorIsEnclosed(anchor.cell)) continue
    paidAnchors.add(key)
    // The rate for its kind, plus the strict bonus if its ring earns one.
    for (let i = 0; i < tableau.anchorReward(anchor); i++) {
      const slot = tableau.freeDrawerSlots()[0]
      if (slot === undefined) break
      tableau.addStem(slot)
    }
  }
}

function applyPayment(): void {
  if (!canAct.value) return
  const current = phase.value
  if (current.kind !== 'paying' || !canApply.value) return

  /*
   * Spent items are not put back into a bag here any more. The server folds a command's discards into
   * its own piles — one batch per command, which is what keeps a reshuffle independent of the order
   * the player happened to click. Doing it on both sides would deal the pile twice.
   */
  for (const id of current.selected) tableau.discard(id)

  // After the payment: spending can free slots, and the reward should be able to use them.
  awardEnclosedAnchors()
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
      <ExternalAnchors
        :tableau="tableau"
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
        :tableau="tableau"
        :drawer="drawerShape"
        :seed="seed"
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
        :options="liveOptions"
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
      :final="isFinalRound"
      :over="gameOver"
      :final-tally="finalGroups"
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
    </section>
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
</style>
