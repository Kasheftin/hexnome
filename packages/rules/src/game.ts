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
import type { GameSettings } from './gameSettings'

/** Where every player's tableau grows from. The board is a rectangle centred here. */
export const BOARD_CENTRE: Axial = { q: 0, r: 0 }

export interface GameOptions {
  readonly settings: GameSettings
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
  /** Points banked, one entry per finished round. */
  banked: number[]
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
  | { readonly ok: true, readonly toDesk: DeskReturns }
  | { readonly ok: false, readonly error: string }

const nothing: DeskReturns = { tiles: [], plates: [] }
const done = (toDesk: DeskReturns = nothing): CommandResult => ({ ok: true, toDesk })
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
  const { settings, cells, sourceTilesPerLot } = options
  const players = Math.max(1, Math.min(settings.players, MAX_PLAYERS))
  const petals = createRandom(`${settings.seed}:petals`)
  const nextPetal = (): number => Math.floor(petals() * PETAL_COUNT)

  const source = createTableau({
    cells: [],
    drawerSlots: 0,
    plateSlots: 0,
    sourceLots: settings.platesPerRound,
    sourceTilesPerLot,
    idPrefix: 'src:',
  })

  const opening = openingPlateCodes(settings.seed, players)

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
      passed: false,
      paidAnchors: new Set(),
    }
  })

  return {
    options,
    round: 1,
    turn: 1,
    activeSeat: 0,
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
  for (const seat of state.seats) {
    seat.banked.push(targets ? scoreTargets(targets, seat.tableau.tilesOnBoard()) : 0)
    seat.passed = false
  }

  const rounds = state.options.agenda.length
  if (state.round >= rounds) {
    state.finished = true
  } else {
    state.round++
    state.turn = 1
    state.platesDealt = 0
    state.activeSeat = 0
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

  const seat = state.seats[command.seat]
  if (!seat) return refuse(`there is no seat ${command.seat}`)
  if (command.seat !== state.activeSeat) return refuse(`it is not seat ${command.seat}'s turn`)
  if (seat.passed) return refuse(`seat ${command.seat} has passed this round`)

  switch (command.kind) {
    case 'pass':
      seat.passed = true
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

  awardEnclosedAnchors(seat)

  const returns = { tiles, plates }
  const after = endTurn(state)
  return done({ tiles: [...returns.tiles, ...after.tiles], plates: [...returns.plates, ...after.plates] })
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
function awardEnclosedAnchors(seat: SeatState): void {
  const board = seat.tableau
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
      board.addStem(slot)
    }
  }
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
}

/**
 * The state a log means.
 *
 * This is the definition, and everything else is an optimisation of it: live play applies commands to
 * the state it already has, and that is only allowed because it produces the same answer. `game.spec`
 * checks exactly that after every command.
 *
 * A refused command during a replay is a bug in the log, not in the game, and is skipped rather than
 * thrown — a log that cannot be read at all is worse than one that reads as far as it can.
 */
export function replayGame(
  options: GameOptions,
  log: readonly Command[],
  { throughRound, onRefused }: ReplayOptions = {},
): GameState {
  const state = createGame(options)
  log.forEach((command, at) => {
    if (throughRound !== undefined && (state.round > throughRound || state.finished)) return
    const result = applyCommand(state, command)
    if (!result.ok) onRefused?.(command, result.error, at)
  })
  return state
}
