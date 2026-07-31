/**
 * Nothing is lost, and nothing is duplicated.
 *
 * This exercises the *protocol* GameView follows — deal from a bag, discard through the tableau,
 * recycle the receipt — rather than the component, which needs a canvas. The protocol is where the
 * mistakes live: a plate's token counted in both piles, a swept lot's loose tiles forgotten, a draw
 * made before a push that then fails. A wrong count here is a wrong count in the game.
 */
import { describe, expect, it } from 'vitest'
import { createDeck, dealStartingPlates, STANDARD_TILE_COPIES, TILE_COLOR_COUNT, TILE_VALUE_COUNT } from './deck'
import { hexRectangle } from './hex'
import { createRecyclingBag } from './recycling'
import { hasRoomToShift, pushLot, sourceContents } from './source'
import { createTableau, type PlateSpec, type TileSpec } from './tableau'

const GAME_ID = 'conservation'
const PLATES_PER_ROUND = 4
const TILES_PER_LOT = 4

const PLATES_IN_GAME = TILE_COLOR_COUNT * TILE_VALUE_COUNT
const TILES_IN_GAME = PLATES_IN_GAME * STANDARD_TILE_COPIES

/**
 * A game reduced to the parts that move items around, mirroring `GameView`'s plumbing.
 *
 * `dealtTokens` is here for the same reason it is there: the model does not hold a face-down plate's
 * token, so something outside it has to remember what each lot is hiding.
 */
function game() {
  const deck = createDeck(GAME_ID)
  const opening = dealStartingPlates(deck.plates, 1)
  const plateBag = createRecyclingBag(opening.remaining, { seed: `${GAME_ID}:reshuffle:plates` })
  const tileBag = createRecyclingBag(deck.tiles, { seed: `${GAME_ID}:reshuffle:tiles` })
  const dealtTokens = new Map<string, PlateSpec>()

  const tableau = createTableau({
    cells: hexRectangle(8, 8),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: PLATES_PER_ROUND,
    sourceTilesPerLot: TILES_PER_LOT,
  })

  // The starting plate goes straight to the board, exactly as the opening position does.
  const start = tableau.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
  const startToken = opening.starting[0]!
  tableau.addTile(startToken, { kind: 'onPlate', plateId: start.id, petal: startToken.petal }, { fixed: true })

  function dealLot(): boolean {
    if (!hasRoomToShift(tableau)) return false
    const dealt = plateBag.draw(1)[0]
    if (!dealt) return false
    if (!pushLot(tableau, tileBag.draw(TILES_PER_LOT))) return false
    const plate = tableau.plateInSourceLot(0)
    if (plate) dealtTokens.set(plate.id, dealt)
    return true
  }

  /** The round-end sweep: one batch per bag, however many lots it came from. */
  function clearSource(): void {
    const { tiles: loose, plates: standing } = sourceContents(tableau)
    const tiles: TileSpec[] = []
    const plates: PlateSpec[] = []
    for (const tile of loose) {
      const receipt = tableau.discard(tile.id)
      if (receipt) tiles.push(...receipt.tiles)
    }
    for (const plate of standing) {
      const receipt = tableau.discard(plate.id)
      if (!receipt) continue
      tiles.push(...receipt.tiles)
      const recovered = receipt.plate ?? dealtTokens.get(plate.id) ?? null
      dealtTokens.delete(plate.id)
      if (recovered) plates.push(recovered)
    }
    tileBag.discard(tiles)
    plateBag.discard(plates)
  }

  /** Spend a set of ids as payment, the way `applyPayment` does. */
  function spend(ids: readonly string[]): void {
    const tiles: TileSpec[] = []
    const plates: PlateSpec[] = []
    for (const id of ids) {
      const receipt = tableau.discard(id)
      if (!receipt) continue
      tiles.push(...receipt.tiles)
      if (receipt.kind === 'plate') {
        const recovered = receipt.plate ?? dealtTokens.get(id) ?? null
        dealtTokens.delete(id)
        if (recovered) plates.push(recovered)
      }
    }
    tileBag.discard(tiles)
    plateBag.discard(plates)
  }

  /**
   * Every tile in existence, and every plate.
   *
   * A plate's own token is a tile *and* part of a plate, so it is counted on both sides — deliberately.
   * That is the sum the deck holds: 36 plates, each with a token, plus 108 loose tiles.
   */
  function census() {
    // The pile is inside `remaining()`, so bag + pile is one number.
    const platesInModel = tableau.plates().length
    const tilesInModel = tableau.tiles().filter(tile => !tile.fixed).length
    return {
      plates: plateBag.remaining() + platesInModel,
      tiles: tileBag.remaining() + tilesInModel,
    }
  }

  return { tableau, dealLot, clearSource, spend, census, plateBag, tileBag, dealtTokens }
}

