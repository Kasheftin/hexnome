/**
 * The whole game, as one state folded from one log.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The shape
 *
 * One shared source, and **one board and drawer per seat**. The design doc settles it: "the only
 * shared mutable state is the common source and the turn order. Each player's board and drawer are
 * private and independent." So every player holds the same state and differs only in which seat they
 * are *looking at* — a viewport, not a slice of the truth. Two players cannot disagree about the
 * source, and one cannot be in round 2 while another is in round 1, because there is one of each.
 *
 * **A tableau per seat rather than a seat-scoped view over one.** Attempt 1 did the latter and the
 * same bug came back four times: an unscoped question is not an error, it is answered for seat zero
 * (docs/backend-attempt1.md). Here `state.seats[2].tableau.tiles()` *cannot* return another seat's
 * tiles, because it is a different object. The question is not answered wrongly; it cannot be asked.
 *
 * ## The log
 *
 * `state = replayGame(options, log)`. The state is a derived value and is never stored, so it cannot
 * drift from the log — there is nothing for it to drift from. Rolling back a command a server
 * refuses is dropping it and folding again: no inverse operations to write, and none to get wrong.
 *
 * Commands are **intents**, not effects — `draft [t7, t9]`, not the six mutations that follow — so
 * applying one has to be deterministic. The one input that is not is what the desk deals, which is
 * why a `deal` **carries the desk's answer**. The dealer asks once; the fold never asks again.
 *
 * ## What is not in the log
 *
 * A placement is provisional until it is paid for: the item sits on the board so the player can see
 * what they are buying, and Cancel puts it back. That is one turn, and the log records **committed
 * turns** — a `put` carries the placement and its payment together. While a placement is provisional
 * the live state is ahead of the log, which is why a caller must undo the provisional move before
 * applying the command (see {@link Command} `put`). Every command boundary matches the fold; the
 * moments between them are one player's unfinished sentence.
 */
import { roundAgenda, scoreTargets, type Agenda } from './agenda'
import { canConfirmDraft, type DraftItem } from './draft'
import { MAX_PLAYERS, openingPlateCodes } from './deck'
import { tileFromCode } from './desk'
import type { Axial } from './hex'
import { PETAL_COUNT } from './plate'
import { canAffordPlacement, paymentCost, type Payer, type PaymentTarget } from './payment'
import { createRandom, type Random } from './random'
import { hasRoomToShift, pushLot, sourceContents } from './source'
import {
  createTableau,
  type PlateLocation,
  type PlateSpec,
  type Tableau,
  type TileLocation,
  type TileSpec,
} from './tableau'
import { effectiveFirstPassFine, SOLO, type GameSettings } from './gameSettings'

/** Where every player's tableau grows from. The board is a rectangle centred here. */
export const BOARD_CENTRE: Axial = { q: 0, r: 0 }

export interface GameOptions {
  readonly settings: GameSettings
  /**
   * The game's id — and the only seed the rules get.
   *
   * Two things here are dealt from a seed and both are **public**: which plate each player opens on,
   * which is on the board for everyone to see, and the petal stream, which is decoration. The id is
   * the honest thing to derive them from, because it is what both ends already share.
   *
   * The seed the *desks* are built from is a different value and a secret. It lives on the server,
   * never reaches a client, and nothing in this package has ever seen it — which is what stops a
   * player predicting the deal. Keeping the two apart is the whole arrangement, so they are not one
   * field with a comment.
   */
  readonly gameId: string
  /** The playfield, which is a scene decision rather than a rule — see BOARD_HALF_COLS. */
  readonly cells: readonly Axial[]
  readonly sourceTilesPerLot: number
  /** What each round scores for. Derived from the game id, and shared by every seat. */
  readonly agenda: Agenda
}

export interface SeatState {
  readonly seat: number
  readonly name: string
  /** This seat's board and drawer, and nothing else. */
  readonly tableau: Tableau
  /**
   * Points banked, one entry per finished round — **net of the first-pass fine**.
   *
   * Net rather than gross so that no caller has to remember to subtract it. `fined` beside it says
   * what was taken, for a panel that wants to show the working.
   */
  banked: number[]
  /** The first-pass fine charged in each finished round, parallel to `banked`. Mostly zeroes. */
  fined: number[]
  /** Points the board's anchors paid in each finished round, parallel to `banked`. */
  anchored: number[]
  /** Out of *this* round — cleared when the round closes, not a state of the game. */
  passed: boolean
  /**
   * Anchors this seat has already been paid for.
   *
   * An enclosure pays once. Keyed by the plate rather than by the cell for an internal anchor,
   * because a plate can be moved and takes its hole with it; an external anchor is a hole *between*
   * plates, which only ever closes, so its cell is stable.
   */
  readonly paidAnchors: Set<string>
}

