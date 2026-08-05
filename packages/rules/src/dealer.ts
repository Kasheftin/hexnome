/**
 * The deck as play consumes it: what has been drawn, what is waiting in the piles, and what each
 * face-down plate is secretly carrying.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## Why this exists as a thing rather than as a few variables
 *
 * It used to be four locals in the game view — two bags, a counter and a `Map` of hidden tokens —
 * and that was the one part of a game the journal could not rebuild. Replaying the log restored
 * every tile on the table and left the bags at position zero, so the next deal after a refresh would
 * have been wrong. A game was therefore never really restorable, however complete its log.
 *
 * Gathering the four into one object with one mutator each makes the state a **fold over the log**,
 * and {@link replayDealer} performs that fold.
 *
 * ## What makes the fold possible
 *
 * Two things the log alone does not carry, both recovered from the fact that the log is grouped into
 * commands — one command per turn:
 *
 * - **Draws are batched.** `draw(4)` and four `draw(1)`s leave different states, because a reshuffle
 *   landing mid-draw sees a different pile. Replaying has to make the same calls the original made,
 *   so a lot-deal is recognised as a unit and drawn for as a unit.
 * - **Discards are batched.** The pile sorts each batch as it arrives, which is what keeps a
 *   reshuffle independent of the order the player happened to click. One batch per *event*, and a
 *   turn holds at most one payment — so a command's discards are exactly one batch. A flat list of
 *   entries could not have told us where the batches ended; the command boundary can.
 */
import { createDeck, dealStartingPlates, type DealtPlate } from './deck'
import { applyEntry, type LogEntry } from './gameLog'
import { createRecyclingBag } from './recycling'
import { tableauOptionsFor } from './setup'
import { hasRoomToShift, platesToReveal, pushLot } from './source'
import {
  createTableau,
  seatOf,
  SOLO_SEAT,
  type PlateSpec,
  type Seat,
  type Tableau,
  type TileLocation,
  type TileSpec,
} from './tableau'
import type { GameSettings } from './gameSettings'

/** Seats dealt an opening plate. One, until there are more. */
const SEATS = 1

export interface Dealer {
  /**
   * Push a fresh lot onto the source: a face-down plate under a heap of tiles.
   *
   * Draws the plate first and checks it — with no plate there is no lot, and dealing the tiles anyway
   * would leave a heap floating over an empty slot. Room is checked before anything is drawn at all,
   * because a draw made before a failure is a plate and four tiles gone from the game for good.
   */
  deal(tableau: Tableau): boolean
  /**
   * Account for a lot that was dealt before — advancing the bags without touching the board.
   *
   * Replay's counterpart to {@link deal}. The plate and its tiles are already in the log and have
   * already been applied; what is missing is the *bag* movement they came from, and the token the
   * plate is carrying. Draws exactly what the original drew, in the same two calls, because a
   * reshuffle that lands mid-draw depends on it.
   */
  absorb(tableau: Tableau): void
  /** Turn over every plate whose lot has been picked clean. Returns how many. */
  reveal(tableau: Tableau): number
  /** Put a whole event's worth of spent items into the piles. One call per event, never one per item. */
  recycle(tiles: readonly TileSpec[], plates: readonly PlateSpec[]): void
  /**
   * What a plate was carrying, forgetting it in the same breath.
   *
   * A face-up plate reports its own token and never needs this; a face-down one cannot, because the
   * model never held it.
   */
  forget(plateId: string): DealtPlate | undefined
  /** Plates dealt into the source this round. The round is spent as a supply once it meets its quota. */
  platesDealt(): number
  /** A new round: the quota starts again. */
  newRound(): void
}

