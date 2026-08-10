/**
 * Nothing is lost, and nothing is duplicated.
 *
 * This exercises the *protocol* a game follows — draw from a desk, play through commands, hand back
 * what is spent — rather than the component, which needs a canvas. The protocol is where the mistakes
 * live: a plate's token counted in both piles, a swept lot's loose tiles forgotten, material that
 * crosses between two tableaux and arrives twice.
 *
 * That last one is the reason this spec grew seats. A draft moves a tile out of the shared source's
 * model and into a player's, which is a remove and an add across two objects — the one operation in
 * the game that could genuinely create material out of nothing.
 */
import { describe, expect, it } from 'vitest'
import { createAgenda } from './agenda'
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
import {
  applyCommand,
  createGame,
  draftItems,
  needsDeal,
  type Command,
  type GameOptions,
} from './game'
import { defaultGameSettings, type GameSettings } from './gameSettings'
import { hexRectangle } from './hex'
import type { TileSpec } from './tableau'

const SEED = 'conservation'
const TILES_PER_LOT = 4

interface Table {
  readonly players?: number
  readonly tileCopies?: number
  readonly plateCopies?: number
}

/**
 * A whole game reduced to the parts that move material: two desks and a state driven by commands.
 *
 * The desks are the real ones, driven in process rather than over HTTP — what a server adds is
 * storage and validation, and the arithmetic under test is the same either way.
 */
function table({ players = 3, tileCopies = 3, plateCopies = 1 }: Table = {}) {
  const settings: GameSettings = {
    ...defaultGameSettings(0),
    kind: 'multiplayer',
    players,
    tileCopies,
    plateCopies,
  }
  const options: GameOptions = {
    settings,
    gameId: SEED,
    cells: hexRectangle(8, 8),
    sourceTilesPerLot: TILES_PER_LOT,
    agenda: createAgenda(SEED, settings.mode),
  }

  function built(tag: string, copies: number, exclude?: readonly number[]): DeskState {
    const result = createDesk(`${SEED}:${tag}`, { copies, exclude })
    if (!result.ok) throw new Error(result.error)
    return result.value
  }

  let tileDesk = built('tiles', tileCopies)
  let plateDesk = built('plates', plateCopies, openingPlateCodes(SEED, players))
  const state = createGame(options)

  function specOf(code: number): TileSpec {
    const spec = tileFromCode(code)
    if (!spec) throw new Error(`${code} is not a tile code`)
    return spec
  }

  function draw(which: 'tiles' | 'plates', n: number): TileSpec[] {
    const desk = which === 'tiles' ? tileDesk : plateDesk
    const result = drawFromDesk(desk, n)
    if (!result.ok) throw new Error(result.error)
    if (which === 'tiles') tileDesk = result.value.state
    else plateDesk = result.value.state
    return result.value.codes.map(specOf)
  }

  function putBack(which: 'tiles' | 'plates', items: readonly TileSpec[]): void {
    if (items.length === 0) return
    const desk = which === 'tiles' ? tileDesk : plateDesk
    const result = discardToDesk(desk, items.map(tileCode))
    if (!result.ok) throw new Error(result.error)
    if (which === 'tiles') tileDesk = result.value
    else plateDesk = result.value
  }

  /** Play a command and send whatever it spent back to the desks. Returns whether it was allowed. */
  function tryPlay(command: Command): boolean {
    const result = applyCommand(state, command)
    if (!result.ok) return false
    putBack('tiles', result.toDesk.tiles)
    putBack('plates', result.toDesk.plates)
    return true
  }

  /** The same, insisting: a refusal here is a broken script rather than a game state. */
  function play(command: Command): void {
    const result = applyCommand(state, command)
    if (!result.ok) throw new Error(`${command.kind} refused: ${result.error}`)
    putBack('tiles', result.toDesk.tiles)
    putBack('plates', result.toDesk.plates)
  }

  /** Fill the source if it wants filling, asking the desks for exactly one lot. */
  function deal(): boolean {
    if (!needsDeal(state)) return false
    if (deskRemaining(plateDesk) < 1 || deskRemaining(tileDesk) < TILES_PER_LOT) return false
    const plate = draw('plates', 1)[0] as TileSpec
    play({ kind: 'deal', plate, tiles: draw('tiles', TILES_PER_LOT) })
    return true
  }

  /**
   * Every tile in existence, and every plate.
   *
   * A plate's own token is a tile *and* part of a plate, so it is counted on both sides —
   * deliberately. That is the sum the desks hold, and the opening plates are on boards rather than in
   * the plate desk, which is why the totals are over 36 and not 36 minus the players.
   */
  function census() {
    const tilesIn = (t: { tiles: () => readonly { fixed: boolean }[] }) =>
      t.tiles().filter(tile => !tile.fixed).length
    const platesIn = (t: { plates: () => readonly unknown[] }) => t.plates().length

    let tiles = deskRemaining(tileDesk) + tilesIn(state.source)
    let plates = deskRemaining(plateDesk) + platesIn(state.source)
    for (const seat of state.seats) {
      tiles += tilesIn(seat.tableau)
      plates += platesIn(seat.tableau)
    }
    return { tiles, plates }
  }

  const whole = {
    tiles: DISTINCT_TILES * tileCopies,
    plates: DISTINCT_TILES * plateCopies,
  }

  return { state, play, tryPlay, deal, census, whole, tileDesk: () => tileDesk, plateDesk: () => plateDesk }
}