export interface GameState {
  readonly options: GameOptions
  round: number
  /** Numbered within the round, so the header reads "round 2, turn 5". */
  turn: number
  activeSeat: number
  /**
   * Who left the round first, or null while everyone is still in.
   *
   * Two things hang off it: that seat is fined, and it opens the next round. Held on the state rather
   * than worked out from the seats because "who passed first" is an *order*, and `passed` is a set —
   * by the time the round closes every seat carries the same flag and the order is gone.
   *
   * Cleared when the round closes, like `passed`.
   */
  firstToPass: number | null
  /** Plates dealt into the source this round, against `platesPerRound`. */
  platesDealt: number
  /** True once the last seat has passed and the round has been closed. */
  finished: boolean
  /** The shared source: lots only, no board and no drawer. */
  readonly source: Tableau
  readonly seats: readonly SeatState[]
  /**
   * What each face-down plate is carrying.
   *
   * The model deliberately does not hold it — `Plate.faceDown` means "this plate's token is not known
   * here" — so it waits here until the plate turns over. In a served game this map is the server's and
   * a client is told a token only when its lot is picked clean.
   */
  readonly hidden: Map<string, PlateSpec>
  /** The petal stream: cosmetic, and advanced once per plate dealt so a replay matches. */
  petals: Random
}

/**
 * One committed thing.
 *
 * Everything that changes the state is here, dealer included, or the fold would be incomplete.
 */
export type Command =
  /**
   * A lot pushed onto the source: a face-down plate under some loose tiles.
   *
   * Carries what the desk dealt, because that is the one thing a replay cannot work out for itself.
   * The plate's petal is *not* carried — it comes from the state's own stream, so there is one source
   * for each fact rather than two that could disagree.
   */
  | { readonly kind: 'deal', readonly plate: TileSpec, readonly tiles: readonly TileSpec[] }
  /** A draft: source ids, tiles and at most one revealed plate, moved into the seat's drawer. */
  | { readonly kind: 'draft', readonly seat: number, readonly ids: readonly string[] }
  /**
   * A placement and the payment for it, together, because they are one turn.
   *
   * `item` is in the seat's drawer when this applies. A caller that placed it provisionally must put
   * it back first — otherwise the live path and the replay path start from different boards, and only
   * one of them can be right.
   */
  | {
    readonly kind: 'put'
    readonly seat: number
    readonly item: { readonly kind: 'tile' | 'plate', readonly id: string }
    readonly to: TileLocation | PlateLocation
    /** Drawer ids spent on it, in the order the player picked them. */
    readonly paying: readonly string[]
    /**
     * The plate's rotation as it was placed. Ignored for a tile.
     *
     * Turning a plate in its bay is free, repeatable and not a turn, so it is not a command of its
     * own — but it decides which cell each petal lands on, and therefore whether the placement is
     * legal at all. Without it here a replay meets an unturned plate, refuses the placement, and
     * rebuilds a board with a tile missing. The only place that shows is the score.
     */
    readonly rotation?: number
  }
  /** Out of the round. Not a skipped turn — see docs/game-design.md. */
  | { readonly kind: 'pass', readonly seat: number }
  /**
   * Tidying your own drawer. **Not a turn**, and the only command that is not.
   *
   * Allowed whenever the game is running: during somebody else's turn, after you have passed, while
   * the score sheet is up, and as often as you like. Nothing about the round moves.
   *
   * It is in the log rather than kept beside it because drawer order is not only decoration — a draft
   * fills `freeDrawerSlots()` in order and a minted stem takes the first of them, so where the next
   * tile lands depends on how you left the last one. A copy kept outside the log would put the
   * server's fold and your screen in different slots.
   *
   * Carries the **whole arrangement** rather than the swap that produced it. Absolute means applying
   * it twice is applying it once, so a client may seat things the moment you let go of a tile and
   * fold the same command again when it comes back; and a rearrangement that lost a race can be
   * re-derived from the drawer as it now stands rather than replayed against a board that moved.
   * See {@link Tableau.arrangeDrawer}, which will only accept a permutation.
   */
  | {
    readonly kind: 'arrange'
    readonly seat: number
    /** Item id per tile slot, null for an empty one. Tiles and stems share this index. */
    readonly drawer: readonly (string | null)[]
    /** Plate id per bay, null for an empty one. */
    readonly bays: readonly (string | null)[]
  }
  /**
   * Take the last turn back. Singleplayer only, and only when the settings allow it.
   *
   * **Appended, never a deletion.** The log is read by an append-only cursor (`useGameSync.ts`), so a
   * client holding seq 40 would never learn that 38–40 had been removed; deleting would need an epoch
   * on the game and a full reload every time. As a row it costs nothing: the chain, the `cmdId` retry
   * path and `@@unique([gameId, prevSeq])` all keep working, and the history survives for the score
   * sheet's `throughRound` replay to walk.
   *
   * **Resolved by {@link effectiveLog}, not applied.** It cancels commands rather than changing the
   * board, which is a property of the log and not of a position — so `applyCommand` refuses it and the
   * fold never sees one. That is what keeps `applyCommand` a pure per-command function.
   *
   * Carries a seat for authorization only: the server checks it against the seat token, exactly as it
   * does for a turn.
   */
  | { readonly kind: 'undo', readonly seat: number }

