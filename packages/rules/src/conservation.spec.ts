/**
 * Nothing is lost, and nothing is duplicated.
 *
 * This exercises the *protocol* GameView follows — draw from a desk, discard through the tableau,
 * hand the codes back — rather than the component, which needs a canvas. The protocol is where the
 * mistakes live: a plate's token counted in both piles, a swept lot's loose tiles forgotten, a draw
 * made before a push that then fails. A wrong count here is a wrong count in the game.
 *
 * The desks are the real ones (`desk.ts`), driven in process rather than over HTTP. What the server
 * adds is storage and validation; the arithmetic under test is the same either way.
 */
import { describe, expect, it } from 'vitest'
import { DISTINCT_TILES, openingPlateCodes } from './deck'
import {
  createDesk,
  deskRemaining,
  discardToDesk,
  drawFromDesk,
  tileCode,
  tileFromCode,
  type DeskState,
} from './desk'
import { hexRectangle } from './hex'
import { PETAL_COUNT } from './plate'
import { createRandom } from './random'
import { hasRoomToShift, pushLot, sourceContents } from './source'
import { createTableau, type PlateSpec, type TileSpec } from './tableau'

const SEED = 'conservation'
const PLATES_PER_ROUND = 4
const TILES_PER_LOT = 4

const PLATES_IN_GAME = DISTINCT_TILES
const TILES_IN_GAME = DISTINCT_TILES * 3

interface Copies {
  readonly tileCopies?: number
  readonly plateCopies?: number
}

/**
 * A game reduced to the parts that move items around, mirroring `GameView`'s plumbing.
 *
 * `dealtTokens` is here for the same reason it is there: the model does not hold a face-down plate's
 * token, so something outside it has to remember what each lot is hiding.
 */
function game({ tileCopies = 3, plateCopies = 1 }: Copies = {}) {
  const opening = openingPlateCodes(SEED, 1)

  function built(tag: string, copies: number, exclude?: readonly number[]): DeskState {
    const result = createDesk(`${SEED}:${tag}`, { copies, exclude })
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  let tileDesk = built('tiles', tileCopies)
  let plateDesk = built('plates', plateCopies, opening)

  // Cosmetic, and the client's business: a code carries no petal, so one is drawn per plate dealt.
  const petals = createRandom(`${SEED}:petals`)
  const nextPetal = (): number => Math.floor(petals() * PETAL_COUNT)

  const dealtTokens = new Map<string, PlateSpec>()

  const tableau = createTableau({
    cells: hexRectangle(8, 8),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: PLATES_PER_ROUND,
    sourceTilesPerLot: TILES_PER_LOT,
  })

  function specOf(code: number): TileSpec {
    const spec = tileFromCode(code)
    if (!spec) throw new Error(`${code} is not a tile code`)
    return spec
  }

  /** Draw from one of the desks, failing loudly: a refused draw is a bug in the script, not a result. */
  function draw(which: 'tiles' | 'plates', n: number): TileSpec[] {
    const state = which === 'tiles' ? tileDesk : plateDesk
    const result = drawFromDesk(state, n)
    if (!result.ok) throw new Error(result.error)
    if (which === 'tiles') tileDesk = result.value.state
    else plateDesk = result.value.state
    return result.value.codes.map(specOf)
  }

  function putBack(which: 'tiles' | 'plates', items: readonly TileSpec[]): void {
    if (items.length === 0) return
    const state = which === 'tiles' ? tileDesk : plateDesk
    const result = discardToDesk(state, items.map(tileCode))
    if (!result.ok) throw new Error(result.error)
    if (which === 'tiles') tileDesk = result.value
    else plateDesk = result.value
  }

  // The starting plate goes straight to the board, exactly as the opening position does. It was held
  // back from the desk at creation, so it can never also be dealt into the source.
  const startToken: PlateSpec = { ...specOf(opening[0] as number), petal: nextPetal() }
  const start = tableau.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
  tableau.addTile(startToken, { kind: 'onPlate', plateId: start.id, petal: startToken.petal }, { fixed: true })

  function dealLot(): boolean {
    if (!hasRoomToShift(tableau)) return false
    if (deskRemaining(plateDesk) < 1 || deskRemaining(tileDesk) < TILES_PER_LOT) return false
    const dealt: PlateSpec = { ...(draw('plates', 1)[0] as TileSpec), petal: nextPetal() }
    if (!pushLot(tableau, draw('tiles', TILES_PER_LOT))) return false
    const plate = tableau.plateInSourceLot(0)
    if (plate) dealtTokens.set(plate.id, dealt)
    return true
  }

  /** The round-end sweep: one batch per desk, however many lots it came from. */
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
    putBack('tiles', tiles)
    putBack('plates', plates)
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
    putBack('tiles', tiles)
    putBack('plates', plates)
  }

  /**
   * Every tile in existence, and every plate.
   *
   * A plate's own token is a tile *and* part of a plate, so it is counted on both sides — deliberately.
   * That is the sum the desks hold: 36 plates, each with a token, plus 108 loose tiles.
   *
   * The excluded opening plate is on the board, so the model counts it; the desk never held it. Which
   * is why the totals below are over 36 and not 35.
   */
  function census() {
    // The pile is part of the desk's state, so desk + pile is one number.
    const platesInModel = tableau.plates().length
    const tilesInModel = tableau.tiles().filter(tile => !tile.fixed).length
    return {
      plates: deskRemaining(plateDesk) + platesInModel,
      tiles: deskRemaining(tileDesk) + tilesInModel,
    }
  }

  /** What the census has to come to for *these* desks, so a case can vary them and still assert. */
  const whole = {
    plates: DISTINCT_TILES * plateCopies,
    tiles: DISTINCT_TILES * tileCopies,
  }

  return {
    tableau,
    dealLot,
    clearSource,
    spend,
    census,
    whole,
    dealtTokens,
    tileDesk: () => tileDesk,
    plateDesk: () => plateDesk,
  }
}

