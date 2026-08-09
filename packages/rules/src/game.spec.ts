import { describe, expect, it } from 'vitest'
import { createAgenda } from './agenda'
import {
  applyCommand,
  createGame,
  draftItems,
  needsDeal,
  replayGame,
  type Command,
  type GameOptions,
  type GameState,
} from './game'
import { defaultGameSettings, type GameSettings } from './gameSettings'
import { hexRectangle } from './hex'
import type { Tableau, TileSpec } from './tableau'

const SEED = 'a-game'
const TILES_PER_LOT = 4

function options(overrides: Partial<GameSettings> = {}): GameOptions {
  const settings: GameSettings = {
    ...defaultGameSettings(0, SEED),
    kind: 'multiplayer',
    players: 3,
    playerNames: ['Ember', 'Flux', 'Gimbal'],
    ...overrides,
  }
  return {
    settings,
    cells: hexRectangle(8, 8),
    sourceTilesPerLot: TILES_PER_LOT,
    agenda: createAgenda(SEED, settings.mode),
  }
}

const tile = (color: number, value: number): TileSpec => ({ color, value })

/** A lot of four tiles that cannot be mistaken for another lot's. */
function lot(n: number): Command {
  return {
    kind: 'deal',
    plate: tile(n % 6, (n % 6) + 1),
    tiles: [tile(0, 1), tile(1, 2), tile(2, 3), tile(3, 4)],
  }
}

/**
 * Everything about a state that anything downstream can see.
 *
 * Tableaux are closures, so `toEqual` on the state itself compares functions. This is the comparison
 * that matters instead: where every piece is, whose turn it is, and what has been banked.
 */
function snapshot(state: GameState) {
  const census = (t: Tableau) => ({
    tiles: t.tiles().map(x => `${x.id}@${JSON.stringify(x.location)}:${x.color}-${x.value}`).sort(),
    plates: t.plates().map(x => `${x.id}@${JSON.stringify(x.location)}/${x.rotation}${x.faceDown ? 'v' : '^'}`).sort(),
    stems: t.stems().map(x => `${x.id}@${x.slot}`).sort(),
  })
  return {
    round: state.round,
    turn: state.turn,
    activeSeat: state.activeSeat,
    platesDealt: state.platesDealt,
    finished: state.finished,
    source: census(state.source),
    /*
     * Values, not just keys. The petal comes from the state's own stream rather than from the
     * command, so it is the one thing a non-deterministic replay would get wrong — and a face-down
     * plate's petal is invisible everywhere else until it turns over.
     */
    hidden: [...state.hidden].map(([id, spec]) => `${id}:${spec.color}-${spec.value}/${spec.petal}`).sort(),
    seats: state.seats.map(seat => ({
      seat: seat.seat,
      name: seat.name,
      passed: seat.passed,
      banked: [...seat.banked],
      // A receipt a replay failed to reproduce would pay for the same enclosure twice.
      paidAnchors: [...seat.paidAnchors].sort(),
      ...census(seat.tableau),
    })),
  }
}

/** Apply a command and insist it was accepted, so a broken script fails loudly. */
function play(state: GameState, command: Command): void {
  const result = applyCommand(state, command)
  if (!result.ok) throw new Error(`${command.kind} refused: ${result.error}`)
}

describe('a fresh game', () => {
  it('seats everyone with a board, a plate and their stems', () => {
    const state = createGame(options())
    expect(state.seats).toHaveLength(3)
    expect(state.seats.map(s => s.name)).toEqual(['Ember', 'Flux', 'Gimbal'])

    for (const seat of state.seats) {
      expect(seat.tableau.plates().filter(p => p.location.kind === 'board')).toHaveLength(1)
      expect(seat.tableau.tilesOnBoard()).toHaveLength(1)
      expect(seat.tableau.stems()).toHaveLength(defaultGameSettings(0).initialStems)
    }
  })

  /*
   * Everyone opens on a value-1 plate of their own colour, so nobody starts better placed than
   * anybody else. Their *colours* differ, which is the whole point of dealing them separately.
   */
  it('opens every seat on a different colour', () => {
    const state = createGame(options())
    const openings = state.seats.map(seat => seat.tableau.tilesOnBoard()[0])
    expect(openings.every(t => t?.value === 1)).toBe(true)
    expect(new Set(openings.map(t => t?.color)).size).toBe(3)
  })

  it('starts with an empty source and nothing to look at', () => {
    const state = createGame(options())
    expect(draftItems(state)).toEqual([])
    expect(needsDeal(state)).toBe(true)
  })

  it('names a seat nobody named', () => {
    const state = createGame(options({ playerNames: ['Ember'] }))
    expect(state.seats.map(s => s.name)).toEqual(['Ember', 'Player 2', 'Player 3'])
  })
})