/**
 * A command a **player** may issue: everything except the deal.
 *
 * The deal carries what the desk dealt, and the desk is the server's — one a client could submit
 * would be a client choosing its own tiles. Saying so in the type means the refusal is not only a
 * check in `parseCommand` but a thing the compiler will not let a caller forget.
 */
export type PlayerCommand = Exclude<Command, { readonly kind: 'deal' }>

/**
 * What a command did that the caller has to act on.
 *
 * Only the desk. Spent and swept material goes back to the pile, and the pile is on a server — so the
 * state cannot put it there itself. Deterministic like everything else, so a replay produces the same
 * effects and simply ignores them.
 */
export interface DeskReturns {
  readonly tiles: readonly TileSpec[]
  readonly plates: readonly PlateSpec[]
}

export type CommandResult =
  | {
    readonly ok: true
    readonly toDesk: DeskReturns
    /**
     * Stems this command minted, by id — an enclosure paying out.
     *
     * Reported rather than left to be noticed. They appear in a drawer from nowhere, and the only
     * way to tell them from the ones already there is to have been told, which is what lets the view
     * show them arriving instead of blinking into existence.
     */
    readonly awarded: readonly string[]
  }
  | { readonly ok: false, readonly error: string }

const nothing: DeskReturns = { tiles: [], plates: [] }
const done = (toDesk: DeskReturns = nothing, awarded: readonly string[] = []): CommandResult =>
  ({ ok: true, toDesk, awarded })
const refuse = (error: string): CommandResult => ({ ok: false, error })

function specOf(code: number): TileSpec {
  const spec = tileFromCode(code)
  if (!spec) throw new Error(`${code} is not a tile code`)
  return spec
}

/**
 * A fresh game: empty source, and every seat opened.
 *
 * The opening position is not in the log because it is not a decision — it follows from the settings
 * and the seed, so a replay rebuilds it before applying anything.
 */
export function createGame(options: GameOptions): GameState {
  const { settings, cells, sourceTilesPerLot, gameId } = options
  const players = Math.max(1, Math.min(settings.players, MAX_PLAYERS))
  const petals = createRandom(`${gameId}:petals`)
  const nextPetal = (): number => Math.floor(petals() * PETAL_COUNT)

  const source = createTableau({
    cells: [],
    drawerSlots: 0,
    plateSlots: 0,
    sourceLots: settings.platesPerRound,
    sourceTilesPerLot,
    idPrefix: 'src:',
  })

  const opening = openingPlateCodes(gameId, players)

  const seats = Array.from({ length: players }, (_, seat): SeatState => {
    const tableau = createTableau({
      cells,
      drawerSlots: settings.tileSlots,
      plateSlots: settings.plateSlots,
      placementRule: settings.placementRule,
      stemsPerInternalAnchor: settings.stemsPerInternalAnchor,
      stemsPerExternalAnchor: settings.stemsPerExternalAnchor,
      strictEnclosureBonus: settings.strictEnclosureBonus,
      idPrefix: `${seat}:`,
    })

    /*
     * The starting plate goes straight to the board: it is where the tableau grows from, and without
     * it every later plate has nothing to connect to and Put has nowhere to go. Held back from the
     * plate desk at creation, so it can never also be dealt into the source.
     */
    const code = opening[seat]
    const centre = tableau.addPlate({ kind: 'board', hole: BOARD_CENTRE })
    if (code !== undefined && centre) {
      const petal = nextPetal()
      // `fixed`: the plate's own tile, part of the plate and never separable from it.
      tableau.addTile(specOf(code), { kind: 'onPlate', plateId: centre.id, petal }, { fixed: true })
    }

    // Stems take ordinary tile slots, so they are a cost as well as a gift.
    for (let i = 0; i < settings.initialStems; i++) {
      const slot = tableau.freeDrawerSlots()[0]
      if (slot === undefined) break
      tableau.addStem(slot)
    }

    return {
      seat,
      name: settings.playerNames[seat] ?? `Player ${seat + 1}`,
      tableau,
      banked: [],
      fined: [],
      anchored: [],
      passed: false,
      paidAnchors: new Set(),
    }
  })

  return {
    options,
    round: 1,
    turn: 1,
    activeSeat: 0,
    firstToPass: null,
    platesDealt: 0,
    finished: false,
    source,
    seats,
    hidden: new Map(),
    petals,
  }
}

/** The seat whose turn it is. */
export function activeSeat(state: GameState): SeatState {
  return state.seats[state.activeSeat] as SeatState
}

/**
 * Does the source want another lot before this turn is played?
 *
 * Asked by the caller rather than answered here, because filling it means asking the desk — which is
 * a network call, and the state cannot make one. The conditions are the same ones a solo game used:
 * the newest lot has been touched, the round has plates left, and there is room to shift into.
 */
export function needsDeal(state: GameState): boolean {
  if (state.finished) return false
  if (state.platesDealt >= state.options.settings.platesPerRound) return false
  if (!hasRoomToShift(state.source)) return false
  // Nothing dealt yet this round, or the top lot has been drafted from.
  if (state.platesDealt === 0) return true
  return topLotTouched(state)
}