describe('conservation', () => {
  it('starts with the whole deck accounted for', () => {
    // 35 in the bag plus the one on the board; the starting plate was split off, not destroyed.
    expect(game().census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds while the source is dealt', () => {
    const g = game()
    for (let i = 0; i < PLATES_PER_ROUND; i++) expect(g.dealLot()).toBe(true)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds across a round-end sweep', () => {
    const g = game()
    for (let i = 0; i < PLATES_PER_ROUND; i++) g.dealLot()
    g.clearSource()
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds when a revealed plate is swept, without duplicating its token', () => {
    const g = game()
    g.dealLot()
    const plate = g.tableau.plateInSourceLot(0)!
    // Drafted and paid for, so the heap leaves through the pile rather than into thin air.
    g.spend(g.tableau.tilesInSourceLot(0).map(tile => tile.id))
    const token = g.dealtTokens.get(plate.id)!
    g.tableau.revealPlate(plate.id, token, token.petal)
    g.dealtTokens.delete(plate.id)

    g.clearSource()
    // One entry in the plate pile, and only the four paid tiles in the other: the token went with
    // its plate rather than into both.
    expect(g.plateBag.pile()).toHaveLength(1)
    expect(g.tileBag.pile()).toHaveLength(TILES_PER_LOT)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds when tiles are spent as payment', () => {
    const g = game()
    g.dealLot()
    const spent = g.tableau.tilesInSourceLot(0).slice(0, 2).map(tile => tile.id)
    g.spend(spent)
    expect(g.tileBag.pile()).toHaveLength(2)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('empties the remembered tokens when the source is swept', () => {
    const g = game()
    for (let i = 0; i < PLATES_PER_ROUND; i++) g.dealLot()
    g.clearSource()
    expect(g.dealtTokens.size).toBe(0)
  })

  /*
   * The leak `dealLot`'s room check exists to close. `pushLot` shifts the stack and fails when the
   * bottom slot is taken — and a draw made before that failure is gone for good.
   */
  it('does not draw for a lot that cannot be pushed', () => {
    const g = game()
    for (let i = 0; i < PLATES_PER_ROUND; i++) g.dealLot()
    expect(g.dealLot()).toBe(false)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds over several rounds, sweeping between them', () => {
    const g = game()
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < PLATES_PER_ROUND; i++) g.dealLot()
      g.clearSource()
      expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
    }
  })

  /*
   * The reshuffle, reached by playing rather than by fixture — which takes more rounds than a real game
   * has. Ten rounds is 40 plate draws against a bag of 35 and 160 tile draws against 108, so both bags
   * go round the pile at least once. A four-round game never gets close; that is the point of the note
   * in the plan that says this path is unit-tested rather than played.
   */
  it('keeps dealing once a bag has been round the pile', () => {
    const g = game()
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < PLATES_PER_ROUND; i++) expect(g.dealLot()).toBe(true)
      g.clearSource()
    }
    expect(g.plateBag.reshuffles()).toBeGreaterThan(0)
    expect(g.tileBag.reshuffles()).toBeGreaterThan(0)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })
})
