/**
 * One number, and both ends of the wire have to reach it.
 *
 * A high score board is a claim that two games can be compared. The server produces the figure it
 * stores and the screen produces the figure the player read, and if those two are ever computed by
 * different code they will differ eventually — in a way nobody notices until somebody disputes a row.
 * So there is one implementation, and these are the properties it has to have for that to be enough.
 */
import { describe, expect, it } from 'vitest'
import { createAgenda } from './agenda'
import { finalTally, type PlacedTile } from './groups'
import { applyCommand, createGame, replayGame, type Command, type GameOptions } from './game'
import { defaultGameSettings, type GameSettings } from './gameSettings'
import { hexRectangle } from './hex'
import { createTableau, type PlateLocation, type TileSpec } from './tableau'
import { boardTiles, finalScoreOf, finalTallyOf, leftoversOf, scoringRulesOf } from './score'

const RED: TileSpec = { color: 0, value: 1 }
const BLUE: TileSpec = { color: 3, value: 2 }
const onBoard = (q: number, r: number): PlateLocation => ({ kind: 'board', hole: { q, r } })

/** A bare tableau, as boardDiagram.spec.ts builds one — no game, no deal, nothing incidental. */
function table() {
  return createTableau({
    cells: hexRectangle(8, 8),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: 0,
    sourceTilesPerLot: 0,
  })
}

const SEED = 'scoring'

function optionsFor(settings: GameSettings): GameOptions {
  return {
    settings,
    gameId: SEED,
    cells: hexRectangle(8, 8),
    sourceTilesPerLot: 4,
    agenda: createAgenda(SEED, settings.mode),
  }
}

function soloGame(overrides: Partial<GameSettings> = {}) {
  const settings: GameSettings = {
    ...defaultGameSettings(0),
    kind: 'singleplayer',
    players: 1,
    ...overrides,
  }
  return createGame(optionsFor(settings))
}

describe('the four settings that decide what a board is worth', () => {
  /*
   * A strict subset, and no defaulting: `parseGameSettings` has already normalised `groupBonuses`
   * against `minGroupSize`, so what is picked out here is what the game actually ran with.
   */
  it('picks them straight out of the settings', () => {
    const settings = defaultGameSettings(0)
    expect(scoringRulesOf(settings)).toEqual({
      minGroupSize: settings.minGroupSize,
      groupBonuses: settings.groupBonuses,
      fineUnplaced: settings.fineUnplaced,
      rewardStems: settings.rewardStems,
    })
  })
})

describe('what a seat is holding at the end', () => {
  it('is nothing at all on an untouched tableau', () => {
    expect(leftoversOf(table())).toEqual({ unplaced: [], stems: 0 })
  })

  it('counts a loose tile in the drawer', () => {
    const t = table()
    t.addTile(RED, { kind: 'drawer', slot: 0 })
    expect(leftoversOf(t).unplaced).toEqual([RED])
  })

  /*
   * The case the comment in `boardDiagram.ts` warned about, and the reason this is not a one-liner: a
   * plate hoarded in a bay is charged for through its token, which lives at an `onPlate` location
   * rather than in the drawer. Reading only `kind: 'drawer'` would quietly let it off.
   */
  it('charges for a plate still in its bay, through its token', () => {
    const t = table()
    const plate = t.addPlate({ kind: 'plateSlot', slot: 0 })!
    // `fixed` is what makes a tile the plate's own token rather than one sitting on it.
    t.addTile(BLUE, { kind: 'onPlate', plateId: plate.id, petal: 0 }, { fixed: true })

    const token = t.plateToken(plate.id)
    expect(token).toBeDefined()
    expect(leftoversOf(t).unplaced).toContainEqual({ color: token!.color, value: token!.value })
  })

  /* A plate that made it onto the board is not being held, and must not be charged for. */
  it('does not charge for a plate that was played', () => {
    const t = table()
    const plate = t.addPlate(onBoard(0, 0))!
    t.addTile(BLUE, { kind: 'onPlate', plateId: plate.id, petal: 0 }, { fixed: true })
    expect(leftoversOf(t).unplaced).toEqual([])
  })
})