function topLotTouched(state: GameState): boolean {
  const plate = state.source.plateInSourceLot(0)
  if (!plate) return true
  return state.source.tilesInSourceLot(0).length < state.options.sourceTilesPerLot
}

/** Every seat that has not passed, in seating order from the one after `from`. */
function nextActiveSeat(state: GameState, from: number): number {
  const count = state.seats.length
  for (let step = 1; step <= count; step++) {
    const seat = (from + step) % count
    if (!state.seats[seat]?.passed) return seat
  }
  return from
}

/** What the source is showing, as the draft rules want it. */
export function draftItems(state: GameState): DraftItem[] {
  const { tiles, plates } = sourceContents(state.source)
  const items: DraftItem[] = tiles.map(tile => ({
    id: tile.id,
    kind: 'tile',
    color: tile.color,
    value: tile.value,
  }))
  for (const plate of plates) {
    if (plate.faceDown) continue
    const token = state.source.plateToken(plate.id)
    if (token) items.push({ id: plate.id, kind: 'plate', color: token.color, value: token.value })
  }
  return items
}

/**
 * Turn over any plate whose lot has been picked clean.
 *
 * Not a command: it follows from the board, so a replay reaches it on its own. The token comes from
 * `hidden`, because a face-down plate genuinely has none in the model.
 */
function revealEmptiedLots(state: GameState): void {
  for (let lot = 0; lot < state.options.settings.platesPerRound; lot++) {
    const plate = state.source.plateInSourceLot(lot)
    if (!plate?.faceDown) continue
    if (state.source.tilesInSourceLot(lot).length > 0) continue
    const token = state.hidden.get(plate.id)
    if (!token) continue
    if (state.source.revealPlate(plate.id, token, token.petal)) state.hidden.delete(plate.id)
  }
}

/**
 * What a board's anchors pay this round, at the rates the game was set up with.
 *
 * **Exported so there is one of it.** The results panel prints this figure beside the tally it
 * counted out, and a second copy written by hand is how the panel and the bank come to disagree —
 * which has happened here before, with the payment purse.
 *
 * Every anchor counts, enclosed or not. The stem rates pay for closing a ring of six around a hole;
 * this pays for the hole being there at all, which is what makes placing another plate worth a turn.
 */
export function scoreAnchors(board: Tableau, settings: {
  pointsPerInternalAnchor: number
  pointsPerExternalAnchor: number
}): number {
  let points = 0
  for (const anchor of board.anchors()) {
    points += anchor.kind === 'internal'
      ? settings.pointsPerInternalAnchor
      : settings.pointsPerExternalAnchor
  }
  return points
}

/**
 * Close the round: sweep the source, score every board, bank it.
 *
 * Reached only when the last seat passes, so it is a consequence rather than a command of its own —
 * one fewer thing that can be issued out of order.
 */
function closeRound(state: GameState): DeskReturns {
  const tiles: TileSpec[] = []
  const plates: PlateSpec[] = []

  const { tiles: loose, plates: standing } = sourceContents(state.source)
  for (const tile of loose) {
    const receipt = state.source.discard(tile.id)
    if (receipt) tiles.push(...receipt.tiles)
  }
  for (const plate of standing) {
    const receipt = state.source.discard(plate.id)
    if (!receipt) continue
    tiles.push(...receipt.tiles)
    const recovered = receipt.plate ?? state.hidden.get(plate.id) ?? null
    state.hidden.delete(plate.id)
    if (recovered) plates.push(recovered)
  }

  const targets = roundAgenda(state.options.agenda, state.round)
  const fine = effectiveFirstPassFine(state.options.settings)
  for (const seat of state.seats) {
    const charged = seat.seat === state.firstToPass ? fine : 0
    const scored = targets ? scoreTargets(targets, seat.tableau.tilesOnBoard()) : 0
    const anchors = scoreAnchors(seat.tableau, state.options.settings)
    seat.banked.push(scored + anchors - charged)
    seat.fined.push(charged)
    seat.anchored.push(anchors)
    seat.passed = false
  }

  /*
   * Whoever left first opens the next round — first pick of a source nobody has touched, which is what
   * the fine above buys. Read before `firstToPass` is cleared, and defaulted to seat 0 for the case
   * that cannot arise in play: a round closes only when the last seat passes, so somebody passed.
   */
  const opensNext = state.firstToPass ?? 0
  state.firstToPass = null

  const rounds = state.options.agenda.length
  if (state.round >= rounds) {
    state.finished = true
  } else {
    state.round++
    state.turn = 1
    state.platesDealt = 0
    state.activeSeat = opensNext
  }
  return { tiles, plates }
}

/** Advance past a completed turn: reveal what is now bare, then hand over. */
function endTurn(state: GameState): DeskReturns {
  revealEmptiedLots(state)
  if (state.seats.every(seat => seat.passed)) return closeRound(state)
  state.activeSeat = nextActiveSeat(state, state.activeSeat)
  state.turn++
  return nothing
}

