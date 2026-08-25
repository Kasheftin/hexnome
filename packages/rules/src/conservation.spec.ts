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
  undiscardFromDesk,
  undrawFromDesk,
  type DeskState,
} from './desk'
import {
  applyCommand,
  canUndo,
  createGame,
  draftItems,
  needsDeal,
  planUndo,
  replayGame,
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
  /* Quick mode is a solo mode, so a table for it sets both of these together. */
  readonly kind?: GameSettings['kind']
  readonly mode?: GameSettings['mode']
  readonly platesPerRound?: number
}

/**
 * A whole game reduced to the parts that move material: two desks and a state driven by commands.
 *
 * The desks are the real ones, driven in process rather than over HTTP — what a server adds is
 * storage and validation, and the arithmetic under test is the same either way.
 */
function table({
  players = 3,
  tileCopies = 3,
  plateCopies = 1,
  kind = 'multiplayer',
  mode,
  platesPerRound,
}: Table = {}) {
  const base = defaultGameSettings(0)
  const settings: GameSettings = {
    ...base,
    kind,
    players,
    tileCopies,
    plateCopies,
    mode: mode ?? base.mode,
    platesPerRound: platesPerRound ?? base.platesPerRound,
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
   * A quick game, which is a different *shape* of game rather than a different set of targets: one
   * round, no agenda, and four times the plates. It is here because conservation is the property most
   * likely to break on a shape change — the round-end sweep runs once instead of four times, and it
   * runs against a source dealt far wider than any classic round deals.
   */
  it('holds over a whole quick game, which is one long round', () => {
    const game = table({ kind: 'singleplayer', players: 1, mode: 'quick', platesPerRound: 12 })

    let guard = 0
    while (!game.state.finished && guard++ < 400) {
      game.deal()
      if (!sweepOneValue(game)) game.play({ kind: 'pass', seat: game.state.activeSeat })
      expect(game.census()).toEqual(game.whole)
    }
    expect(game.state.finished).toBe(true)
    // The point of the mode: it ended, and it ended without ever reaching a second round.
    expect(game.state.round).toBe(1)
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

/**
 * Conservation across an undo, which is the one place it can quietly break.
 *
 * Everything above drives the state directly; undo cannot be tested that way, because it is not a
 * change to a state at all — it is a change to the **log**, and the position afterwards is a fresh
 * fold of what survives. So this harness models what the server actually does: keep a log, fold it for
 * the position, and drive the two desks alongside it.
 *
 * The desks are the whole risk. A re-fold puts the board, the drawers and the source back on its own,
 * so a bug there shows up immediately and loudly. A bug in handing the bags back does not: the tiles
 * are simply gone from the game, the position looks perfectly reasonable, and the only symptom is a
 * deck that runs out early several rounds later.
 */
function servedTable({ tileCopies = 3, plateCopies = 1 } = {}) {
  const settings: GameSettings = {
    ...defaultGameSettings(0),
    kind: 'singleplayer',
    players: 1,
    tileCopies,
    plateCopies,
    allowUndo: true,
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
  let plateDesk = built('plates', plateCopies, openingPlateCodes(SEED, 1))
  const log: Command[] = []

  const specOf = (code: number): TileSpec => {
    const spec = tileFromCode(code)
    if (!spec) throw new Error(`${code} is not a tile code`)
    return spec
  }

  const state = () => replayGame(options, log)

  function discard(which: 'tiles' | 'plates', items: readonly TileSpec[]): void {
    if (items.length === 0) return
    const desk = which === 'tiles' ? tileDesk : plateDesk
    const result = discardToDesk(desk, items.map(tileCode))
    if (!result.ok) throw new Error(result.error)
    if (which === 'tiles') tileDesk = result.value
    else plateDesk = result.value
  }

  /** Fill the source while it wants filling, drawing from the bags exactly as the server does. */
  function restock(): void {
    const live = state()
    while (needsDeal(live)) {
      if (deskRemaining(plateDesk) < 1 || deskRemaining(tileDesk) < TILES_PER_LOT) break
      const plateDraw = drawFromDesk(plateDesk, 1)
      const tileDraw = drawFromDesk(tileDesk, TILES_PER_LOT)
      if (!plateDraw.ok || !tileDraw.ok) break
      plateDesk = plateDraw.value.state
      tileDesk = tileDraw.value.state
      const deal: Command = {
        kind: 'deal',
        plate: specOf(plateDraw.value.codes[0] as number),
        tiles: tileDraw.value.codes.map(specOf),
      }
      if (!applyCommand(live, deal).ok) break
      log.push(deal)
    }
  }

  /** One turn, the way `TurnsService.submit` does it: apply, restock, then hand back what it spent. */
  function submit(command: Command): boolean {
    const played = applyCommand(state(), command)
    if (!played.ok) return false
    log.push(command)
    restock()

    // The pile is the desk's, and the state cannot reach it.
    discard('tiles', played.toDesk.tiles)
    discard('plates', played.toDesk.plates)
    return true
  }

  // The opening lot, written before anybody plays — `TurnsService.open`. Without it the first turn
  // would have nothing to draft from, which is exactly what it used to be.
  restock()

  /** Take the last turn back, rewinding both bags — `TurnsService.takeBack` in miniature. */
  function undo(): boolean {
    if (!canUndo(options, log)) return false
    const plan = planUndo(options, log)

    for (const [which, drew, returned] of [
      ['tiles', plan.dealt.tiles, plan.returned.tiles],
      ['plates', plan.dealt.plates, plan.returned.plates],
    ] as const) {
      const desk = which === 'tiles' ? tileDesk : plateDesk
      // The reverse of the order the turn played them: the pile first, then the draw.
      const unpiled = undiscardFromDesk(desk, returned.map(tileCode))
      if (!unpiled.ok) throw new Error(unpiled.error)
      const undrawn = undrawFromDesk(unpiled.value, drew.map(tileCode))
      if (!undrawn.ok) throw new Error(undrawn.error)
      if (which === 'tiles') tileDesk = undrawn.value
      else plateDesk = undrawn.value
    }

    log.push({ kind: 'undo', seat: 0 })
    return true
  }

  function census() {
    const live = state()
    const tilesIn = (t: { tiles: () => readonly { fixed: boolean }[] }) =>
      t.tiles().filter(tile => !tile.fixed).length
    const platesIn = (t: { plates: () => readonly unknown[] }) => t.plates().length

    let tiles = deskRemaining(tileDesk) + tilesIn(live.source)
    let plates = deskRemaining(plateDesk) + platesIn(live.source)
    for (const seat of live.seats) {
      tiles += tilesIn(seat.tableau)
      plates += platesIn(seat.tableau)
    }
    return { tiles, plates }
  }

  return {
    state,
    submit,
    undo,
    census,
    log,
    whole: { tiles: DISTINCT_TILES * tileCopies, plates: DISTINCT_TILES * plateCopies },
    desks: () => ({ tiles: tileDesk, plates: plateDesk }),
  }
}

/** A complete draft off whatever is showing, one id per kind. False when nothing can be taken. */
function sweepServed(game: ReturnType<typeof servedTable>): boolean {
  const items = draftItems(game.state())
  for (const value of new Set(items.map(item => item.value))) {
    const oneEach = new Map<string, string>()
    for (const item of items) {
      if (item.value === value) oneEach.set(`${item.color}:${item.value}`, item.id)
    }
    if (game.submit({ kind: 'draft', seat: 0, ids: [...oneEach.values()] })) return true
  }
  return false
}

describe('conservation across an undo', () => {
  it('opens with the whole deck accounted for', () => {
    const game = servedTable()
    game.submit({ kind: 'pass', seat: 0 })
    expect(game.census()).toEqual(game.whole)
  })

  it('loses nothing when a draft is taken back', () => {
    const game = servedTable()
    // An opening lot to draft from.
    expect(sweepServed(game)).toBe(true)
    expect(game.census()).toEqual(game.whole)

    expect(game.undo()).toBe(true)
    expect(game.census()).toEqual(game.whole)
  })

  it('puts the bags back byte for byte, not merely by count', () => {
    /*
     * A count is not enough. A bag drained and refilled from the wrong end conserves every tile and
     * still deals a different game — which is the failure this whole rewind exists to prevent, and the
     * one a census cannot see.
     */
    const game = servedTable()
    // A deep copy, since the desks are handed back by reference and the test is about their contents.
    const before = JSON.parse(JSON.stringify(game.desks())) as unknown

    expect(sweepServed(game)).toBe(true)
    expect(game.undo()).toBe(true)
    expect(JSON.parse(JSON.stringify(game.desks()))).toEqual(before)
  })

  it('holds over a run of turns and undos', () => {
    const game = servedTable()
    for (let round = 0; round < 6; round++) {
      if (!sweepServed(game)) break
      expect(game.census()).toEqual(game.whole)
      if (round % 2 === 0) {
        expect(game.undo()).toBe(true)
        expect(game.census()).toEqual(game.whole)
      }
    }
    expect(game.census()).toEqual(game.whole)
  })

  it('leaves the position identical to the one the turn was played from', () => {
    const game = servedTable()
    expect(sweepServed(game)).toBe(true)
    const before = game.census()
    const beforeState = game.state()

    expect(sweepServed(game)).toBe(true)
    expect(game.undo()).toBe(true)

    expect(game.census()).toEqual(before)
    expect(game.state().turn).toBe(beforeState.turn)
    expect(game.state().seats[0]!.tableau.tiles().length)
      .toBe(beforeState.seats[0]!.tableau.tiles().length)
  })
})