describe('the total a board is worth', () => {
  /*
   * The whole server-equals-client claim leans on this. `findGroups` computes connected components,
   * which are a partition however the input is walked — so the total cannot depend on the order tiles
   * arrive in. Asserted rather than reasoned about, because it is load-bearing.
   */
  it('does not depend on the order the tiles are given in', () => {
    const tiles: PlacedTile[] = [
      { id: 'a', cell: { q: 0, r: 0 }, color: 0, value: 1 },
      { id: 'b', cell: { q: 1, r: 0 }, color: 0, value: 2 },
      { id: 'c', cell: { q: 0, r: 1 }, color: 0, value: 3 },
      { id: 'd', cell: { q: 4, r: 4 }, color: 2, value: 5 },
    ]
    const rules = scoringRulesOf(defaultGameSettings(0))
    const forward = finalTally(tiles, rules).total
    const backward = finalTally([...tiles].reverse(), rules).total
    const shuffled = finalTally([tiles[2]!, tiles[0]!, tiles[3]!, tiles[1]!], rules).total

    expect(backward).toBe(forward)
    expect(shuffled).toBe(forward)
  })

  /*
   * Reading order, so the *groups* come out in the same sequence on both ends and a test can compare
   * them structurally. The total does not depend on it — see above — but the sequence does.
   */
  it('reads the board down and then across', () => {
    const t = table()
    const plate = t.addPlate(onBoard(0, 0))!
    for (let petal = 0; petal < 6; petal++) {
      t.addTile({ color: petal, value: 1 }, { kind: 'onPlate', plateId: plate.id, petal })
    }

    const rows = boardTiles(t).map(tile => tile.cell.r)
    expect([...rows].sort((a, b) => a - b)).toEqual(rows)
    expect(boardTiles(t).map(tile => tile.id).sort())
      .toEqual(t.tilesOnBoard().map(tile => tile.id).sort())
  })
})

describe('a seat is worth its rounds plus its board', () => {
  /*
   * Played rather than constructed, because the arithmetic under test is a sum over what the fold
   * did — and a hand-built state would prove only that the sum adds up, not that it adds up the
   * things the game actually banked.
   */
  function playToTheEnd(overrides: Partial<GameSettings> = {}) {
    const settings: GameSettings = {
      ...defaultGameSettings(0),
      kind: 'singleplayer',
      players: 1,
      ...overrides,
    }
    const options = optionsFor(settings)
    const log: Command[] = []
    let state = createGame(options)

    let guard = 0
    while (!state.finished && guard++ < 400) {
      const pass: Command = { kind: 'pass', seat: state.activeSeat }
      const played = applyCommand(state, pass)
      expect(played.ok).toBe(true)
      log.push(pass)
      state = replayGame(options, log)
    }
    expect(state.finished).toBe(true)
    return state
  }

  it('is the banked rounds plus the final tally, and nothing else', () => {
    for (const mode of ['classic', 'quick'] as const) {
      const state = playToTheEnd({ mode })
      const seat = state.seats[0]!

      const rounds = seat.banked.reduce((sum, points) => sum + points, 0)
      const board = finalTallyOf(seat.tableau, state.options.settings).total

      expect(finalScoreOf(state, 0)).toBe(rounds + board)
    }
  })

  /*
   * `closeRound` banks `scored + anchors - fined`, already net of the fine. Subtracting it a second
   * time here is the one mistake this function exists to stop being made twice, so the fine is pinned
   * as *already inside* `banked` rather than beside it.
   */
  it('does not charge the first-pass fine twice', () => {
    // Quick mode, because it scores no targets — so `banked` is anchors less the fine and nothing
    // else, and the shape of the sum is visible rather than buried under round points.
    const state = playToTheEnd({ mode: 'quick' })
    const seat = state.seats[0]!
    const banked = seat.banked.reduce((sum, points) => sum + points, 0)
    const fined = seat.fined.reduce((sum, points) => sum + points, 0)
    const anchored = seat.anchored.reduce((sum, points) => sum + points, 0)

    // Solo games are never fined at all — see `effectiveFirstPassFine` — so this is the shape, not
    // the magnitude: whatever was charged has already been taken out of `banked`.
    expect(fined).toBe(0)
    expect(banked).toBe(anchored - fined)
  })

  it('answers nothing for a seat that is not at the table', () => {
    expect(finalScoreOf(soloGame(), 3)).toBe(0)
  })
})