/**
 * Apply one command, or refuse it.
 *
 * **Validation and application are one function.** Attempt 1 split them and its fifth seat bug was a
 * guard that was written, unit-tested, described in a commit message as closing a hole, and never
 * called from the service (docs/backend-attempt1.md). A check the replay path can skip is a check
 * that stops being true. So this is the client's rule today and the server's authority later, and
 * there is one of it.
 *
 * A refusal changes **nothing**: every check runs before the first mutation. A half-applied command
 * is worse than a refused one, because the log and the board then disagree about what happened.
 */
export function applyCommand(state: GameState, command: Command): CommandResult {
  if (state.finished) return refuse('the game is over')

  if (command.kind === 'deal') {
    if (state.platesDealt >= state.options.settings.platesPerRound) {
      return refuse('this round has dealt all its plates')
    }
    if (!hasRoomToShift(state.source)) return refuse('the source has no room to shift')

    const petal = Math.floor(state.petals() * PETAL_COUNT)
    const token: PlateSpec = { ...command.plate, petal }
    // `pushLot` shifts the column down itself. Doing it here as well moved everything twice and left
    // a hole between the new lot and the one before it.
    if (!pushLot(state.source, command.tiles)) return refuse('the lot would not fit')

    const plate = state.source.plateInSourceLot(0)
    if (plate) state.hidden.set(plate.id, token)
    state.platesDealt++
    return done()
  }

  /*
   * An undo is a fact about the **log**, not a move on a board: it cancels commands rather than
   * changing a position, and {@link effectiveLog} resolves it away before any fold begins. Reaching
   * here means somebody folded a raw log, and the position that produces is not the one the log means
   * — so it is refused out loud rather than skipped quietly.
   */
  if (command.kind === 'undo') return refuse('an undo is resolved by the log, not applied to a state')

  const seat = state.seats[command.seat]
  if (!seat) return refuse(`there is no seat ${command.seat}`)

  /*
   * **Above the turn guards, because tidying your drawer is not taking a turn.** Its own affair
   * entirely: it touches one seat's drawer, moves nothing on the board, and leaves `turn`,
   * `activeSeat` and `firstToPass` exactly as it found them. So a player waiting for their turn, or
   * out of the round already, may still sort their tiles.
   */
  if (command.kind === 'arrange') {
    if (!seat.tableau.arrangeDrawer(command.drawer, command.bays)) {
      return refuse(`that is not an arrangement of seat ${command.seat}'s drawer`)
    }
    return done()
  }

  if (command.seat !== state.activeSeat) return refuse(`it is not seat ${command.seat}'s turn`)
  if (seat.passed) return refuse(`seat ${command.seat} has passed this round`)

  switch (command.kind) {
    case 'pass':
      seat.passed = true
      // First out of the round, which decides both the fine and who opens the next one.
      if (state.firstToPass === null) state.firstToPass = seat.seat
      return done(endTurn(state))

    case 'draft':
      return applyDraft(state, seat, command.ids)

    case 'put':
      return applyPut(state, seat, command)
  }
}

function applyDraft(state: GameState, seat: SeatState, ids: readonly string[]): CommandResult {
  if (ids.length === 0) return refuse('a draft takes something')
  if (!canConfirmDraft(draftItems(state), ids)) return refuse('that is not a complete draft')

  /*
   * Everything is checked before anything moves, including room. A draft that ran out of slots
   * half-way would leave tiles nowhere: gone from the source, never in a drawer.
   */
  const slots = seat.tableau.freeDrawerSlots()
  const bays = seat.tableau.freePlateSlots()
  let wantedSlots = 0
  let wantedBays = 0
  for (const id of ids) {
    if (state.source.plate(id)) wantedBays++
    else if (state.source.tile(id)) wantedSlots++
    else return refuse(`${id} is not in the source`)
  }
  if (wantedSlots > slots.length) return refuse('not enough drawer slots for that draft')
  if (wantedBays > bays.length) return refuse('not enough plate bays for that draft')

  const takeSlot = [...slots]
  const takeBay = [...bays]
  for (const id of ids) {
    const plate = state.source.plate(id)
    if (plate) {
      // A plate travels with its own token, so both are carried across under their own ids.
      const token = state.source.plateToken(id)
      const bay = takeBay.shift() as number
      const rotation = plate.rotation
      state.source.discard(id)
      const landed = seat.tableau.addPlate({ kind: 'plateSlot', slot: bay }, { rotation })
      if (landed && token) {
        seat.tableau.addTile(
          { color: token.color, value: token.value },
          { kind: 'onPlate', plateId: landed.id, petal: token.location.kind === 'onPlate' ? token.location.petal : 0 },
          { fixed: true, id: token.id },
        )
      }
      continue
    }
    const receipt = state.source.discard(id)
    const spec = receipt?.tiles[0]
    if (!spec) continue
    // The id crosses with the tile, so the scene sees one piece moving rather than two events.
    seat.tableau.addTile(spec, { kind: 'drawer', slot: takeSlot.shift() as number }, { id })
  }

  return done(endTurn(state))
}