describe('conservation', () => {
  it('starts with the whole deck accounted for', () => {
    // 35 in the desk plus the one on the board; the starting plate was held back, not destroyed.
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
    expect(g.plateDesk().discard).toHaveLength(1)
    expect(g.tileDesk().discard).toHaveLength(TILES_PER_LOT)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  it('holds when tiles are spent as payment', () => {
    const g = game()
    g.dealLot()
    const spent = g.tableau.tilesInSourceLot(0).slice(0, 2).map(tile => tile.id)
    g.spend(spent)
    expect(g.tileDesk().discard).toHaveLength(2)
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
   * has. Ten rounds is 40 plate draws against a desk of 35 and 160 tile draws against 108, so both go
   * round the pile at least once. A four-round game never gets close; that is why this path is
   * exercised here rather than by playing.
   */
  it('keeps dealing once a desk has been round the pile', () => {
    const g = game()
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < PLATES_PER_ROUND; i++) expect(g.dealLot()).toBe(true)
      g.clearSource()
    }
    expect(g.plateDesk().generation).toBeGreaterThan(0)
    expect(g.tileDesk().generation).toBeGreaterThan(0)
    expect(g.census()).toEqual({ plates: PLATES_IN_GAME, tiles: TILES_IN_GAME })
  })

  /*
   * The same protocol against the largest desks the menu offers — 144 tiles and 108 plates.
   *
   * The cases above all pass with 36 and 108 hardcoded anywhere downstream, because that is what they
   * deal. This one does not: it is the test that says the desk's size is genuinely a parameter rather
   * than a default nobody has moved. Ten rounds again, so the tiles still go round the pile.
   */
  it('holds for the largest desks the settings offer', () => {
    const g = game({ tileCopies: 4, plateCopies: 3 })
    expect(g.whole).toEqual({ plates: 108, tiles: 144 })

    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < PLATES_PER_ROUND; i++) expect(g.dealLot()).toBe(true)
      g.clearSource()
      expect(g.census()).toEqual(g.whole)
    }
    expect(g.tileDesk().generation).toBeGreaterThan(0)
  })
})