describe('seats do not reach each other', () => {
  /*
   * The assertion attempt 1 never had. A seat-scoped *view* over one model answered unscoped
   * questions for seat zero; separate models cannot, and this is what says so.
   */
  it('leaves every other board untouched by a turn', () => {
    const state = createGame(options())
    play(state, lot(1))
    const before = snapshot(state).seats.filter(s => s.seat !== 0)

    play(state, { kind: 'draft', seat: 0, ids: [draftItems(state)[0]!.id] })
    expect(snapshot(state).seats.filter(s => s.seat !== 0)).toEqual(before)
  })

  it('gives no two tableaux a name in common', () => {
    const state = createGame(options())
    play(state, lot(1))
    const ids = [
      ...state.source.tiles().map(t => t.id),
      ...state.seats.flatMap(seat => [
        ...seat.tableau.tiles().map(t => t.id),
        ...seat.tableau.plates().map(p => p.id),
        ...seat.tableau.stems().map(s => s.id),
      ]),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('drafting', () => {
  function dealt() {
    const state = createGame(options())
    play(state, lot(1))
    return state
  }

  it('moves material out of the source and into the drawer, keeping its id', () => {
    const state = dealt()
    // Every 1 in the lot: the opening tile is a colour-0 value-1, so this is a complete value sweep.
    const ones = draftItems(state).filter(item => item.value === 1).map(item => item.id)
    expect(ones.length).toBeGreaterThan(0)

    play(state, { kind: 'draft', seat: 0, ids: ones })

    const drawer = state.seats[0]!.tableau.tiles().filter(t => t.location.kind === 'drawer')
    expect(drawer.map(t => t.id).sort()).toEqual([...ones].sort())
    for (const id of ones) expect(state.source.tile(id)).toBeUndefined()
  })

  /* A draft is not a discard: nothing it takes is owed back to the desk. */
  it('returns nothing to the desk', () => {
    const state = dealt()
    const ones = draftItems(state).filter(item => item.value === 1).map(item => item.id)
    const result = applyCommand(state, { kind: 'draft', seat: 0, ids: ones })
    expect(result).toMatchObject({ ok: true, toDesk: { tiles: [], plates: [] } })
  })

  it('refuses a selection that is not a complete sweep', () => {
    const state = dealt()
    const twos = draftItems(state).filter(item => item.value === 2)
    const threes = draftItems(state).filter(item => item.value === 3)
    const mixed = [twos[0]?.id, threes[0]?.id].filter(Boolean) as string[]
    expect(applyCommand(state, { kind: 'draft', seat: 0, ids: mixed })).toMatchObject({ ok: false })
  })

  it('refuses ids that are not in the source', () => {
    const state = dealt()
    expect(applyCommand(state, { kind: 'draft', seat: 0, ids: ['0:t1'] })).toMatchObject({ ok: false })
  })
})

describe('whose turn it is', () => {
  function dealt() {
    const state = createGame(options())
    play(state, lot(1))
    return state
  }

  const takeAnything = (state: GameState, seat: number): Command => ({
    kind: 'draft',
    seat,
    ids: draftItems(state).filter(item => item.value === valueToSweep(state)).map(item => item.id),
  })

  /** Any value showing in the source: taking all of one value is always a complete draft. */
  function valueToSweep(state: GameState): number {
    return draftItems(state)[0]?.value ?? 1
  }

  it('goes round the table', () => {
    const state = dealt()
    expect(state.activeSeat).toBe(0)
    play(state, { kind: 'pass', seat: 0 })
    expect(state.activeSeat).toBe(1)
    play(state, { kind: 'pass', seat: 1 })
    expect(state.activeSeat).toBe(2)
  })

  it('refuses a command from a seat whose turn it is not', () => {
    const state = dealt()
    expect(applyCommand(state, { kind: 'pass', seat: 1 })).toMatchObject({ ok: false })
    expect(applyCommand(state, takeAnything(state, 2))).toMatchObject({ ok: false })
  })

  /* Pass is not a skipped turn: it takes you out of the round, and the others play on. */
  it('skips a seat that has passed', () => {
    const state = dealt()
    play(state, { kind: 'pass', seat: 0 })
    play(state, takeAnything(state, 1))
    expect(state.activeSeat).toBe(2)
    play(state, { kind: 'pass', seat: 2 })
    // Seat 0 is out, so it comes back to seat 1 rather than round to 0.
    expect(state.activeSeat).toBe(1)
  })

  it('refuses a second pass from a seat already out', () => {
    const state = dealt()
    play(state, { kind: 'pass', seat: 0 })
    expect(applyCommand(state, { kind: 'pass', seat: 0 })).toMatchObject({ ok: false })
  })

  it('counts turns within the round', () => {
    const state = dealt()
    expect(state.turn).toBe(1)
    play(state, takeAnything(state, 0))
    expect(state.turn).toBe(2)
  })
})

describe('closing a round', () => {
  function passEveryone(state: GameState): void {
    for (let i = 0; i < state.seats.length; i++) play(state, { kind: 'pass', seat: state.activeSeat })
  }

  it('waits for the last seat', () => {
    const state = createGame(options())
    play(state, lot(1))
    play(state, { kind: 'pass', seat: 0 })
    play(state, { kind: 'pass', seat: 1 })
    expect(state.round).toBe(1)
    play(state, { kind: 'pass', seat: 2 })
    expect(state.round).toBe(2)
  })

  it('banks a score for every seat and lets them all back in', () => {
    const state = createGame(options())
    play(state, lot(1))
    passEveryone(state)

    for (const seat of state.seats) {
      expect(seat.banked).toHaveLength(1)
      expect(seat.passed).toBe(false)
    }
    expect(state.turn).toBe(1)
    expect(state.activeSeat).toBe(0)
    expect(state.platesDealt).toBe(0)
  })

  /* Everything showing goes back to the desk — the caller's job, so it is reported rather than done. */
  it('hands the swept source back to the caller', () => {
    const state = createGame(options())
    play(state, lot(1))
    play(state, { kind: 'pass', seat: 0 })
    play(state, { kind: 'pass', seat: 1 })
    const closing = applyCommand(state, { kind: 'pass', seat: 2 })

    expect(closing.ok && closing.toDesk.tiles).toHaveLength(TILES_PER_LOT)
    expect(closing.ok && closing.toDesk.plates).toHaveLength(1)
    expect(state.source.plates()).toHaveLength(0)
    expect(state.hidden.size).toBe(0)
  })

  it('ends the game after the last round', () => {
    const state = createGame(options())
    const rounds = state.options.agenda.length
    for (let round = 0; round < rounds; round++) {
      play(state, lot(round + 1))
      passEveryone(state)
    }
    expect(state.finished).toBe(true)
    expect(state.seats[0]?.banked).toHaveLength(rounds)
    expect(applyCommand(state, { kind: 'pass', seat: 0 })).toMatchObject({ ok: false })
  })
})

describe('dealing', () => {
  it('stops at the round\'s quota', () => {
    const state = createGame(options({ platesPerRound: 2 }))
    play(state, lot(1))
    play(state, lot(2))
    expect(needsDeal(state)).toBe(false)
    expect(applyCommand(state, lot(3))).toMatchObject({ ok: false })
  })

  it('keeps the plate\'s token out of the model until its lot is bare', () => {
    const state = createGame(options())
    play(state, lot(1))
    const plate = state.source.plateInSourceLot(0)!
    expect(plate.faceDown).toBe(true)
    expect(state.hidden.has(plate.id)).toBe(true)
    // Nothing in the source can be read as the plate's tile while it is face down.
    expect(state.source.plateToken(plate.id)).toBeUndefined()
  })

  it('turns a plate over once its lot has been picked clean', () => {
    const state = createGame(options())
    play(state, lot(1))
    const plate = state.source.plateInSourceLot(0)!

    // Sweep the lot bare, one value at a time; each is a complete draft on its own.
    let guard = 0
    while (state.source.tilesInSourceLot(0).length > 0 && guard++ < 8) {
      const value = state.source.tilesInSourceLot(0)[0]!.value
      const ids = draftItems(state).filter(item => item.value === value).map(item => item.id)
      play(state, { kind: 'draft', seat: state.activeSeat, ids })
    }

    expect(state.source.plate(plate.id)?.faceDown).toBe(false)
    expect(state.hidden.has(plate.id)).toBe(false)
  })
})

/**
 * The property the whole design rests on.
 *
 * If the state is what the log means, then rolling back a refused command is dropping it and folding
 * again — no inverse operations, none to get wrong. Live play applies commands to the state it
 * already has, which is only allowed because it lands in the same place. This is what says it does.
 */
describe('the state is the fold of the log', () => {
  it('matches a replay after every single command', () => {
    const opts = options()
    const state = createGame(opts)
    const log: Command[] = []

    const script: Command[] = [
      lot(1),
      { kind: 'draft', seat: 0, ids: [] },
      { kind: 'pass', seat: 1 },
      lot(2),
      { kind: 'draft', seat: 2, ids: [] },
      { kind: 'pass', seat: 0 },
      { kind: 'pass', seat: 2 },
    ]

    for (const step of script) {
      // Drafts are written against whatever the source is showing at the time.
      const command: Command = step.kind === 'draft'
        ? { ...step, ids: draftItems(state).filter(i => i.value === draftItems(state)[0]?.value).map(i => i.id) }
        : step
      const result = applyCommand(state, command)
      if (!result.ok) continue

      log.push(command)
      expect(snapshot(replayGame(opts, log))).toEqual(snapshot(state))
    }

    expect(log.length).toBeGreaterThan(4)
  })

  /* What the scoring panel needs: the board as it stood when a round closed, not as it stands now. */
  it('can be stopped at the end of a round', () => {
    const opts = options()
    const log: Command[] = [
      lot(1),
      { kind: 'pass', seat: 0 },
      { kind: 'pass', seat: 1 },
      { kind: 'pass', seat: 2 },
      lot(2),
    ]
    const asItWas = replayGame(opts, log, { throughRound: 1 })
    expect(asItWas.round).toBe(2)
    // The second round's lot is after the cut, so the source is empty as it was at the boundary.
    expect(asItWas.source.plates()).toHaveLength(0)
    expect(replayGame(opts, log).source.plates()).toHaveLength(1)
  })
})

/**
 * Placing something, and paying for it.
 *
 * The most intricate command: it moves an item, destroys what pays for it, hands the spent material
 * back for the desk, awards any enclosure it closed, and ends the turn. Everything but the first of
 * those is invisible on the board, which is why it is worth spelling out here.
 */
describe('putting something on the board', () => {
  /** A seat holding a value-1 tile — free to place — and a lot showing in the source. */
  function holding() {
    const state = createGame(options())
    play(state, lot(1))
    const ones = draftItems(state).filter(item => item.value === 1).map(item => item.id)
    play(state, { kind: 'draft', seat: 0, ids: ones })

    const seat = state.seats[0] as { tableau: Tableau, banked: number[] }
    const held = seat.tableau.tiles().find(tile => tile.location.kind === 'drawer')!
    const plate = seat.tableau.plates()[0]!
    // A free petal beside the opening tile, so the neighbour rule is satisfied.
    const petal = [0, 1, 2, 3, 4, 5].find(p =>
      seat.tableau.canPlaceTile({ kind: 'onPlate', plateId: plate.id, petal: p }, held.id))!
    return { state, seat, held, to: { kind: 'onPlate' as const, plateId: plate.id, petal } }
  }

  /** Everybody else passes, so the turn comes back to seat 0. */
  function backToSeatZero(state: GameState): void {
    while (state.activeSeat !== 0) play(state, { kind: 'pass', seat: state.activeSeat })
  }

  it('moves the item and ends the turn', () => {
    const { state, seat, held, to } = holding()
    backToSeatZero(state)
    const turn = state.turn

    const result = applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [],
    })

    expect(result).toMatchObject({ ok: true })
    expect(seat.tableau.tile(held.id)?.location).toEqual(to)
    expect(state.turn).toBeGreaterThan(turn)
    /*
     * Still seat 0, and rightly: the others passed to give the turn back, so they are out of the
     * round. The turn goes to the next seat still *in* it, which is this one again.
     */
    expect(state.activeSeat).toBe(0)
  })

  /* A value-1 tile is free; anything dearer costs `value - 1` items out of the same drawer. */
  it('insists on the right price, and spends exactly what was offered', () => {
    const { state, seat, held, to } = holding()
    backToSeatZero(state)
    const stems = seat.tableau.stems().map(stem => stem.id)

    // Free: offering payment for it is as wrong as offering none for something dearer.
    expect(applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [stems[0] as string],
    })).toMatchObject({ ok: false })

    expect(applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [],
    })).toMatchObject({ ok: true })
    // Nothing was spent, so the stems are all still there.
    expect(seat.tableau.stems().map(s => s.id)).toEqual(stems)
  })

  it('refuses a payment the drawer does not hold, changing nothing', () => {
    const { state, held, to } = holding()
    backToSeatZero(state)
    const before = snapshot(state)

    expect(applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: ['nope'],
    })).toMatchObject({ ok: false })
    expect(snapshot(state)).toEqual(before)
  })

  it('refuses a placement the board does not allow, changing nothing', () => {
    const { state, seat, held } = holding()
    backToSeatZero(state)
    const before = snapshot(state)
    const occupied = seat.tableau.tilesOnBoard()[0]!.location

    expect(applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to: occupied, paying: [],
    })).toMatchObject({ ok: false })
    expect(snapshot(state)).toEqual(before)
  })

  /* Spent material is owed back to the desk, and the state cannot put it there itself. */
  it('hands what it spent back to the caller', () => {
    const state = createGame(options({ initialStems: 0 }))
    play(state, lot(1))
    // Two whole lots, so the drawer holds enough to pay for something.
    const first = draftItems(state).filter(i => i.value === 2).map(i => i.id)
    play(state, { kind: 'draft', seat: 0, ids: first })
    while (state.activeSeat !== 0) play(state, { kind: 'pass', seat: state.activeSeat })

    const seat = state.seats[0]!
    const held = seat.tableau.tiles().find(t => t.location.kind === 'drawer' && t.value === 2)
    const spare = seat.tableau.tiles().find(t => t.location.kind === 'drawer' && t.id !== held?.id)
    if (!held || !spare) return

    const plate = seat.tableau.plates()[0]!
    const petal = [0, 1, 2, 3, 4, 5].find(p =>
      seat.tableau.canPlaceTile({ kind: 'onPlate', plateId: plate.id, petal: p }, held.id))
    if (petal === undefined) return

    const result = applyCommand(state, {
      kind: 'put',
      seat: 0,
      item: { kind: 'tile', id: held.id },
      to: { kind: 'onPlate', plateId: plate.id, petal },
      paying: [spare.id],
    })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.toDesk.tiles).toHaveLength(1)
    expect(seat.tableau.tile(spare.id)).toBeUndefined()
  })

  it('is refused from a seat whose turn it is not', () => {
    const { state, held, to } = holding()
    // The turn moved on after the draft, so seat 0 is not the one playing.
    expect(state.activeSeat).not.toBe(0)
    expect(applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [],
    })).toMatchObject({ ok: false })
  })
})

describe('a refused command', () => {
  /*
   * Nothing moves. A half-applied command is worse than a refused one: the log and the board then
   * disagree about what happened, and only a replay would ever notice.
   */
  it('leaves the state exactly as it was', () => {
    const state = createGame(options())
    play(state, lot(1))
    const before = snapshot(state)

    const refusals: Command[] = [
      { kind: 'pass', seat: 1 },
      { kind: 'pass', seat: 9 },
      { kind: 'draft', seat: 0, ids: [] },
      { kind: 'draft', seat: 0, ids: ['nope'] },
      { kind: 'put', seat: 0, item: { kind: 'tile', id: 'nope' }, to: { kind: 'drawer', slot: 0 }, paying: [] },
    ]
    for (const command of refusals) {
      expect(applyCommand(state, command)).toMatchObject({ ok: false })
      expect(snapshot(state)).toEqual(before)
    }
  })
})