function applyPut(
  state: GameState,
  seat: SeatState,
  command: Extract<Command, { kind: 'put' }>,
): CommandResult {
  const { item, to, paying } = command
  const board = seat.tableau

  /*
   * Turn it first: legality is asked of the board this placement will actually make, and a plate
   * points its petals differently depending on how it is turned. Restored below if anything refuses,
   * so a refusal still changes nothing.
   */
  const wasTurned = item.kind === 'plate' ? board.plate(item.id)?.rotation : undefined
  if (item.kind === 'plate' && command.rotation !== undefined && wasTurned !== undefined) {
    board.rotatePlate(item.id, command.rotation - wasTurned)
  }
  const unturn = (): void => {
    if (item.kind !== 'plate' || wasTurned === undefined) return
    const now = board.plate(item.id)?.rotation
    if (now !== undefined && now !== wasTurned) board.rotatePlate(item.id, wasTurned - now)
  }

  const target: PaymentTarget | undefined = item.kind === 'tile'
    ? tileTarget(board, item.id)
    : plateTarget(board, item.id)
  if (!target) { unturn(); return refuse(`${item.id} is not in seat ${seat.seat}'s drawer`) }

  const purse = paymentPurse(board, item.id)
  if (!canAffordPlacement(target, purse)) { unturn(); return refuse('that cannot be paid for') }

  const cost = paymentCost(target)
  if (paying.length !== cost) {
    unturn()
    return refuse(`that costs ${cost}, and ${paying.length} were offered`)
  }
  for (const id of paying) {
    if (id === item.id) { unturn(); return refuse('an item cannot pay for itself') }
    if (!purse.some(payer => payer.id === id)) { unturn(); return refuse(`${id} cannot be spent`) }
  }

  /*
   * The reward, weighed against the drawer this turn will actually leave behind.
   *
   * The placement rules were asked once already, at the drop, when nobody knew what would pay for
   * this — so they answered with the best a payment could do. Now the payment is chosen, and it may
   * do less: a plate spent out of its bay frees a bay, and stems are minted into drawer slots.
   *
   * Asked *before* anything moves. `awardEnclosedAnchors` mints what it can and drops the rest on the
   * floor, so a reward that does not fit has to be refused rather than half-paid — and a refusal must
   * leave the board untouched.
   */
  const emptying = paying.filter(id => {
    return purse.find(payer => payer.id === id)?.kind !== 'plate'
  }).length
  const cramped = item.kind === 'tile'
    ? board.whyNotPlaceTile(to as TileLocation, item.id, emptying)?.kind === 'rewardWontFit'
    // A plate has no `whyNot`, so the reason is read from the difference: refused with this payment
    // but allowed with the best one is the reward and nothing else. Anything refused either way is
    // some other rule, and falls through to the move below to say so in its own words.
    : board.canPlacePlate(to as PlateLocation, item.id)
      && !board.canPlacePlate(to as PlateLocation, item.id, emptying)
  if (cramped) { unturn(); return refuse('the reward would not fit in the drawer') }

  const placed = item.kind === 'tile'
    ? board.moveTile(item.id, to as TileLocation)
    : board.movePlate(item.id, to as PlateLocation)
  if (!placed) { unturn(); return refuse('that placement is not allowed') }

  const tiles: TileSpec[] = []
  const plates: PlateSpec[] = []
  for (const id of paying) {
    const receipt = board.discard(id)
    if (!receipt) continue
    tiles.push(...receipt.tiles)
    // Stems are the deliberate exception: an anchor minted them, so no desk is owed them back.
    if (receipt.kind === 'plate' && receipt.plate) plates.push(receipt.plate)
  }

  const awarded = awardEnclosedAnchors(seat)

  const returns = { tiles, plates }
  const after = endTurn(state)
  return done(
    { tiles: [...returns.tiles, ...after.tiles], plates: [...returns.plates, ...after.plates] },
    awarded,
  )
}

/**
 * Hand out stems for any anchor this seat has enclosed and not yet been paid for.
 *
 * On payment rather than on the placement landing: until the price is paid the placement is only
 * provisional, so cancelling has to leave the player with nothing gained.
 *
 * Every anchor is checked rather than only the one just touched. It costs nothing at this scale and
 * the award then cannot be missed by some future move that encloses a plate another way.
 * `canPlaceTile` has already refused any placement whose reward would not fit, so the slots are there.
 */
function awardEnclosedAnchors(seat: SeatState): string[] {
  const board = seat.tableau
  const minted: string[] = []
  for (const anchor of board.anchors()) {
    const key = anchor.kind === 'external'
      ? `external:${anchor.cell.q},${anchor.cell.r}`
      : `internal:${board.coverageAt(anchor.cell)?.plateId ?? `${anchor.cell.q},${anchor.cell.r}`}`
    if (seat.paidAnchors.has(key) || !board.anchorIsEnclosed(anchor.cell)) continue
    seat.paidAnchors.add(key)

    // The rate for its kind, plus the strict bonus if its ring earns one.
    for (let i = 0; i < board.anchorReward(anchor); i++) {
      const slot = board.freeDrawerSlots()[0]
      if (slot === undefined) break
      const stem = board.addStem(slot)
      if (stem) minted.push(stem.id)
    }
  }
  return minted
}

