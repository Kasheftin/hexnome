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
import {
  mdiArrowDownLeftBold,
  mdiArrowDownRightBold,
  mdiChevronRight,
  mdiCogOutline,
  mdiHelpCircleOutline,
} from '@mdi/js'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3 } from 'three'
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createAgenda, roundAgenda, scoreTargets, tallyRound } from '@hexnome/rules/agenda'
import { createDesk as createLocalDesk } from '@hexnome/rules/desk'
import { finalTally, NOTHING_LEFT, type FinalTally } from '@hexnome/rules/groups'
import {
  canConfirmDraft,
  completedStrategies,
  draftAttribute,
  draftFits,
  draftStates as draftStatesOf,
  toggleDraftSelection,
  type DraftItem,
} from '@hexnome/rules/draft'
import { boardCells } from '@hexnome/rules/board'
import { SOURCE_TILES_PER_LOT } from '@hexnome/rules/source'
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
  paymentPurse,
  canUndo,
  replayGame,
  scoreAnchors,
  type Command,
  type CommandResult,
  type GameOptions,
} from '@hexnome/rules/game'
import type { CommandRow, PlayerCommand } from '@hexnome/rules/wire'
import { useMediaQuery } from '@/composables/mediaQuery'
import { rulesHealth } from '@/composables/useDesk'
import { useGameSync } from '@/composables/useGameSync'
import { colorName, tileName } from '@/scene/explainRefusal'
import { rotateButtonBoxes, type RotateButtonBox } from '@/scene/rotateButtons'
import type { RoundRecord } from '@/ui/roundRecord'
import {
  type PlateLocation,
  type Tableau,
  type TileLocation,
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
import GameSettingsPanel from '@/ui/GameSettingsPanel.vue'
import HintTip from '@/ui/HintTip.vue'
import RulesPanel from '@/ui/RulesPanel.vue'
import NoticePanel from '@/ui/NoticePanel.vue'
import PresenceMark from '@/ui/PresenceMark.vue'
import TileChip from '@/ui/TileChip.vue'
import TurnAnnounce from '@/ui/TurnAnnounce.vue'
import {
  COLORS,
  HEX_SIZE,
  departureMillis,
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
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  effectiveFirstPassFine,
  effectiveStrictBonus,
  modeInfo,
  roundsOf,
  type GameSettings,
  defaultGameSettings,
  SOLO,
} from '@hexnome/rules/gameSettings'
import { useGameStore } from '@/stores/game'
import { rememberSheetRead, sheetRead } from '@/composables/readSheets'

const route = useRoute()
const router = useRouter()
const store = useGameStore()

const gameId = computed(() => {
  const id = route.query.id
  return typeof id === 'string' ? id : ''
})

/**
 * The settings, from the server, read once.
 *
 * Once because that is what they are: everything below is built from them at setup — the drawer's
 * shape, the agenda, the tableau — and a game whose settings changed under it would be a different
 * game with the same board on screen. The store guarantees they are here: App.vue mounts nothing
 * about a game until it has loaded (stores/game.ts).
 */
const settings = shallowRef<GameSettings | null>(store.game?.settings ?? null)

const modeLabel = computed(() => {
  const s = settings.value
  return s ? modeInfo(s.mode)?.label ?? s.mode : ''
})

/**
 * What the player is told while the log is being fetched, and if it cannot be.
 *
 * The game is on the server now, so a page genuinely cannot start without it. Saying nothing would
 * leave an empty board with a starting plate on it and no explanation — which reads as a broken game
 * rather than an unreachable one.
 *
 * The same line carries a turn the server refused, and the rare case of this page folding a command
 * differently from the server. Both mean the table is not where this screen thinks it is, which is
 * the one thing a player needs to know.
 */
const loadingLog = shallowRef(true)
const trouble = shallowRef<string | null>(null)

function reportTrouble(error: unknown): void {
  trouble.value = error instanceof Error ? error.message : 'The table is not answering.'
}

onMounted(async () => {
  // No id, or one we cannot read: there is no game here, so send them somewhere that works.
  if (!settings.value) {
    void router.replace('/')
    return
  }

  /*
   * The whole log, folded before anything is drawn.
   *
   * This is what makes a refresh mid-game work, and a share link opened on turn nine: the board is
   * not restarted, it is rebuilt. The opening lot is in there too — the server wrote it when the game
   * started, so a page never deals anything for itself.
   */
  try {
    absorb(await sync.load())
  } catch (error) {
    reportTrouble(error)
    return
  } finally {
    loadingLog.value = false
  }

  void checkRules()

  /*
   * Announced from wherever the log left the game, which for a fresh one is round 1, turn 1 — but
   * not over a score sheet. A page rebuilt at a closed round has a panel up, and a card sliding over
   * it announces a round nobody is about to play.
   */
  if (!showResults.value) announceRound()
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
    trouble.value = 'The server is running different rules from this page. Restart the backend.'
  }
}

/**
 * A rectangular playfield of 1661 cells (~41 × 41). Panning is clamped so its edge is
 * unreachable, which is what makes it read as endless.
 */
const cells = boardCells()
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
 * Everything the rules need to build a game, in one place.
 *
 * The settings are normalised on the way in — the drawer shape, the placement rule, the strict bonus
 * — so the state is built from what the game will actually run with rather than from whatever is
 * stored. `cells` is a scene decision and comes from here for that reason.
 */
const gameOptions: GameOptions = {
  /*
   * The public seed, and the only one this end has: the opening plates and the petal stream come
   * from it. What the *desks* deal from is the server's own and never arrives here — see
   * `packages/rules/src/game.ts`.
   */
  gameId: gameId.value,
  settings: {
    ...(settings.value ?? defaultGameSettings(0)),
    /*
     * Who is in each chair comes from the **seats**, not from the settings.
     *
     * `playerNames` was the setting a lobby wrote into when the lobby was a form. Now a name arrives
     * with the person, as they claim a seat, and the settings only carry whatever the creator typed
     * before anybody else was there. Reading the stale copy put "Player 2" on a board somebody had
     * already given a name to.
     */
    playerNames: store.game?.seats.map(seat => seat.name) ?? [],
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
 * `replayGame(gameOptions, log)` rebuilds this exactly. The log itself is the **server's** — this is
 * a copy of it, extended only by rows that have already been stored.
 */
const log: Command[] = []
/*
 * **Reassigned, not only mutated.** Every turn changes this in place, but an undo cannot: it cancels
 * commands rather than reversing them, so the position it leaves is a fresh fold of what survives
 * (`effectiveLog`). Nothing captures this binding — the board, the source and every seat are reached
 * through `board()`, `boardOf()` and `source()`, which read it when they are called — so swapping the
 * object is enough and there is nothing left holding the old one.
 */
let state = createGame(gameOptions)

/** The log over the wire: what has happened, and the only way to add to it. */
const sync = useGameSync(gameId.value)

/**
 * Go and look whenever the server says the game moved.
 *
 * The nudge carries a number and no game data, so this is where it turns into turns. It fires for
 * this client's own writes too and costs a request that finds nothing — which is the price of the
 * socket being an optimisation rather than a source of truth, and `catchUp` stands aside while a
 * submit is in flight so its own turn cannot arrive twice.
 */
const stopListening = store.onMoved(() => { void catchUp() })
onBeforeUnmount(stopListening)

async function catchUp(): Promise<void> {
  absorb(await sync.catchUp())
}

/**
 * Bumped on every committed move, so the readouts and the scene recompute.
 *
 * The state is plain mutable data — the tableaux are closures over maps — so this is the one signal
 * that anything changed. One counter for the whole game, because a command can touch the source and
 * a board at once.
 */
const revision = shallowRef(0)

/**
 * Fold rows the server has stored, and let the table catch up with what they did.
 *
 * The one path by which anything reaches the board, whoever played it. A turn of your own arrives in
 * the answer to the request that submitted it; somebody else's arrives in a catch-up; a deal arrives
 * behind either. Nothing here can tell them apart, and nothing needs to.
 *
 * **The card is raised by the rows, not by the player who pressed something.** A round that closed
 * closes for everybody, and a turn that moved on moves on for everybody — so this is where both are
 * noticed, rather than in the three places a turn can be started from.
 */
function absorb(rows: readonly CommandRow[]): void {
  if (rows.length === 0) return
  const before = { round: state.round, turn: state.turn, finished: state.finished }

  /*
   * Folded silently, then told about once.
   *
   * The scene builds a view for anything new the moment `revision` moves, so a stem minted by an
   * enclosure has to be *known to be an arrival* before that happens — otherwise it is already in
   * place by the time anyone could animate it. One bump for the batch also means a turn and the deal
   * behind it reach the screen together rather than a frame apart.
   */
  const awarded: string[] = []
  /*
   * Whether the log *ends* on a closed round, judged row by row rather than across the batch.
   *
   * Comparing the round before the batch with the round after answers a different question — "did a
   * round close anywhere in here" — and a whole log always spans one. That is what put the round-1
   * sheet back on screen after every refresh of round 2, for the rest of the round.
   *
   * A round closing raises it; anything a player did afterwards means the table has moved on without
   * it. Two kinds do not count as moving on. The deal behind a close, because the server writes the
   * new round's opening lot in the same breath as the pass that ended the old one, so it arrives
   * before anybody could have read anything. And an arrange, because sorting your drawer while the
   * sheet is up is a thing people do *while reading it*.
   */
  const idles = new Set(['deal', 'arrange'])
  let closed = false
  for (const row of rows) {
    const wasRound = state.round
    if (row.command.kind === 'undo') {
      /*
       * The one row that cannot be applied.
       *
       * An undo says which commands stop counting, so the position after it is a fold of what is
       * left rather than a change to what is here — there is no inverse to run. Cheap by the same
       * measure the server uses: a few hundred calls against arrays of tens, and the ids come back
       * identical because the same log mints them, so the scene's views survive it.
       */
      log.push(row.command)
      state = replayGame(gameOptions, log)
    } else {
      const played = commit(row.command, { tell: false })
      if (played) awarded.push(...played.awarded)
    }
    if (state.round !== wasRound || state.finished) closed = true
    else if (!idles.has(row.command.kind)) closed = false
  }
  if (awarded.length > 0) arriving.value = awarded
  revision.value++

  /*
   * A round closed. Everyone sees the sheet, not only whoever played the last pass — but only once
   * each: putting it away is a person finishing reading rather than a thing that happened to the
   * game, so it is remembered here and not in the log. See `readSheets`.
   */
  if (closed) {
    if (!sheetRead(gameId.value, roundsFinished.value)) {
      /*
       * Everyone comes home first.
       *
       * A round can close while you are peeking at somebody else's board — you pass, wander over to
       * see what they are building, and their last move ends the round. The sheet would then open on
       * *their* score, which reads as your own until you notice the name. A round ending is the
       * table's moment rather than any one player's, so it starts where the player does. The tabs are
       * still there for the comparison.
       */
      pinnedSeat.value = null
      showResults.value = true
      return
    }

    /*
     * A finished game always has the panel up; the marker decides only which face of it.
     *
     * Every other round has somewhere to go once its sheet is read — the next one. The last has not,
     * so a read marker here means the player has already pressed through to the final scoring, and
     * this is a page rebuilding itself at the place they left. Without it a reload would land on a
     * board with nothing playable and no score in sight.
     */
    if (state.finished) {
      showResults.value = true
      gameOver.value = true
      return
    }
  }

  /*
   * Stems come in from the left, and the turn card waits for them — otherwise it comes up over
   * pieces still travelling. Whoever earned them: on somebody else's board it costs a beat nobody is
   * looking at, which is cheaper than a second path through here.
   */
  if (awarded.length > 0) {
    settling.value = true
    if (settleTimer !== null) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      settleTimer = null
      settling.value = false
      arriving.value = []
      if (state.turn !== before.turn) announceTurn()
    }, AWARD_SETTLE_MS)
    return
  }

  // Announced only when a turn genuinely moved, so a deal arriving on its own is silent.
  if (state.turn !== before.turn) announceTurn()
}

/**
 * Take a turn: send it, and fold what comes back.
 *
 * Nothing is applied before the server has it. The board already waits half a second for pieces to
 * fly, so a round trip hides inside an animation that was there anyway — and waiting is what makes
 * every client's copy of the log the same copy.
 */
async function submitTurn(
  command: PlayerCommand,
  /**
   * Run between the server's answer and the fold, in the same tick as both.
   *
   * One caller needs it. A `put` is submitted with the item still on the board, and the fold expects
   * it back in the drawer — so the two have to happen with nothing rendered in between, or the piece
   * is seen returning to the drawer and setting out again.
   */
  beforeFold?: () => void,
): Promise<boolean> {
  await settleArrangement()

  /*
   * **A turn that lost the race goes again by itself.**
   *
   * The chain allows one command per parent, so two players acting in the same instant means one of
   * them names a head that has already moved and is refused. That is not the player's mistake and
   * used to be their problem: the turn simply did not happen, nothing was said — a stale answer is
   * deliberately not shouted about — and they pressed the button a second time.
   *
   * Catching up and asking again is safe because a refused turn *did not land*: the server compares
   * `prevSeq` with the head and answers 409 before it parses, folds or writes anything. So this is a
   * first attempt with a fresh parent, not a repeat of a command that might already have taken. If
   * the intervening turns made it illegal — somebody drafted the tiles this was reaching for — the
   * server says so with 422 and its own words, which is the message the player should get.
   */
  for (let attempt = 1; ; attempt++) {
    const outcome = await sync.submit(command)

    if (!outcome.failure) {
      beforeFold?.()
      absorb(outcome.commands)
      return true
    }

    /*
     * A refusal is worth saying — the two ends disagreed about a game they are both folding, which is
     * a bug rather than a move. Staleness is not, until it will not stop.
     */
    if (outcome.failure !== 'stale') {
      trouble.value = outcome.message ?? 'That turn was not taken.'
      absorb(await sync.catchUp())
      return false
    }

    absorb(await sync.catchUp())
    if (attempt >= TURN_ATTEMPTS) {
      trouble.value = 'The table kept moving while that turn was going in. Try again.'
      return false
    }
  }
}

/**
 * How many times a turn will catch up and try again before giving up on it.
 *
 * Losing twice running means something other than an ordinary race — a tab submitting in a loop, or
 * a table busy enough that this needs a different answer than retrying.
 */
const TURN_ATTEMPTS = 3

/**
 * Sorting your own drawer, which is not a turn.
 *
 * The one place this page acts before the server has agreed — and it has no choice, because the scene
 * has already done it. A drag ends by seating the item where it was dropped (`TableauView.dropHeld`),
 * and making that wait on a round trip would put a half-second of lag inside the one gesture in the
 * game that should feel like moving a physical thing. So the model moves, and this catches up.
 *
 * That is safe here and nowhere else, because an `arrange` states **where everything sits** rather
 * than what moved. Folding the row when it comes back re-seats what is already seated. A rearrangement
 * that lost a race is not replayed but re-read off the drawer as it now stands. And one that never
 * lands costs a drawer order, which the next drag states again in full.
 */
const ARRANGE_SETTLE_MS = 400

/** How many times to lose the race before giving the drawer up as not worth another round trip. */
const ARRANGE_ATTEMPTS = 4

let arrangeTimer: number | null = null
let arrangeInFlight: Promise<void> | null = null
let arrangeAgain = false

/** How your drawer is seated right now, in the words an `arrange` uses. */
function myArrangement(): PlayerCommand {
  const mine = boardOf(mySeat.value)
  return {
    kind: 'arrange',
    seat: mySeat.value,
    drawer: Array.from({ length: drawerShape.tileSlots }, (_, slot) =>
      mine.drawerSlotOccupant(slot) ?? null),
    bays: Array.from({ length: drawerShape.plateSlots }, (_, slot) =>
      mine.plateSlotOccupant(slot) ?? null),
  }
}

/**
 * The scene rearranged something. Redraw, and — if it was yours to rearrange — write it down.
 *
 * Three gates. **A seat**, because a spectator has no drawer and no token to send with. **Your own
 * board**, which the scene now refuses to let you drag at all — kept here because this one is about
 * what gets *sent*, and a seat may only ever arrange its own drawer. And an **idle phase**: while a
 * placement is provisional the tile is on the board here and still in the drawer in the log, so an
 * arrangement listing what is left would not be an arrangement of the drawer the server holds, and
 * would be refused for a reason that is not the player's fault.
 */
function onRearranged(): void {
  revision.value++
  if (store.mySeat === null) return
  if (viewedSeat.value !== mySeat.value) return
  if (phase.value.kind !== 'idle') return

  if (arrangeTimer !== null) window.clearTimeout(arrangeTimer)
  arrangeTimer = window.setTimeout(() => {
    arrangeTimer = null
    void startArrange()
  }, ARRANGE_SETTLE_MS)
}

/**
 * Send the drawer as it stands, losing the race as often as it takes.
 *
 * A rearrangement takes a link in the chain like any other command, so one taken while somebody else
 * is playing may find the head has moved. Catching up and asking again is safe *because the
 * arrangement is re-read* each time: what goes out the second time describes the drawer after the
 * turn that beat it, not before.
 */
async function sendArrangement(): Promise<void> {
  for (let attempt = 1; attempt <= ARRANGE_ATTEMPTS; attempt++) {
    const outcome = await sync.submit(myArrangement())
    if (!outcome.failure) {
      absorb(outcome.commands)
      return
    }
    if (outcome.failure !== 'stale') {
      console.warn(`[hexnome] the drawer order was not saved: ${outcome.message ?? outcome.failure}`)
      return
    }
    absorb(await sync.catchUp())
  }
  // Not worth a banner: the order is how the drawer looks, not what is in it, and the next drag
  // states the whole arrangement again — as does a reload, from the log.
  console.warn(`[hexnome] the drawer order lost ${ARRANGE_ATTEMPTS} races and was not saved.`)
}

/** One in flight at a time, with at most one waiting behind it. */
function startArrange(): Promise<void> {
  if (arrangeInFlight) {
    arrangeAgain = true
    return arrangeInFlight
  }
  arrangeInFlight = sendArrangement().finally(() => {
    arrangeInFlight = null
    if (!arrangeAgain) return
    arrangeAgain = false
    void startArrange()
  })
  return arrangeInFlight
}

/**
 * Get a pending rearrangement into the log before asking the server for anything else.
 *
 * Two commands racing for one link in the chain means one of them loses, and a turn losing to your
 * own drawer-tidying would be this page beating itself. The arrangement is already on screen, so it
 * goes first and the turn follows it.
 */
async function settleArrangement(): Promise<void> {
  if (arrangeTimer !== null) {
    window.clearTimeout(arrangeTimer)
    arrangeTimer = null
    void startArrange()
  }
  while (arrangeInFlight) await arrangeInFlight
}

/**
 * A move the rules turned down, in words, waiting to be read.
 *
 * Separate from `trouble`, which is the table being unreachable — a dead end with a way back to the
 * menu. This is the game working exactly as it should and the move not being allowed, so it is
 * dismissed rather than escaped from.
 *
 * The board says no by turning a cell red, which is enough for the three reasons you can see and no
 * use at all for the two you cannot: a duplicate created through a tile several cells away, and a
 * reward with nowhere to go, which makes a full drawer refuse a placement that looks perfectly legal.
 * Those two used to be console-only, which meant they read as the game being broken.
 */
const refused = shallowRef<string | null>(null)

/** The two reference panels the top strip opens. Neither touches the game. */
const rulesOpen = shallowRef(false)
const gameSettingsOpen = shallowRef(false)

/** Whose turn it is, read through `revision` so it follows the state rather than shadowing it. */
const activeIndex = computed(() => {
  void revision.value
  return state.activeSeat
})

/**
 * Which chair is **yours**, as the server worked it out from the seat token.
 *
 * Zero for a spectator, who has none: they get a board to look at rather than a blank screen, and
 * every gate below turns on `myTurn`, which a spectator never satisfies. A solo game is seat 0 too,
 * so nothing about one player is special-cased.
 */
const mySeat = computed(() => store.mySeat ?? 0)

/**
 * Whether you hold a seat here at all.
 *
 * A spectator does not. Anyone with the link may open a game and watch it — that is what makes a
 * share link work — but a seat is claimed once and proved with a token, and the server hands one out
 * only while the table is still filling (`games.service.join`). So a visitor arriving at a game in
 * progress, or a player who cleared the storage their token lived in, has no seat and can do nothing.
 *
 * `mySeat` falls back to 0 so they have a board to look at rather than a blank screen. That fallback
 * is a **viewport** and nothing more; every question about what may be *done* asks this instead.
 * Conflating the two is what let a page with no token show seat 0's board marked "you", say "your
 * turn", and offer live buttons for a turn the server would refuse.
 */
const seated = computed(() => store.mySeat !== null)

/** Whether the turn is yours to take — the question every control on the bar really asks. */
const myTurn = computed(() => seated.value && activeIndex.value === mySeat.value)

/** The last round has closed and been scored. Nothing is playable after this. */
const gameIsOver = computed(() => {
  void revision.value
  return state.finished
})

/**
 * Which seat's board and drawer are on screen.
 *
 * A player is a **viewport**, not a slice of the truth: everyone holds the same state and differs
 * only in what they are looking at. Null means *your own board*, which is where a player should be
 * almost always — a view that followed the turn would whip your board away the moment somebody else
 * played, which is exactly what it used to do. Clicking a seat in the score panel pins the view
 * there, to see what they are building; clicking it again comes home.
 */
const pinnedSeat = shallowRef<number | null>(null)
const viewedSeat = computed(() => {
  const pinned = pinnedSeat.value
  return pinned !== null && pinned < state.seats.length ? pinned : mySeat.value
})

/** The seat being looked at, and the column everyone drafts from. */
const board = (): Tableau => (state.seats[viewedSeat.value] ?? state.seats[0]!).tableau
const source = (): Tableau => state.source

/** A named seat's own board, for the paths that must act on the player rather than on the view. */
const boardOf = (seat: number): Tableau => (state.seats[seat] ?? state.seats[0]!).tableau

/**
 * Reading somebody else's board: the table is live, but this is not your part of it.
 *
 * About the **viewport**, and only the viewport, which is what the word means. Whether you may *act*
 * is `myTurn`, and the two are independent: your own board while another player thinks is neither
 * watching nor yours to play on.
 *
 * False while a turn is settling, so a badge does not flash over your own board as its pieces land.
 */
const watching = computed(() => !settling.value && viewedSeat.value !== mySeat.value)

/**
 * The board on screen is one you may touch: yours, and yours to begin with.
 *
 * Not the negation of `watching` — a spectator holds no seat at all and `mySeat` falls back to 0 for
 * them, so "the seat I am looking at is mine" is true for a visitor and has to be asked together with
 * whether there is a seat to be looking at. Named once because the scene is told it and the rotate
 * buttons ask it, and two spellings of one question drift apart.
 */
const yours = computed(() => seated.value && viewedSeat.value === mySeat.value)

/** Every seat, for the score panel: who is playing, who has passed, what they have banked. */
const seatRows = computed(() => {
  void revision.value
  /*
   * The closing reckoning joins the chips only once this player has asked to see it.
   *
   * It could be shown the moment the last round closes — it is a pure function of a board nobody can
   * touch any more. But the panel counts those twelve categories out one at a time, and a chip two
   * inches away already reading the answer would be giving away the end of the thing it is watching.
   * `gameOver` is per browser, so each player's chips wait for their own reveal.
   */
  const closing = gameOver.value
  return state.seats.map(seat => {
    const rounds = seat.banked.reduce((sum, points) => sum + points, 0)
    const final = closing ? finalFor(seat.seat).total : null
    return {
      seat: seat.seat,
      name: seat.name,
      passed: seat.passed,
      /*
       * Presence comes from the *server's* seat list, not the folded state, because it is not part
       * of the game — see `SeatView.online`. Merged by seat number, which is the same index both
       * lists are built on.
       */
      online: store.game?.seats[seat.seat]?.online ?? false,
      /** The rounds alone. Null `final` means that is the whole story so far. */
      rounds,
      final,
      total: rounds + (final ?? 0),
      active: seat.seat === state.activeSeat,
      viewed: seat.seat === viewedSeat.value,
      mine: seated.value && seat.seat === mySeat.value,
    }
  })
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
  rounds: row.rounds,
  final: row.final,
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
 * The single way the game changes here: fold one command the server has already accepted.
 *
 * **Nothing reaches this that has not been stored.** A turn of your own arrives in the answer to the
 * request that submitted it, and somebody else's arrives in a catch-up; they take the same path, so
 * there is no optimistic copy of the board to reconcile and no rollback to write.
 *
 * A refusal here is therefore not a player pressing something they should not have — the server
 * refused that already — but this end disagreeing with the server about a game they are both folding.
 * That is a bug rather than a move, and it is said out loud.
 */
function commit(
  command: Command,
  { tell = true }: { tell?: boolean } = {},
): Extract<CommandResult, { ok: true }> | null {
  const result = applyCommand(state, command)
  if (!result.ok) {
    console.error(`[hexnome] the server accepted a ${command.kind} this page cannot apply: ${result.error}`, command)
    trouble.value = 'This page has fallen out of step with the table. Reload to catch up.'
    return null
  }
  log.push(command)
  /*
   * `tell` is how a caller says "not yet".
   *
   * Bumping the revision is what makes the scene look at the model again, and it builds a view for
   * anything new on the spot — so anything the view needs to *know* about a new piece has to be true
   * before the bump, not after. A reward is the case: the stems exist the moment the command applies,
   * and the scene has to be told they are arrivals before it first sees them, or it will have already
   * put them in place.
   */
  if (tell) revision.value++
  // Spent and swept material goes back to the pile by the server's own hand, in the same request
  // that accepted the turn. This end no longer touches a desk at all.
  return result
}

/**
 * The pieces this payment is spending, handed to the scene to fly off.
 *
 * A prop rather than a call on the component: it lives inside `TresCanvas`, which is its own
 * renderer, and a template ref across that boundary stays null — which is exactly how the first
 * attempt failed silently, paying instantly while looking like it waited.
 */
const spending = shallowRef<readonly string[]>([])

/** Stems an enclosure has just paid out, so the scene can bring them in rather than blink them on. */
const arriving = shallowRef<readonly string[]>([])

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
  const scored = scoreTargets(roundAgenda(agenda, count.value.round) ?? [], board().tilesOnBoard())
  /*
   * Less the first-pass fine, once this seat is the one that has incurred it. Not a prediction: the
   * seat has already passed, so the charge is settled and only the round's close is outstanding.
   */
  const fined = state.firstToPass === viewedSeat.value
    ? effectiveFirstPassFine(gameOptions.settings)
    : 0
  // Plus what the board's anchors are worth, which is a fact about the board as it stands.
  return scored + scoreAnchors(board(), gameOptions.settings) - fined
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
 * Three questions, and all must be yes. **Is there a game left** — a finished one has no turns in it,
 * and the server answers a command with a 409 that reads as a fault rather than as "it is over".
 * **Is the turn mine** — the rules would refuse a command from anybody else anyway, but a live button
 * answered with a refusal is a worse way to say so. And **am I looking at my own board** — every
 * control here acts on the player whose turn it is, and pressing Take while reading somebody else's
 * board is not something anyone means to do.
 *
 * The panel normally covers the bar once the last round closes, so this rarely decides anything. It
 * is here because "the game is over" is a fact about the game rather than about what is on top of it.
 */
const options = computed<TurnOptions>(() => (gameIsOver.value || !myTurn.value || watching.value)
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

/** The name of whoever is playing, for the bar to name when the turn is not yours. */
const activeName = computed(() => {
  void revision.value
  return state.seats[state.activeSeat]?.name ?? ''
})

/**
 * What the bar says about whose turn it is.
 *
 * "Your turn" is now a claim about **ownership** rather than about the viewport. It used to be
 * printed whenever you were not reading another board, which in a hot-seat game was true and at a
 * real table told every player they were up at once.
 */
const turnLabel = computed(() =>
  myTurn.value ? 'Your turn' : `Waiting for ${activeName.value}`)

/**
 * Which board a watcher is looking at, or null when they are a player.
 *
 * Named separately from the turn, and shown beside it, because the two come apart: watching the
 * player who is *not* playing is the ordinary case, and one sentence trying to say both would have to
 * pick a lie. Left half the board, right half the turn.
 */
const watchingLabel = computed(() =>
  seated.value ? null : `Watching ${state.seats[viewedSeat.value]?.name ?? 'the table'}'s board`)

function chooseAction(action: TurnAction | 'undo'): void {
  if (action === 'take') phase.value = { kind: 'taking', selected: [], inferred: false }
  else if (action === 'put') phase.value = { kind: 'putting' }
  else if (action === 'undo') takeTurnBack()
  else endRoundByPassing()
}

/**
 * Does this game have undo at all — solo, and set up for it?
 *
 * Asked of the rules rather than of the settings directly, so the button and the server are reading
 * one answer. A log with no turn in it still *offers* undo; it just has nothing to take back yet,
 * which is {@link canTakeBack}'s question.
 */
const offersUndo = computed(() => gameOptions.settings.allowUndo && gameOptions.settings.players <= SOLO)

/** Is there a turn to take back right now? The same call the server makes before accepting one. */
const canTakeBack = computed(() => {
  void revision.value
  return canUndo(gameOptions, log)
})

/**
 * Take the last turn back.
 *
 * Submitted like any other command and applied only from what comes back — an undo is not special on
 * the way out, only on the way in, where `absorb` re-folds instead of applying. A refusal needs no
 * handling of its own: nothing was changed here to put back.
 */
async function takeTurnBack(): Promise<void> {
  if (settling.value || !canTakeBack.value) return
  phase.value = IDLE
  settling.value = true
  try {
    await submitTurn({ kind: 'undo', seat: mySeat.value })
  } finally {
    settling.value = false
  }
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
 * them has passed, sweeping the source and banking every board. The **server** decides it, and what
 * comes back says what happened; `absorb` raises the results panel if a round closed, for everybody
 * rather than only for whoever played the last pass.
 */
async function endRoundByPassing(): Promise<void> {
  if (settling.value) return
  phase.value = IDLE
  settling.value = true
  try {
    await submitTurn({ kind: 'pass', seat: mySeat.value })
  } finally {
    settling.value = false
  }
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

  /*
   * A refused command means the rebuilt game is not the game that was played — and the symptom is a
   * score quietly a few points short, with nothing on screen to say why. So it is shouted about.
   */
  const asThen = replayGame(gameOptions, log, {
    throughRound: round,
    onRefused: (command, error, at) => {
      console.error(`[hexnome] replay of round ${round} refused command ${at} (${command.kind}): ${error}`, command)
    },
  })
  const asItWas = (asThen.seats[seat] ?? asThen.seats[0]!).tableau
  const record: RoundRecord = {
    round,
    board: describeBoard(asItWas, HEX_SIZE),
    /*
     * Reading order, and the tally's filter preserves it — so every row of the reveal sweeps down the
     * board instead of hopping about in the order things happened to be placed.
     */
    tally: tallyRound(roundAgenda(agenda, round) ?? [], tilesInReadingOrder(asItWas)),
    anchors: (asThen.seats[seat] ?? asThen.seats[0]!).anchored[round - 1] ?? 0,
    fine: (asThen.seats[seat] ?? asThen.seats[0]!).fined[round - 1] ?? 0,
    leftovers: describeLeftovers(asItWas),
  }
  derived.set(key, record)
  reportScoring(round, seat, asItWas, record)
  return record
}

/**
 * The working behind a round's score, on the console.
 *
 * A tally is a number arrived at from a board, and when the number looks wrong the only question
 * worth asking is which of the two is. So both are printed: every tile the rebuilt board holds, and
 * every tile each target actually counted — with anything on the board that no target matched listed
 * separately, since a tile that should have scored and did not is exactly the thing being hunted.
 */
function reportScoring(round: number, seat: number, asItWas: Tableau, record: RoundRecord): void {
  const name = state.seats[seat]?.name ?? `seat ${seat}`
  const counted = new Set(record.tally.rows.flatMap(row => row.tiles.map(tile => tile.id)))
  const describe = (tile: { id: string, color: number, value: number, fixed: boolean }) => {
    const cell = asItWas.cellOfTile(tile.id)
    return `${tile.id} ${tileName(tile)}${tile.fixed ? ' (plate token)' : ''} at ${cell ? `${cell.q},${cell.r}` : '?'}`
  }

  console.groupCollapsed?.(`[hexnome] round ${round} scoring for ${name}: ${record.tally.total}`)
  console.log('board tiles', asItWas.tilesOnBoard().map(describe))
  console.log('diagram tiles', record.board.tiles.map(tile => `${tile.id} ${tileName(tile)} at ${tile.cell.q},${tile.cell.r}`))
  for (const row of record.tally.rows) {
    const target = row.target.kind === 'value' ? `all ${row.target.value}s` : `all ${colorName(row.target.color)}`
    console.log(`${target}: ${row.points} from`, row.tiles.map(describe))
  }
  console.log('not counted by any target', asItWas.tilesOnBoard().filter(t => !counted.has(t.id)).map(describe))
  console.groupEnd?.()
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
 * The score line above the seat list, for the board on screen.
 *
 * The same working the chips show, and here for the same reason — plus one of its own: a solo game
 * has no chips at all (the list needs two seats), so without this the only place a finished game's
 * real total appears is inside the panel that is about to be closed.
 *
 * The word changes with the number. Until the closing reckoning it is what has been *banked*, which
 * is exactly true; after it, that is no longer the score.
 */
const viewedScore = computed(() => {
  const rounds = totalScore.value
  const final = gameOver.value ? finalFor(viewedSeat.value).total : null
  return { rounds, final, total: rounds + (final ?? 0) }
})

/** What the closing reckoning is scored under. One copy, read by every seat's tally. */
const scoringRules = computed(() => ({
  minGroupSize: settings.value?.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE,
  groupBonuses: settings.value?.groupBonuses ?? DEFAULT_GROUP_BONUSES,
  fineUnplaced: settings.value?.fineUnplaced ?? DEFAULT_FINE_UNPLACED,
  rewardStems: settings.value?.rewardStems ?? DEFAULT_REWARD_STEMS,
}))

/** A seat's closing reckoning, off the board it finished with. */
function finalFor(seat: number): FinalTally {
  const last = roundsFinished.value > 0 ? roundRecord(roundsFinished.value, seat) : null
  return finalTally(last?.board.tiles ?? [], scoringRules.value, last?.leftovers ?? NOTHING_LEFT)
}

/**
 * The finished board's connected groups.
 *
 * Read off the last round's board, so the sheet and the picture beside it cannot disagree about what
 * was there. Only consulted once the game is over.
 */
const finalGroups = computed(() => finalFor(viewedSeat.value))

/**
 * Was the round this panel is showing the last one?
 *
 * **Not** "is the current round the last": by the time the panel is up the state has already moved
 * on — the rules close a round the moment the final player passes — so `count.round` is the round
 * about to be *played*, and reading it here called round 3 the end of a four-round game. The state
 * says outright when there is nothing after this, so it is asked instead.
 */
const isFinalRound = computed(() => {
  void revision.value
  return state.finished
})

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
    /*
     * The panel stays up and becomes the end of the game — see RoundResults' `over`.
     *
     * Remembered like any other sheet, because that is what this press is: finishing with the last
     * round's. What it moves on to is the final scoring rather than a next round, and a reload lands
     * there rather than counting the last round out a second time and asking again.
     */
    rememberSheetRead(gameId.value, roundsFinished.value)
    gameOver.value = true
    return
  }

  showResults.value = false
  // Remembered before anything else, so a refresh a heartbeat later does not put the sheet back.
  rememberSheetRead(gameId.value, roundsFinished.value)
  /*
   * Let go of whatever seat the results panel was showing, so a new round opens on your own board
   * rather than on the one whose score you were reading last.
   */
  pinnedSeat.value = null
  announceRound()
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
  /** Who is about to play. Left off the round card, and off a solo game — see `whoseTurn`. */
  readonly whose?: string
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

/**
 * Whose turn a card is about to announce, or undefined in a solo game.
 *
 * Read here, as the card is built, rather than in the card as it renders. A card is a snapshot of the
 * moment it went up — and one of them is raised while the previous turn's pieces are still settling,
 * so a live binding would be reading a seat that is on its way somewhere else.
 */
function whoseTurn(): string | undefined {
  return state.seats.length > 1 ? activeName.value : undefined
}

/**
 * The turn card, read from the state as the card is built.
 *
 * Like `whoseTurn`, and for the same reason: a card is a snapshot of the moment it went up rather
 * than a live binding. Read here rather than passed in, because a number passed in is a second copy
 * of where the game is, and the copy is the one that goes stale.
 */
function turnCard(work?: () => void | Promise<void>): Announcement {
  return { label: 'Turn', n: count.value.turn, whose: whoseTurn(), work }
}

function announceTurn(work?: () => void | Promise<void>): void {
  announce([turnCard(work)])
}

/**
 * A round card, then the turn within it.
 *
 * Two beats rather than one: a new round is a bigger event than a new turn, and saying so takes the
 * time to say it. The restock rides on the *turn* card, which is the one the player is watching when
 * the new lot needs to appear.
 *
 * That turn is nearly always 1, because this is nearly always a round opening — but not on a refresh,
 * where the log has been folded to wherever the game really is, and the card has to say the same as
 * the header above it.
 */
function announceRound(work?: () => void | Promise<void>): void {
  // Only the turn card names anybody: a round belongs to the table, and the card that follows this one
  // is the one saying whose turn it is.
  announce([{ label: 'Round', n: count.value.round }, turnCard(work)])
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

/**
 * Take the selection, and let it be seen arriving.
 *
 * The pieces need no animation of their own: a drafted tile **keeps its id** across the move from the
 * source's model into this seat's, so the scene finds the same object in a new place and eases it
 * there — the glide from the column to the drawer already exists.
 *
 * What it needed was time. The rules hand the turn on as part of the draft, and the view follows
 * whoever is playing — so the tiles arrived in a drawer that was already somebody else's, which is to
 * say they were never seen at all.
 *
 * The view no longer moves: it sits on your own board, and the tiles are landing in your own drawer.
 * What is still needed is the **time** — the turn is announced once the glide has finished, so the
 * card does not come up over pieces still travelling.
 */
async function confirmTake(): Promise<void> {
  if (!canConfirm.value || settling.value) return
  // Which slot each takes is the rules' business: the draft crosses from the source's model into this
  // seat's, and only one of them can decide where things land.
  settling.value = true
  const taking = [...selectedIds.value]
  phase.value = IDLE

  /*
   * The submit and the glide run together rather than one after the other.
   *
   * The tiles cannot start moving until the rows come back — nothing is applied before the server has
   * it — but once they are moving the turn should not wait a second time. So the settle is timed from
   * the moment the board changes, and a localhost round trip disappears into it.
   */
  if (!await submitTurn({ kind: 'draft', seat: mySeat.value, ids: taking })) {
    settling.value = false
    return
  }
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    settling.value = false
  }, DRAFT_SETTLE_MS)
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
 * What the player may spend, from the rules rather than from here.
 *
 * This used to be built by hand, and the hand-built one dropped a tile's colour — so the bar lit a
 * payment the rules then refused, which is a confusing way to be told no. One definition, in the
 * module that judges it.
 */
const purse = computed<Payer[]>(() => {
  void revision.value
  return paymentPurse(board())
})

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
  // The bar is hidden while the pieces fly, so this cannot normally be reached twice — but a keypress
  // or a stale click should not be able to pay the same price again.
  if (settling.value) return
  if (current.kind !== 'paying' || !canApply.value) return

  const item = current.item
  const to = item.kind === 'tile'
    ? board().tile(item.id)?.location
    : board().plate(item.id)?.location
  if (!to) return

  /*
   * The pieces leave first, and the turn waits for them.
   *
   * The flight is told to begin here, before the model changes, so the payment is seen leaving the
   * board it was paid from. Only when it has landed is the turn sent — which also means the round
   * trip runs after an animation rather than before one, and is invisible inside it.
   *
   * `settling` closes Apply while it plays — and stays closed through the submit, because the turn is
   * not taken until the server says so and a second press in that window would send it twice.
   * `commitPayment` releases it.
   */
  const seat = mySeat.value
  settling.value = true
  spending.value = [...current.selected]
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    spending.value = []
    void commitPayment(seat, item, to, current.origin, current.selected)
  }, departureMillis(current.selected.length))
}

/**
 * How long the drafted pieces are given to reach the drawer before the turn moves on.
 *
 * The glide itself is the scene's ordinary easing, which is quick; this is the pause that lets it be
 * watched. Long enough to follow a piece from the column to its slot, short enough that a turn does
 * not feel held up.
 */
const DRAFT_SETTLE_MS = 520

/** How long the stems an enclosure paid out are given to come in from the left. */
const AWARD_SETTLE_MS = 560

/** Whether a turn is mid-animation. Nothing else may happen to it until that lands. */
const settling = shallowRef(false)
let settleTimer: number | null = null
onBeforeUnmount(() => {
  if (settleTimer !== null) window.clearTimeout(settleTimer)
})

/**
 * The payment itself, once its pieces have gone.
 *
 * The placement is put back where it came from and the rules do the whole turn: the log records
 * **committed turns**, so a `put` carries the placement and its payment together, and the live path
 * has to start from the same board a replay would.
 */
async function commitPayment(
  seat: number,
  item: { kind: 'tile' | 'plate', id: string },
  to: TileLocation | PlateLocation,
  origin: TileLocation | PlateLocation,
  paying: readonly string[],
): Promise<void> {
  /*
   * **The acting seat's board, named, not `board()`.**
   *
   * `board()` is whatever is *on screen*, and the undo below moves a piece in the model. It was only
   * ever right because the view used to follow the turn, so the two coincided. With the view sitting
   * on your own board they part company the moment anybody peeks.
   */
  const playing = boardOf(seat)
  /*
   * How the plate was turned in the bay. Turning is free, repeatable and not a turn, so it is not a
   * command of its own — but it decides which cell each petal lands on, and a replay without it
   * refuses the placement and rebuilds a board with a tile missing. Rotation survives a move, so it
   * reads the same before the undo below or after it.
   */
  const rotation = item.kind === 'plate' ? playing.plate(item.id)?.rotation : undefined

  /*
   * **Submitted with the placement still on the board.**
   *
   * The fold wants the item back in the drawer — a `put` carries the placement and its payment
   * together, so the live path has to start where a replay starts. But the *server* does not: it
   * folds its own log, where the item never left the drawer. So the undo waits until the answer is
   * in hand and happens in the same tick as the fold, with nothing rendered between them.
   *
   * Undoing first is what the player saw as the tile flying back to the drawer and out again: the
   * scene eases every piece toward its model position each frame, so a model change is visible
   * whether or not `revision` moves, and the round trip was long enough to watch.
   */
  await submitTurn({ kind: 'put', seat, item, to, paying: [...paying], rotation }, () => {
    if (item.kind === 'tile') playing.moveTile(item.id, origin as TileLocation)
    else playing.movePlate(item.id, origin as PlateLocation)
    /*
     * And the turn is over. Set here rather than after the fold because `absorb` renders: leaving it
     * for a line later showed the bar still offering Apply on a placement that had already been
     * paid for, and pressing it a second time earned "that tile is not in your drawer".
     */
    phase.value = IDLE
  })
  /*
   * Released here rather than before the submit, so Apply is dead for the whole round trip.
   *
   * Unless `absorb` has taken it over: an enclosure that paid out holds the turn again while the
   * stems come in, and its own timer is what ends that.
   */
  if (arriving.value.length === 0) settling.value = false

  // A refusal leaves the placement exactly where the player left it, since it was never undone.
  // Everything else — the fold, the arrivals, the card — is `absorb`'s, for every client alike.
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

/**
 * Whether a finger is the only way in.
 *
 * Two queries, because either one alone answers a slightly wrong question. `(hover: none)` is the
 * condition the bug is actually about — the buttons were revealed by hovering, so where no hover can
 * happen they were unreachable — but it is also true in a headless browser, which has no input device
 * of any kind. `(pointer: coarse)` says the *primary* pointer is a finger, which is true on a phone
 * and false on a laptop with a touchscreen, whose mouse can still hover.
 *
 * Either is enough. The two failures are not comparable: a false positive shows the buttons on a
 * machine that did not need them shown, and a false negative leaves a phone unable to rotate a plate
 * at all. So this errs the cheap way.
 */
const touchPrimary = useMediaQuery('(hover: none), (pointer: coarse)')

function onHoverPlateSlot(slot: number | null): void {
  hoveredPlateSlot.value = slot
  if (slot !== null) activePlateSlot.value = slot
}

/**
 * Which bays are showing rotate buttons.
 *
 * With a pointer, the one being hovered. Moving onto a button leaves the canvas, which ends the
 * 3D hover — so the buttons would vanish the moment you reached for them, and they stay while
 * the pointer is on them instead.
 *
 * Without one, all of them, because rotating is not optional: a plate lands in a bay at whatever
 * rotation it was dealt, and the board almost always wants a different one. Nothing else on a
 * touch screen can produce the hover these were hiding behind, so the game was unfinishable on a
 * phone — the buttons are shown rather than made reachable some other way because a bay is only
 * two of them, and they already sit clear of the petals you drag from.
 */
const rotateSlots = computed<number[]>(() => {
  // Which bays are filled changes as plates are drafted and placed, and the scene reports that by
  // moving the revision. Hovering used to be the only thing that could reopen this question.
  void revision.value
  // Somebody else's plates are not yours to turn. The hovered path never asked, so spectating and
  // sweeping the pointer over a bay would offer buttons that rotated another player's plate locally
  // and told nobody — harmless and baffling. Always-on buttons would have made it loud.
  if (!yours.value) return []
  if (touchPrimary.value) {
    return board().plates()
      .map(p => (p.location.kind === 'plateSlot' ? p.location.slot : null))
      .filter((slot): slot is number => slot !== null)
      .sort((a, b) => a - b)
  }
  const slot = hoveredPlateSlot.value ?? (overButtons.value ? activePlateSlot.value : null)
  return slot === null ? [] : [slot]
})

/**
 * How big the two buttons are and where they sit, which is not a stylesheet's decision to make: the
 * drawer scales to the window, so the offsets depend on a number only the layout knows.
 */
const rotateBoxes = computed(() => rotateButtonBoxes(drawerLayout.value, touchPrimary.value))

/** A box as the inline style that draws it. `--glyph` sizes the svg, which has no attributes of its own. */
function boxStyle(box: RotateButtonBox): Record<string, string> {
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.size}px`,
    height: `${box.size}px`,
    '--glyph': `${box.glyph}px`,
  }
}

const rotateControls = computed(() => rotateSlots.value.flatMap((slot) => {
  const plate = board().plates().find(
    p => p.location.kind === 'plateSlot' && p.location.slot === slot,
  )
  if (!plate) return []
  const centre = drawerLayout.value.plateSlotCentre(slot)
  return [{ slot, plateId: plate.id, x: centre.x, y: centre.y }]
}))

function rotate(plateId: string, steps: number): void {
  if (board().rotatePlate(plateId, steps)) revision.value++
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

/**
 * Their tooltips, switched off where nothing can hover.
 *
 * A tap on a touch screen focuses the button, and `HintTip` opens on focus as well as on hover — so
 * every rotation would leave a bubble hanging until the next tap elsewhere, naming a key the device
 * has not got. Empty text is `HintTip`'s own way of saying "no tooltip", and the buttons' aria-labels
 * carry the same words for anyone reading them aloud.
 */
const rotateHints = computed(() => (touchPrimary.value
  ? { counterClockwise: '', clockwise: '' }
  : {
      counterClockwise: 'Rotate counter-clockwise (Q while dragging)',
      clockwise: 'Rotate clockwise (E while dragging)',
    }))

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
        :spending="spending"
        :arriving="arriving"
        :source="source()"
        :drawer="drawerShape"
        :game-id="gameId"
        :yours="yours"
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
        @rearranged="onRearranged"
        @refused="refused = $event"
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
      Positioned over the plate bay these belong to: the hovered one where there is a pointer,
      every filled one where there is not. The wrapper ignores pointer events so it never
      steals a drag from the board; only the buttons themselves accept them.
    -->
    <div
      v-for="control in rotateControls"
      :key="control.slot"
      class="rotate-controls"
      :style="{ left: `${control.x}px`, top: `${control.y}px` }"
      @pointerenter="overButtons = true"
      @pointerleave="overButtons = false"
    >
      <HintTip
        :text="rotateHints.counterClockwise"
        side="below"
      >
        <button
          type="button"
          class="rotate-button"
          :style="boxStyle(rotateBoxes.left)"
          aria-label="Rotate plate counter-clockwise"
          @click="rotate(control.plateId, -1)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path :d="ROTATE_ICONS.counterClockwise" />
          </svg>
        </button>
      </HintTip>
      <HintTip
        :text="rotateHints.clockwise"
        side="below"
      >
        <button
          type="button"
          class="rotate-button"
          :style="boxStyle(rotateBoxes.right)"
          aria-label="Rotate plate clockwise"
          @click="rotate(control.plateId, 1)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path :d="ROTATE_ICONS.clockwise" />
          </svg>
        </button>
      </HintTip>
    </div>

    <NoticePanel
      :notice="refused"
      @dismiss="refused = null"
    />

    <RulesPanel
      :open="rulesOpen"
      @close="rulesOpen = false"
    />

    <GameSettingsPanel
      :open="gameSettingsOpen"
      :settings="settings ?? null"
      @close="gameSettingsOpen = false"
    />

    <Transition name="bar">
      <ActionBar
        v-if="announcing === null && !showResults && !gameOver && !settling"
        :watching-label="watchingLabel"
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
        :offers-undo="offersUndo"
        :can-undo="canTakeBack"
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

      <!--
        Two things a player reaches for mid-game and cannot get to otherwise: how the game works, and
        how *this* game was set up. Icons rather than words, because the strip above the board is the
        one place with no room to spare, and both carry a tooltip.
      -->
      <div class="helpers">
        <HintTip text="How the game is played">
          <button
            type="button"
            class="helper"
            aria-label="Game rules"
            @click="rulesOpen = true"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="mdiHelpCircleOutline" />
            </svg>
          </button>
        </HintTip>
        <HintTip text="What this game was set up with">
          <button
            type="button"
            class="helper"
            aria-label="This game's settings"
            @click="gameSettingsOpen = true"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="mdiCogOutline" />
            </svg>
          </button>
        </HintTip>
      </div>
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
        <span>{{ viewedScore.final === null ? 'banked' : 'score' }}</span>
        <strong>
          <span
            v-if="viewedScore.final !== null"
            class="seat-part"
          >{{ viewedScore.rounds }} + {{ viewedScore.final }} =</span>
          {{ viewedScore.total }}
        </strong>
      </p>

      <!--
        Everyone at the table: whose turn it is, which of them you are, and which you are looking at.

        The view sits on your own board and stays there, so this reads rather than being clicked.
        Clicking a seat pins the view to it — to see what somebody else is building — and clicking it
        again comes home.
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
            <!--
              Whose turn it is. The span is always there, holding its width, so the names below it do
              not shuffle sideways as the turn moves round the table.
            -->
            <span class="seat-mark">
              <svg
                v-if="row.active"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="mdiChevronRight" />
              </svg>
            </span>
            <PresenceMark
              :online="row.online"
              :name="row.name"
            />
            <span class="seat-name">{{ row.name }}</span>
            <!--
              Which one is you. Only at a table: in a solo game it would be the only row, saying
              something nobody could have wondered about.
            -->
            <span
              v-if="row.mine"
              class="seat-you"
            >you</span>
            <span class="seat-note">{{ row.passed ? 'passed' : '' }}</span>
            <!--
              Once the closing reckoning is in, the chip shows its working: the rounds, what the
              finished board added, and the sum. Two small numbers and one in the weight the single
              total had, so the thing being read at a glance is still the thing that matters.
            -->
            <span class="seat-score">
              <template v-if="row.final !== null">
                <span class="seat-part">{{ row.rounds }} + {{ row.final }} =</span>
              </template>
              <strong>{{ row.total }}</strong>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <!--
      The log is fetched before the game can be shown, and said so plainly if it cannot be.

      An unreachable table used to be impossible: the game was local, so it either ran or the page was
      broken. Now it is an ordinary thing that can happen — the server is not started, or it is
      running rules this page is not — and neither reads as anything at all without being said.
    -->
    <div
      v-if="loadingLog || trouble"
      class="table-state"
      role="status"
    >
      <p v-if="trouble">
        {{ trouble }}
      </p>
      <p v-else>
        Opening the game…
      </p>
      <RouterLink
        v-if="trouble"
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
  align-items: center;
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
  align-items: center;
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
 * Deliberately still touching the plate rather than floating clear above the drawer: where the
 * buttons are shown by hovering the plate, any gap between plate and button would let the hover
 * lapse while the pointer crossed it, and they would vanish as you reached.
 *
 * Size and position come from `rotateButtons.ts` as an inline style, because both depend on the
 * scale the drawer was laid out at and on whether anything can hover — neither of which is a
 * number a stylesheet can reach. What is left here is everything that does not move.
 */
.rotate-button {
  position: absolute;
  display: grid;
  place-items: center;
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
  width: var(--glyph);
  height: var(--glyph);
  /* The glyph inherits the button's colour, so hover restyles both at once. */
  fill: currentcolor;
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
  align-items: center;
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
  align-items: center;
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

/* Beside the menu link, in the strip's own quiet register — reference, not action. */
.helpers {
  display: flex;
  gap: 2px;
  align-items: center;
}

.helper {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.helper svg {
  width: 16px;
  height: 16px;
  fill: currentcolor;
}

.helper:hover {
  border-color: #33383f;
  color: #e8c878;
}

.helper:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .helper {
    transition: none;
  }
}

.seat-mark {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 10px;
  color: #8fe6c0;
}

.seat-mark svg {
  display: block;
  width: 14px;
  height: 14px;
  /* Wider than its box: a chevron is mostly air, and 10px of glyph reads as 6px of mark. */
  margin: 0 -2px;
  fill: currentcolor;
}

.seat-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Brass, because it is the one row that is about the reader rather than about the game — the same
 * colour the lobby marks your chair in. Quiet enough not to compete with the name it follows.
 */
.seat-you {
  color: #e8c878;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
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

/* The working, not the answer: dimmed to the weight of the labels around it. */
.seat-part {
  margin-right: 3px;
  color: #6b7382;
}

.seat-score strong {
  font-weight: inherit;
}

.seats button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 1px;
}
</style>