export function createDealer(seed: string): Dealer {
  const deck = createDeck(seed)

  /*
   * Each seat's opening plate leaves the bag before play begins, so it can never turn up in the
   * shared source — it is already on a board. That is why the plate bag holds 35 and not 36.
   */
  const opening = dealStartingPlates(deck.plates, SEATS)

  const plates = createRecyclingBag(opening.remaining, { seed: `${seed}:reshuffle:plates` })
  const tiles = createRecyclingBag(deck.tiles, { seed: `${seed}:reshuffle:tiles` })

  /**
   * What each face-down plate is carrying, held outside the tableau.
   *
   * The model deliberately does not store it — see `Plate.faceDown` — so this is where it waits until
   * the plate turns over. Whoever owns this object owns the game's one secret.
   */
  const hidden = new Map<string, DealtPlate>()

  let dealt = 0

  return {
    deal(tableau) {
      if (!hasRoomToShift(tableau)) return false
      const plate = plates.draw(1)[0]
      if (!plate) return false
      if (!pushLot(tableau, tiles.draw(tableau.sourceTilesPerLot))) return false

      // `pushLot` puts the new plate at the top of the stack; remember what it carries until it flips.
      const placed = tableau.plateInSourceLot(0)
      if (placed) hidden.set(placed.id, plate)
      dealt++
      return true
    },

    absorb(tableau) {
      const plate = plates.draw(1)[0]
      tiles.draw(tableau.sourceTilesPerLot)
      // The freshly applied plate sits at the top of the stack, where `pushLot` put it.
      const placed = tableau.plateInSourceLot(0)
      if (plate && placed) hidden.set(placed.id, plate)
      dealt++
    },

    reveal(tableau) {
      let revealed = 0
      for (const plate of platesToReveal(tableau)) {
        const carried = hidden.get(plate.id)
        if (!carried) continue
        if (tableau.revealPlate(plate.id, { color: carried.color, value: carried.value }, carried.petal)) {
          hidden.delete(plate.id)
          revealed++
        }
      }
      return revealed
    },

    recycle(spentTiles, spentPlates) {
      tiles.discard(spentTiles)
      plates.discard(spentPlates)
    },

    forget(plateId) {
      const carried = hidden.get(plateId)
      hidden.delete(plateId)
      return carried
    },

    platesDealt: () => dealt,
    newRound() { dealt = 0 },
  }
}

/** A game rebuilt from its log: the board as it stands, and the deck as play has left it. */
export interface ReplayedGame {
  readonly tableau: Tableau
  readonly dealer: Dealer
}

/**
 * Rebuild a game from its commands.
 *
 * Takes the entries **grouped by command**, not flattened, and the grouping is not a convenience —
 * see the module note. Flattening them first loses the discard batches and produces a deck that is
 * subtly, permanently wrong from the first reshuffle.
 *
 * Only deals that succeeded are in the log, so only those are replayed. A deal that failed drew
 * nothing, which is exactly what `deal` guarantees by checking for room before it touches a bag.
 */
export function replayDealer(
  seed: string,
  settings: GameSettings,
  commands: readonly (readonly LogEntry[])[],
): ReplayedGame {
  const tableau = createTableau(tableauOptionsFor(settings))
  const dealer = createDealer(seed)

  for (const entries of commands) applyCommand(tableau, dealer, entries)
  return { tableau, dealer }
}

/**
 * The seats that have passed since the round last closed.
 *
 * A round ends when everyone has said they are done, so this is what the server counts before
 * writing the bookmark. Read from the log rather than tracked, so it survives a restart and cannot
 * disagree with the history.
 */
export function passedThisRound(commands: readonly (readonly LogEntry[])[]): Set<number> {
  const passed = new Set<number>()
  for (const entries of commands) {
    for (const entry of entries) {
      if (entry.op === 'endRound') passed.clear()
      else if (entry.op === 'pass') passed.add(entry.seat)
    }
  }
  return passed
}

/** Where a command stopped, when it stopped early. */
export interface CommandOutcome {
  readonly ok: boolean
  /** The index of the entry the board refused, when `ok` is false. */
  readonly refusedAt: number
}

/**
 * Apply one command's worth of entries to a board, keeping the deck in step — and say whether the
 * board allowed all of it.
 *
 * **One function for replay and for validation**, which is not thrift: a server that checked a turn
 * with different code from the code that later replays it would eventually accept something it could
 * not reproduce. Here, "is this legal" and "what does it do" are answered by the same pass.
 *
 * Stops at the first refusal. A refused mutation means the board never reached the state the later
 * entries assume, so continuing would measure nothing — and the caller is expected to throw the whole
 * command away rather than keep the prefix.
 */