/**
 * Take everything of one value showing in the source: always a complete draft on its own.
 *
 * Returns false when there is nothing to take *or* nowhere to put it. A full drawer is an ordinary
 * position rather than a broken script, and it is the position the caller answers with a pass.
 */
function sweepOneValue(game: ReturnType<typeof table>): boolean {
  const items = draftItems(game.state)
  for (const value of new Set(items.map(item => item.value))) {
    const ids = items.filter(item => item.value === value).map(item => item.id)
    if (game.tryPlay({ kind: 'draft', seat: game.state.activeSeat, ids })) return true
  }
  return false
}

describe('conservation', () => {
  it('starts with the whole deck accounted for', () => {
    const game = table()
    expect(game.census()).toEqual(game.whole)
  })

  it('holds while the source is dealt', () => {
    const game = table()
    while (game.deal()) { /* until the round's quota is met */ }
    expect(game.census()).toEqual(game.whole)
  })

  /*
   * The crossing. A drafted tile leaves one model and joins another, and the census is the only thing
   * that would notice it arriving twice — or not at all.
   */
  it('holds when material crosses from the source into a drawer', () => {
    const game = table()
    game.deal()
    const before = game.census()
    expect(sweepOneValue(game)).toBe(true)
    expect(game.census()).toEqual(before)
  })

  it('does not put a drafted tile back in the desk', () => {
    const game = table()
    game.deal()
    const pile = game.tileDesk().discard.length
    sweepOneValue(game)
    // Drafting is not spending: the pile is exactly as it was.
    expect(game.tileDesk().discard).toHaveLength(pile)
  })

  it('holds across a round-end sweep', () => {
    const game = table()
    game.deal()
    sweepOneValue(game)
    for (let i = 0; i < game.state.seats.length; i++) {
      game.play({ kind: 'pass', seat: game.state.activeSeat })
    }
    expect(game.state.round).toBe(2)
    expect(game.census()).toEqual(game.whole)
  })

  it('holds over a whole game, dealing and drafting throughout', () => {
    const game = table()
    let guard = 0
    while (!game.state.finished && guard++ < 400) {
      game.deal()
      if (!sweepOneValue(game)) game.play({ kind: 'pass', seat: game.state.activeSeat })
      expect(game.census()).toEqual(game.whole)
    }
    expect(game.state.finished).toBe(true)
  })

  /*
   * The same protocol at the largest table and the largest desks. The cases above would all pass with
   * three seats and 108 tiles hardcoded somewhere downstream; this one would not.
   */
  it('holds for four seats and the biggest bags the settings offer', () => {
    const game = table({ players: 4, tileCopies: 4, plateCopies: 3 })
    expect(game.whole).toEqual({ tiles: 144, plates: 108 })

    let guard = 0
    while (!game.state.finished && guard++ < 400) {
      game.deal()
      if (!sweepOneValue(game)) game.play({ kind: 'pass', seat: game.state.activeSeat })
      expect(game.census()).toEqual(game.whole)
    }
    expect(game.state.finished).toBe(true)
  })
})