/** What a drawer tile costs to place. A plate is described by the token it carries. */
function tileTarget(board: Tableau, id: string): PaymentTarget | undefined {
  const tile = board.tile(id)
  if (!tile || tile.location.kind !== 'drawer') return undefined
  return { color: tile.color, value: tile.value }
}

function plateTarget(board: Tableau, id: string): PaymentTarget | undefined {
  const plate = board.plate(id)
  if (!plate || plate.location.kind !== 'plateSlot') return undefined
  const token = board.plateToken(id)
  if (!token) return undefined
  return { color: token.color, value: token.value }
}

/**
 * Everything in a drawer that could pay, minus the item being placed.
 *
 * **Exported so there is one of it.** The view needs the same list to light the chips a player may
 * spend, and a second copy written by hand is how a payment came to be offered and then refused: that
 * one omitted a tile's colour, so every purple in the drawer could only pay for something sharing its
 * *value*, and paying for a purple with purples was impossible.
 *
 * A payer is described completely or not at all. Stems carry neither colour nor value, which is what
 * makes them wild — see `payment.ts`.
 */
export function paymentPurse(board: Tableau, exclude?: string): Payer[] {
  const purse: Payer[] = []
  for (const tile of board.tiles()) {
    if (tile.id === exclude || tile.location.kind !== 'drawer') continue
    purse.push({ id: tile.id, kind: 'tile', color: tile.color, value: tile.value })
  }
  for (const stem of board.stems()) purse.push({ id: stem.id, kind: 'stem' })
  for (const plate of board.plates()) {
    if (plate.id === exclude || plate.location.kind !== 'plateSlot') continue
    const token = board.plateToken(plate.id)
    if (token) purse.push({ id: plate.id, kind: 'plate', color: token.color, value: token.value })
  }
  return purse
}

export interface ReplayOptions {
  /** Stop once this round has closed. For showing a finished round beside the board as it then was. */
  readonly throughRound?: number
  /**
   * Told about any command the replay could not apply.
   *
   * A refused command means the rebuilt game is **not** the game that was played — a placement that
   * will not go back leaves a tile missing, and the only place that shows is a score that is quietly
   * a few points short. Skipping it silently is how that stays hidden, so a caller can ask to hear.
   */
  readonly onRefused?: (command: Command, error: string, at: number) => void
  /**
   * Told about every command that *did* apply, and what it did.
   *
   * The fold already computes this and then drops it. Undo needs it back: reversing a turn means
   * knowing what that turn sent to the desk, and the alternative is applying it a second time
   * somewhere else — a second answer to a question with one right answer.
   */
  readonly onApplied?: (step: ReplayStep) => void
}

/**
 * What the desks handed over, as the desks think of it.
 *
 * A plate is a `TileSpec` here rather than a `PlateSpec` on purpose: a desk is a bag of codes and a
 * petal is the *state's* — dealt from its own stream, never from the bag (see the `deal` command). So
 * a plate going back to the desk has no petal to give, and inventing one to satisfy a type would be
 * writing down a fact that is not true.
 */
export interface DeskDrawn {
  readonly tiles: readonly TileSpec[]
  readonly plates: readonly TileSpec[]
}

/** One applied command, and what folding it did. See {@link ReplayOptions.onApplied}. */
export interface ReplayStep {
  readonly command: Command
  /** Index into the **effective** log — undone commands are not in it. */
  readonly at: number
  /** The round this was played in. Not the round after: a pass can close one. */
  readonly roundBefore: number
  readonly toDesk: DeskReturns
  readonly awarded: readonly string[]
}

/** The kinds that are a turn. An `arrange` is tidying and a `deal` is the server's; neither is one. */
const TURN_KINDS: ReadonlySet<Command['kind']> = new Set(['draft', 'put', 'pass'])

export function isTurn(command: Command): boolean {
  return TURN_KINDS.has(command.kind)
}

/**
 * The log with its undos resolved: what actually counts.
 *
 * Each `undo` cancels the last **turn still standing** and everything appended after it — the deals it
 * caused and any tidying since. Walking forwards and keeping a live list is what makes repeated undos
 * fall out for free: the second one finds the turn before the first, because the first is no longer in
 * the list to be found.
 *
 * An `undo` with nothing left to cancel is dropped. It cannot arrive from a client — the server
 * refuses it — and a log that reads as far as it can beats one that throws.
 *
 * The undos themselves never survive into the result, which is why `applyCommand` never has to know
 * what one is.
 */
export function effectiveLog(log: readonly Command[]): Command[] {
  const live: number[] = []
  for (let at = 0; at < log.length; at++) {
    const command = log[at]
    if (!command) continue
    if (command.kind !== 'undo') {
      live.push(at)
      continue
    }
    let target = live.length - 1
    while (target >= 0 && !isTurn(log[live[target] as number] as Command)) target--
    // Nothing to take back.
    if (target < 0) continue
    // Drop that turn and everything after it.
    live.length = target
  }
  return live.map(at => log[at] as Command)
}