export function applyCommand(
  tableau: Tableau,
  dealer: Dealer,
  entries: readonly LogEntry[],
  /**
   * The seat that submitted this, when there is one. Given, every entry must belong to it.
   *
   * **Folded in here rather than offered as a separate check**, and for a reason learned the hard
   * way: it *was* a separate function, `reachesAnotherSeat`, which was written, unit-tested, and then
   * never called from the server. It passed its own tests and guarded nothing. A check that has to
   * be remembered is a check that will be forgotten, so it now lives on the only path a command has
   * into the board.
   *
   * Omitted for the server's own writes, which answer to nobody's seat.
   */
  seat?: Seat,
): CommandOutcome {
  // A payment is one event, and a turn holds at most one, so a command's spend is one batch.
  const spentTiles: TileSpec[] = []
  const spentPlates: PlateSpec[] = []

  for (const [index, entry] of entries.entries()) {
    if (seat !== undefined && reaches(tableau, entry, seat)) return { ok: false, refusedAt: index }

    if (entry.op === 'discard') {
      /*
       * Read the piece before applying, because applying is what destroys it. A face-down plate has
       * no token to read, so its deal is recovered from the dealer — and spent either way, so that a
       * plate discarded before it ever turned over still comes back through the pile.
       */
      const tile = tableau.tile(entry.id)
      const plate = tableau.plate(entry.id)
      if (tile) spentTiles.push({ color: tile.color, value: tile.value })
      if (plate) {
        const token = tableau.plateToken(plate.id)
        // Forgotten either way, so a plate spent before it ever turned over stops being a secret.
        const carried = dealer.forget(plate.id)
        const spec = token?.location.kind === 'onPlate'
          ? { color: token.color, value: token.value, petal: token.location.petal }
          : carried
        if (spec) spentPlates.push(spec)
      }
    }

    if (!applyEntry(tableau, entry)) return { ok: false, refusedAt: index }

    /*
     * A lot deal, recognised by the one entry only a deal produces. The draws happen here, in the
     * middle of the command, because a later reshuffle depends on how much had been taken by the
     * time it ran.
     */
    if (entry.op === 'addPlate' && entry.location.kind === 'source' && entry.faceDown) {
      dealer.absorb(tableau)
    }

    if (entry.op === 'endRound') dealer.newRound()
  }

  dealer.recycle(spentTiles, spentPlates)
  return { ok: true, refusedAt: -1 }
}

/**
 * The seat a piece belongs to, or `undefined` for one nobody owns yet — a tile loose in the shared
 * source, a face-down plate in a lot.
 */
export function seatOfPiece(tableau: Tableau, id: string): Seat | undefined {
  const tile = tableau.tile(id)
  if (tile) {
    if (tile.location.kind === 'drawer') return seatOf(tile.location)
    if (tile.location.kind === 'onPlate') return seatOfPiece(tableau, tile.location.plateId)
    return undefined
  }
  const plate = tableau.plate(id)
  if (plate) return plate.location.kind === 'source' ? undefined : seatOf(plate.location)
  return tableau.stems().find(stem => stem.id === id)?.seat
}

/**
 * Whether one entry reaches somewhere this seat has no business.
 *
 * A token proves who you are; nothing bounds the seat named in a *location*, so without this a player
 * can submit a perfectly legal placement onto an opponent's board — legal, just not theirs to make.
 *
 * Judged against the board as it stands part-way through the turn, which is what lets a tile drafted
 * out of the shared source be unowned when it is taken and this seat's by the time it lands.
 */
function reaches(tableau: Tableau, entry: LogEntry, seat: Seat): boolean {
  const foreign = (where: Seat | undefined) => where !== undefined && where !== seat

  switch (entry.op) {
    case 'addTile':
    case 'moveTile':
      if (foreign(seatOfLocation(tableau, entry.location))) return true
      break
    case 'addPlate':
    case 'movePlate':
      if (entry.location.kind !== 'source' && seatOf(entry.location) !== seat) return true
      break
    case 'addStem':
      if ((entry.seat ?? SOLO_SEAT) !== seat) return true
      break
    // Declaring somebody else done for the round would end it early, and on their behalf.
    case 'pass':
      if (entry.seat !== seat) return true
      break
    default:
      break
  }

  // And whatever it names must be a piece this seat may touch.
  return 'id' in entry && foreign(seatOfPiece(tableau, entry.id))
}

function seatOfLocation(tableau: Tableau, location: TileLocation): Seat | undefined {
  if (location.kind === 'drawer') return seatOf(location)
  if (location.kind === 'onPlate') return seatOfPiece(tableau, location.plateId)
  return undefined
}
