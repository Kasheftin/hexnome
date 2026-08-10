/**
 * Restocking the shared source: when a new lot appears, and where the old ones go.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The rule
 *
 * The source is a **stack that grows from the top**. Lot 0 is the newest and sits at the top of the
 * column; everything older sits below it.
 *
 * At the start of every turn, if the **topmost lot is no longer full** — someone has drafted a tile out
 * of it — then every lot shifts down one slot and a fresh face-down plate with a full heap of tiles is
 * pushed in at the top.
 *
 * Only the *topmost* lot's fullness matters. Drafting out of a lower lot leaves the stack alone; the
 * source only restocks once the newest offering has been touched.
 *
 * ## Why the slot count equals plates-per-round
 *
 * A round deals exactly `platesPerRound` plates and the column has exactly that many slots, so a round's
 * worth can never be pushed off the bottom.
 *
 * {@link shouldRefill} checks the round's budget **and** that the bottom slot is free, and now that
 * plates can be drafted the two really do differ. A lot picked clean of both its tiles and its plate
 * leaves a free slot the round has no plate left to fill; relying on capacity alone would quietly deal
 * more than a round's worth.
 */
import type { Plate, Tableau, Tile, TileSpec } from './tableau'

/**
 * Face-down plates whose lot has been picked clean.
 *
 * **A plate turns over once nothing is heaped on it.** While tiles cover it there is something else in
 * the lot worth drafting, and the plate waits its turn; the moment the last tile leaves, it flips and its
 * token joins the draft like any other item.
 *
 * Returns the plates rather than revealing them, because the model does not hold a face-down plate's
 * token — that is the whole point of `faceDown`. The caller supplies it, standing in for the server that
 * will supply it in multiplayer.
 */
export function platesToReveal(tableau: Tableau): Plate[] {
  const ready: Plate[] = []
  for (let lot = 0; lot < tableau.sourceLots; lot++) {
    const plate = tableau.plateInSourceLot(lot)
    if (plate?.faceDown && tableau.tilesInSourceLot(lot).length === 0) ready.push(plate)
  }
  return ready
}

/**
 * Everything still sitting in the source, for the sweep at the end of a round.
 *
 * **Reports rather than removes**, following `platesToReveal` for the same two reasons. A face-down
 * plate's token is not in the model, so only the caller can complete it; and keeping `tableau.discard`
 * as the single path by which anything leaves the game means "was this counted twice?" has one place to
 * look rather than two.
 *
 * The loose tiles have to be listed separately, and that is easy to miss: a source tile is
 * `kind: 'source'`, not `onPlate`, so it is *not* carried off by discarding the plate it is heaped on.
 */
export function sourceContents(tableau: Tableau): {
  readonly tiles: readonly Tile[]
  readonly plates: readonly Plate[]
} {
  const tiles: Tile[] = []
  const plates: Plate[] = []
  for (let lot = 0; lot < tableau.sourceLots; lot++) {
    tiles.push(...tableau.tilesInSourceLot(lot))
    const plate = tableau.plateInSourceLot(lot)
    if (plate) plates.push(plate)
  }
  return { tiles, plates }
}

/** Has the newest lot been drafted from? */
export function topLotIsShort(tableau: Tableau): boolean {
  if (tableau.sourceLots === 0) return false
  return tableau.tilesInSourceLot(0).length < tableau.sourceTilesPerLot
}

/** Is the bottom slot free, so a shift cannot push a lot off the end? */
export function hasRoomToShift(tableau: Tableau): boolean {
  const last = tableau.sourceLots - 1
  if (last < 0) return false
  return tableau.plateInSourceLot(last) === undefined
    && tableau.tilesInSourceLot(last).length === 0
}

export interface RoundSupply {
  /** Plates already dealt into the source this round. */
  readonly platesDealt: number
  /** Plates this round deals in total — the same number as there are slots. */
  readonly platesPerRound: number
}

/**
 * Should a new lot be pushed at the start of this turn?
 *
 * Three things have to hold: the newest lot has been touched, the round has a plate left, and there is
 * somewhere for the stack to shift into.
 */
export function shouldRefill(tableau: Tableau, supply: RoundSupply): boolean {
  return topLotIsShort(tableau)
    && supply.platesDealt < supply.platesPerRound
    && hasRoomToShift(tableau)
}

/**
 * Move every lot down one slot, leaving lot 0 empty.
 *
 * Walks **from the bottom up**, so each lot's destination has already been vacated. Going the other way
 * would try to move lot 0 onto an occupied lot 1 and be refused.
 *
 * Tiles keep their index within the lot, so a heap's shape is preserved — the renderer keys a heap's
 * arrangement on its plate rather than its slot for the same reason (scene/sourceScatter.ts).
 */
export function shiftLotsDown(tableau: Tableau): void {
  for (let lot = tableau.sourceLots - 2; lot >= 0; lot--) {
    const plate = tableau.plateInSourceLot(lot)
    if (plate) tableau.movePlate(plate.id, { kind: 'source', lot: lot + 1 })
    // A snapshot, so moving them cannot disturb the walk.
    for (const tile of tableau.tilesInSourceLot(lot)) {
      const index = tile.location.kind === 'source' ? tile.location.index : 0
      tableau.moveTile(tile.id, { kind: 'source', lot: lot + 1, index })
    }
  }
}

/**
 * Push a fresh lot onto the top of the stack: a face-down plate under a heap of tiles.
 *
 * The plate arrives face down and **its own tile is not created**, so there is no hidden value in the
 * model for anything to read — see `Plate.faceDown`. It is dealt on reveal, from the deck.
 *
 * Returns false if the plate could not be placed, which means the source was not shifted first or the
 * bag is empty. The opening deal and every later restock both go through here, so there is one code
 * path and the first lot cannot drift from the rest.
 */
/**
 * Loose tiles heaped on each lot's face-down plate.
 *
 * Here rather than in the scene, for the same reason as the playfield's extent: it decides how much
 * a lot costs the bag, and the server draws that many. It was a scene constant while only the browser
 * dealt, and a second copy of it there would be a second answer.
 */
export const SOURCE_TILES_PER_LOT = 4

export function pushLot(tableau: Tableau, tiles: readonly TileSpec[]): boolean {
  shiftLotsDown(tableau)
  const plate = tableau.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })
  if (!plate) return false
  tiles.slice(0, tableau.sourceTilesPerLot).forEach((spec, index) => {
    tableau.addTile(spec, { kind: 'source', lot: 0, index })
  })
  return true
}