/**
 * The state a log means.
 *
 * This is the definition, and everything else is an optimisation of it: live play applies commands to
 * the state it already has, and that is only allowed because it produces the same answer. `game.spec`
 * checks exactly that after every command.
 *
 * **Undos are resolved here**, so every caller gets them from one place and none has to remember to
 * ask. Resolving is idempotent, so folding an already-resolved log is safe.
 *
 * A refused command during a replay is a bug in the log, not in the game, and is skipped rather than
 * thrown — a log that cannot be read at all is worse than one that reads as far as it can.
 */
export function replayGame(
  options: GameOptions,
  log: readonly Command[],
  { throughRound, onRefused, onApplied }: ReplayOptions = {},
): GameState {
  const state = createGame(options)
  effectiveLog(log).forEach((command, at) => {
    if (throughRound !== undefined && (state.round > throughRound || state.finished)) return
    const roundBefore = state.round
    const result = applyCommand(state, command)
    if (!result.ok) {
      onRefused?.(command, result.error, at)
      return
    }
    onApplied?.({ command, at, roundBefore, toDesk: result.toDesk, awarded: result.awarded })
  })
  return state
}

/**
 * What taking the last turn back would mean.
 *
 * Everything the server needs in one fold: which commands stop counting, and what has to be put back
 * on the desks. The desks are mutable rows outside the log — the one part of this game that a re-fold
 * cannot fix by itself — so undo has to hand back exactly what those commands took and took back.
 */
export interface UndoPlan {
  /** The turn being taken back, or null when there is nothing to take back. */
  readonly turn: Command | null
  /** That turn and everything appended after it, in log order. */
  readonly cancelled: readonly Command[]
  /**
   * What the cancelled commands sent **to** the desks, to be taken back out of the discard pile.
   *
   * The turn's payment and, when the turn closed a round, its sweep.
   */
  readonly returned: DeskReturns
  /** What the cancelled deals took **from** the desks, to be put back on the front. */
  readonly dealt: DeskDrawn
  /** Is the turn part of the round in progress? Undo does not reach back past a closed round. */
  readonly withinRound: boolean
}

const NO_UNDO: UndoPlan = {
  turn: null,
  cancelled: [],
  returned: nothing,
  dealt: { tiles: [], plates: [] },
  withinRound: false,
}

/**
 * Plan an undo against a log, without taking it.
 *
 * One fold answers everything, which is the point: the client asks it to decide whether the button is
 * live, and the server asks it to decide whether the request is allowed and what to give the desks
 * back. Two callers, one answer, no chance of them disagreeing about which turn is next to go.
 */
export function planUndo(options: GameOptions, log: readonly Command[]): UndoPlan {
  const effective = effectiveLog(log)
  const steps: ReplayStep[] = []
  const state = replayGame(options, effective, { onApplied: step => steps.push(step) })

  let at = steps.length - 1
  while (at >= 0 && !isTurn((steps[at] as ReplayStep).command)) at--
  if (at < 0) return NO_UNDO

  const turnStep = steps[at] as ReplayStep
  const cancelledSteps = steps.slice(at)
  const tiles: TileSpec[] = []
  const plates: PlateSpec[] = []
  const drawnTiles: TileSpec[] = []
  const drawnPlates: TileSpec[] = []

  for (const step of cancelledSteps) {
    tiles.push(...step.toDesk.tiles)
    plates.push(...step.toDesk.plates)
    if (step.command.kind === 'deal') {
      drawnTiles.push(...step.command.tiles)
      // Stripped to what the bag deals. The petal came from the state's stream, not from the desk.
      drawnPlates.push({ color: step.command.plate.color, value: step.command.plate.value })
    }
  }

  return {
    turn: turnStep.command,
    cancelled: cancelledSteps.map(step => step.command),
    returned: { tiles, plates },
    dealt: { tiles: drawnTiles, plates: drawnPlates },
    /*
     * The round the turn was played in, against the round now. A pass that closed a round therefore
     * fails this: its round is over, and "the round in progress" no longer contains it.
     */
    withinRound: !state.finished && turnStep.roundBefore === state.round,
  }
}

/**
 * May a turn be taken back right now?
 *
 * **The whole gate, in one place.** The button asks it to decide whether to light up and the server
 * asks it to decide whether to accept — so an undo the player is offered is one the server will take,
 * and there is no second copy of the rule to fall out of step with the first.
 *
 * Singleplayer only, and only when the game was set up for it: over a shared source, one player
 * rewinding a draft the others have already seen is not a mechanic.
 */
export function canUndo(options: GameOptions, log: readonly Command[]): boolean {
  if (!options.settings.allowUndo) return false
  if (options.settings.players > SOLO) return false
  const plan = planUndo(options, log)
  return plan.turn !== null && plan.withinRound
}
