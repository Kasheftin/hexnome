import { describe, expect, it } from 'vitest'
import { createAgenda } from './agenda'
import {
  applyCommand,
  createGame,
  draftItems,
  needsDeal,
  paymentPurse,
  replayGame,
  type Command,
  type GameOptions,
  type GameState,
} from './game'
import { defaultGameSettings, SOLO, type GameSettings } from './gameSettings'
import { hexRectangle } from './hex'
import type { Tableau, TileSpec } from './tableau'

const SEED = 'a-game'
const TILES_PER_LOT = 4

function options(overrides: Partial<GameSettings> = {}): GameOptions {
  const settings: GameSettings = {
    ...defaultGameSettings(0),
    kind: 'multiplayer',
    players: 3,
    playerNames: ['Ember', 'Flux', 'Gimbal'],
    /*
     * Off unless a test asks for it, so that everywhere else a banked score is the round's targets
     * and nothing else. A real table defaults it on — see `DEFAULT_FIRST_PASS_FINE`.
     */
    firstPassFine: 0,
    ...overrides,
  }
  return {
    settings,
    // The public seed: the opening plates and the petal stream, and nothing a player could not see.
    gameId: SEED,
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
    firstToPass: state.firstToPass,
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
      fined: [...seat.fined],
      anchored: [...seat.anchored],
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

describe('anchor points', () => {
  /**
   * A plate dropped straight onto a seat's board.
   *
   * Placing one properly means drafting it, holding it in a bay and paying for it — three turns of
   * setup for a test about what a board is worth once the plate is on it. `closeRound` reads the
   * board, so this is the board it would read.
   */
  function addPlateAt(state: GameState, seat: number, hole: { q: number, r: number }): void {
    const placed = state.seats[seat]!.tableau.addPlate({ kind: 'board', hole })
    if (!placed) throw new Error(`no room for a plate at ${hole.q},${hole.r}`)
  }

  function closeARound(state: GameState): void {
    play(state, lot(1))
    for (let i = 0; i < state.seats.length; i++) play(state, { kind: 'pass', seat: state.activeSeat })
  }

  it('pays for the opening plate, which every seat has', () => {
    // One plate is one internal anchor, always — so at the default rate every board opens worth 1.
    const state = createGame(options({ pointsPerInternalAnchor: 1, pointsPerExternalAnchor: 0 }))
    closeARound(state)

    expect(state.seats.map(seat => seat.anchored)).toEqual([[1], [1], [1]])
  })

  it('pays per anchor, so a wider board is worth more', () => {
    const state = createGame(options({ pointsPerInternalAnchor: 1 }))
    addPlateAt(state, 1, { q: 3, r: 0 })
    addPlateAt(state, 1, { q: -3, r: 0 })
    closeARound(state)

    expect(state.seats[0]!.anchored).toEqual([1])
    expect(state.seats[1]!.anchored).toEqual([3])
  })

  it('adds them to what the seat banks', () => {
    const paying = createGame(options({ pointsPerInternalAnchor: 2 }))
    const free = createGame(options({ pointsPerInternalAnchor: 0, pointsPerExternalAnchor: 0 }))
    closeARound(paying)
    closeARound(free)

    expect(paying.seats[0]!.banked[0]).toBe(free.seats[0]!.banked[0]! + 2)
    expect(free.seats[0]!.anchored).toEqual([0])
  })

  /**
   * The compounding the rule exists for: a plate pays its anchor again every round it survives.
   *
   * One extra plate placed before the first round closes is worth one point per round for the rest of
   * the game, which is what makes spending an early turn on width worth anything at all.
   */
  it('pays again in every round, so an early plate compounds', () => {
    const state = createGame(options({ pointsPerInternalAnchor: 1 }))
    addPlateAt(state, 1, { q: 3, r: 0 })

    const rounds = state.options.agenda.length
    for (let round = 0; round < rounds; round++) closeARound(state)

    expect(state.seats[0]!.anchored).toEqual(Array.from({ length: rounds }, () => 1))
    expect(state.seats[1]!.anchored).toEqual(Array.from({ length: rounds }, () => 2))
    // Four rounds of one extra plate is four points, not one.
    const gap = state.seats[1]!.anchored.reduce((a, b) => a + b, 0)
      - state.seats[0]!.anchored.reduce((a, b) => a + b, 0)
    expect(gap).toBe(rounds)
  })

  it('pays for an external anchor at its own rate', () => {
    /*
     * Two more plates, arranged so they wrap a bare cell at (-2, 1): covered on all six sides and
     * covered by nothing, which is what an external anchor is. Plates need only connect, not
     * interlock, so a gap like this is a thing a board can genuinely end up with.
     */
    const state = createGame(options({ pointsPerInternalAnchor: 0, pointsPerExternalAnchor: 2 }))
    addPlateAt(state, 1, { q: -3, r: 0 })
    addPlateAt(state, 1, { q: -3, r: 3 })
    const wrapped = state.seats[1]!.tableau.anchors().filter(anchor => anchor.kind === 'external')
    expect(wrapped).toHaveLength(1)

    closeARound(state)

    // Internal anchors pay nothing here, so the whole figure is the one wrapped gap.
    expect(state.seats[0]!.anchored).toEqual([0])
    expect(state.seats[1]!.anchored).toEqual([2])
  })

  /* Enclosure is what the *stem* rates pay for. These pay for the hole being there. */
  it('does not ask whether an anchor is enclosed', () => {
    const state = createGame(options({ pointsPerInternalAnchor: 1 }))
    const board = state.seats[0]!.tableau
    expect(board.anchors().every(anchor => !board.anchorIsEnclosed(anchor.cell))).toBe(true)
    closeARound(state)

    expect(state.seats[0]!.anchored).toEqual([1])
  })
})

describe('passing first', () => {
  /**
   * A round where seat 1 leaves first.
   *
   * Seat 0 has to do something that is not a pass, or it would be the one that left first and the
   * rule would be indistinguishable from "seat 0 always leads".
   */
  function seatOneLeavesFirst(state: GameState): void {
    play(state, lot(1))
    const ones = draftItems(state).filter(item => item.value === 1).map(item => item.id)
    play(state, { kind: 'draft', seat: 0, ids: ones })
    play(state, { kind: 'pass', seat: 1 })
    play(state, { kind: 'pass', seat: 2 })
    play(state, { kind: 'pass', seat: 0 })
  }

  it('charges the fine to the seat that left first, and to nobody else', () => {
    const state = createGame(options({ firstPassFine: 2 }))
    seatOneLeavesFirst(state)

    expect(state.seats.map(seat => seat.fined)).toEqual([[0], [2], [0]])
  })

  it('takes the fine out of what that seat banks', () => {
    const charged = createGame(options({ firstPassFine: 2 }))
    const free = createGame(options({ firstPassFine: 0 }))
    seatOneLeavesFirst(charged)
    seatOneLeavesFirst(free)

    // Banked is net, so nothing downstream has to remember to subtract it.
    expect(charged.seats[1]!.banked[0]).toBe(free.seats[1]!.banked[0]! - 2)
    expect(charged.seats[0]!.banked[0]).toBe(free.seats[0]!.banked[0])
  })

  it('gives that seat the first turn of the next round', () => {
    const state = createGame(options({ firstPassFine: 1 }))
    seatOneLeavesFirst(state)

    expect(state.round).toBe(2)
    expect(state.activeSeat).toBe(1)
  })

  it('hands over the turn even when the fine is nothing', () => {
    // The two halves are one rule but not one number: at 0 the turn order still moves.
    const state = createGame(options({ firstPassFine: 0 }))
    seatOneLeavesFirst(state)

    expect(state.activeSeat).toBe(1)
    expect(state.seats[1]!.fined).toEqual([0])
  })

  it('asks the question again each round', () => {
    const state = createGame(options({ firstPassFine: 1 }))
    seatOneLeavesFirst(state)

    // Round 2 opens on seat 1, and this time seat 2 is the one to leave.
    play(state, lot(2))
    const ones = draftItems(state).filter(item => item.value === 1).map(item => item.id)
    play(state, { kind: 'draft', seat: 1, ids: ones })
    play(state, { kind: 'pass', seat: 2 })
    play(state, { kind: 'pass', seat: 0 })
    play(state, { kind: 'pass', seat: 1 })

    expect(state.activeSeat).toBe(2)
    expect(state.seats.map(seat => seat.fined)).toEqual([[0, 0], [1, 0], [0, 1]])
  })

  it('never charges a solo game, whatever the settings say', () => {
    // One seat passes first by definition, so a fine there is a charge for reaching the end of a
    // round. Guarded where it is applied, not only where it is parsed.
    const state = createGame(options({
      kind: 'singleplayer',
      players: SOLO,
      playerNames: ['Solo'],
      firstPassFine: 2,
    }))
    play(state, lot(1))
    play(state, { kind: 'pass', seat: 0 })

    expect(state.seats[0]!.fined).toEqual([0])
    expect(state.activeSeat).toBe(0)
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

  /*
   * The column is a stack: a fresh lot goes to 0 and everything already there moves down exactly one.
   * Two shifts leave a hole between the new lot and the old one — which conservation cannot see,
   * because nothing is lost by moving twice, and a single-lot test cannot see either.
   */
  it('puts each new lot directly on top of the last, with no gap', () => {
    const state = createGame(options())
    play(state, lot(1))
    play(state, lot(2))

    expect(state.source.plateInSourceLot(0)).toBeDefined()
    expect(state.source.plateInSourceLot(1)).toBeDefined()
    expect(state.source.plateInSourceLot(2)).toBeUndefined()
    expect(state.source.tilesInSourceLot(1)).toHaveLength(TILES_PER_LOT)

    // And a third keeps the run unbroken.
    play(state, lot(3))
    for (const at of [0, 1, 2]) expect(state.source.plateInSourceLot(at)).toBeDefined()
    expect(state.source.plateInSourceLot(3)).toBeUndefined()
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

  /**
   * A plate is placed *turned*, and the log has to say so.
   *
   * Rotation happens in a bay, one press at a time, and it is not a turn — so it is not a command.
   * But it decides which cell each petal lands on, and therefore whether the placement is legal at
   * all. Without it in the `put`, a replay meets an unturned plate, refuses the placement, and
   * rebuilds a board with a tile missing. The only place that shows is the score.
   */
  it('replays a plate placed after turning it', () => {
    const opts = options()
    const state = createGame(opts)
    const log: Command[] = []
    const record = (command: Command): void => { play(state, command); log.push(command) }

    record(lot(1))
    // Pick the lot bare so its plate turns face up and can be drafted.
    let guard = 0
    while (state.source.tilesInSourceLot(0).length > 0 && guard++ < 8) {
      const value = state.source.tilesInSourceLot(0)[0]!.value
      const ids = draftItems(state).filter(item => item.value === value).map(item => item.id)
      record({ kind: 'draft', seat: state.activeSeat, ids })
    }

    const revealed = draftItems(state).find(item => item.kind === 'plate')
    expect(revealed).toBeDefined()
    while (state.activeSeat !== 0) record({ kind: 'pass', seat: state.activeSeat })
    record({ kind: 'draft', seat: 0, ids: [revealed!.id] })
    while (state.activeSeat !== 0) record({ kind: 'pass', seat: state.activeSeat })

    const seat = state.seats[0]!
    const held = seat.tableau.plates().find(p => p.location.kind === 'plateSlot')!
    // Turned in the bay, exactly as the rotate buttons do it — and not a command.
    seat.tableau.rotatePlate(held.id, 2)

    // Somewhere its flower fits and connects. Any hole the rules accept will do.
    const holes = [{ q: 3, r: -1 }, { q: 0, r: 3 }, { q: -3, r: 3 }, { q: 3, r: 0 }, { q: -3, r: 0 }]
    const hole = holes.find(h => seat.tableau.canPlacePlate({ kind: 'board', hole: h }, held.id))
    expect(hole).toBeDefined()

    // A plate costs its token's value minus one, paid out of the same drawer. Stems will do.
    const token = seat.tableau.plateToken(held.id)!
    const purse = [
      ...seat.tableau.stems().map(s => s.id),
      ...seat.tableau.tiles().filter(x => x.location.kind === 'drawer').map(x => x.id),
    ]
    const put: Command = {
      kind: 'put',
      seat: 0,
      item: { kind: 'plate', id: held.id },
      to: { kind: 'board', hole: hole! },
      paying: purse.slice(0, Math.max(0, token.value - 1)),
      rotation: seat.tableau.plate(held.id)!.rotation,
    }
    record(put)

    const refusals: string[] = []
    const rebuilt = replayGame(opts, log, { onRefused: (c, e) => refusals.push(`${c.kind}: ${e}`) })
    expect(refusals).toEqual([])

    const there = rebuilt.seats[0]!.tableau.plate(held.id)
    expect(there?.location).toEqual({ kind: 'board', hole: hole })
    expect(there?.rotation).toBe(put.rotation)
    // And the board is the same board, tile for tile — which is what the score is counted from.
    expect(snapshot(rebuilt).seats[0]).toEqual(snapshot(state).seats[0])
  })

  /**
   * Paying by colour.
   *
   * The purse the rules judge a payment against has to describe each payer completely — a drawer tile
   * arriving without its colour can only ever pay for something sharing its *value*, so a perfectly
   * ordinary "spend two purples on a purple" is refused with the button still lit. Which is exactly
   * what a second, hand-written purse in the view produced.
   */
  it('accepts a payment made on colour, with stems making up the rest', () => {
    const state = createGame(options({ players: 1 }))
    const seat = state.seats[0]!
    const opening = seat.tableau.tilesOnBoard()[0]!
    const colour = opening.color

    // A dear tile of the opening's colour, and two cheaper ones of the same colour to help pay.
    const held = seat.tableau.addTile({ color: colour, value: 5 }, { kind: 'drawer', slot: 3 })!
    const payA = seat.tableau.addTile({ color: colour, value: 2 }, { kind: 'drawer', slot: 4 })!
    const payB = seat.tableau.addTile({ color: colour, value: 3 }, { kind: 'drawer', slot: 5 })!
    const stems = seat.tableau.stems().map(stem => stem.id)

    const plate = seat.tableau.plates()[0]!
    const petal = [0, 1, 2, 3, 4, 5].find(p =>
      seat.tableau.canPlaceTile({ kind: 'onPlate', plateId: plate.id, petal: p }, held.id))
    expect(petal).toBeDefined()

    // Four items for a value-5 tile: two purples and two wilds.
    const result = applyCommand(state, {
      kind: 'put',
      seat: 0,
      item: { kind: 'tile', id: held.id },
      to: { kind: 'onPlate', plateId: plate.id, petal: petal! },
      paying: [payA.id, payB.id, stems[0] as string, stems[1] as string],
    })

    expect(result).toMatchObject({ ok: true })
    expect(seat.tableau.tile(held.id)?.location).toMatchObject({ kind: 'onPlate' })
    // The two tiles are owed back to the desk; the stems are not, an anchor minted them.
    expect(result.ok && result.toDesk.tiles).toHaveLength(2)
  })

  /* One purse, described once. The view used to build its own, and the two disagreed. */
  it('describes every payer completely', () => {
    const state = createGame(options({ players: 1 }))
    const seat = state.seats[0]!
    const tile = seat.tableau.addTile({ color: 3, value: 4 }, { kind: 'drawer', slot: 3 })!

    const purse = paymentPurse(seat.tableau)
    expect(purse.find(payer => payer.id === tile.id)).toEqual({
      id: tile.id, kind: 'tile', color: 3, value: 4,
    })
    // Stems have neither, which is what makes them wild rather than an oversight.
    expect(purse.filter(payer => payer.kind === 'stem').length).toBe(seat.tableau.stems().length)
  })

  /*
   * An enclosure pays in stems, and the view has to be told which ones — they appear in a drawer from
   * nowhere, and nothing else distinguishes them from the ones already sitting there.
   *
   * No early exits: a setup that quietly failed would leave this passing while proving nothing, which
   * is what the first version of it did.
   */
  it('names the stems an enclosure paid out', () => {
    const state = createGame(options({ players: 1, initialStems: 4 }))
    const seat = state.seats[0]!
    const plate = seat.tableau.plates()[0]!
    const token = seat.tableau.tilesOnBoard()[0]!
    const tokenPetal = token.location.kind === 'onPlate' ? token.location.petal : 0

    /*
     * Five petals of one flower filled and the sixth left open: placing into it closes the ring round
     * the plate's own anchor. All one colour and every value distinct, so no group holds a duplicate —
     * the token is a 1, so the ring takes 2, 3, 4, 6 and the placement is the 5.
     */
    const free = [0, 1, 2, 3, 4, 5].filter(petal => petal !== tokenPetal)
    const ring = free.slice(0, 4)
    const last = free[4] as number
    ring.forEach((petal, at) => {
      const value = [2, 3, 4, 6][at] as number
      const added = seat.tableau.addTile(
        { color: token.color, value },
        { kind: 'onPlate', plateId: plate.id, petal },
      )
      expect(added).toBeDefined()
    })

    const held = seat.tableau.addTile({ color: token.color, value: 5 }, { kind: 'drawer', slot: 4 })
    expect(held).toBeDefined()
    const stems = seat.tableau.stems().map(stem => stem.id)
    expect(stems).toHaveLength(4)

    const to = { kind: 'onPlate' as const, plateId: plate.id, petal: last }
    expect(seat.tableau.whyNotPlaceTile(to, held!.id)).toBeNull()

    // A value-5 tile costs four, and four wilds is exactly what the drawer holds.
    const result = applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held!.id }, to, paying: stems,
    })
    expect(result).toMatchObject({ ok: true })

    // The ring is closed, so the anchor pays — and every stem it minted is named.
    expect(result.ok && result.awarded.length).toBeGreaterThan(0)
    if (!result.ok) return
    for (const id of result.awarded) {
      expect(seat.tableau.stems().some(stem => stem.id === id)).toBe(true)
      // New ones, not the wilds just spent.
      expect(stems).not.toContain(id)
    }
  })

  /**
   * The reward is minted **after** the payment, so the payment's slots are room for it.
   *
   * Reported from a real game: two slots free, a value-2 tile to place, and an enclosure worth four
   * stems. Refused, because the drawer was counted as it stood at the start of the turn — two free
   * and the tile's own slot is three, one short. But the tile's single payer leaves the drawer in the
   * same turn, and four go into four.
   */
  function aboutToBePaidFour(stemsPerInternalAnchor: number, value: number) {
    const state = createGame(options({
      players: 1, initialStems: 1, tileSlots: 4, plateSlots: 2, stemsPerInternalAnchor,
      // The ring is all one colour and so encloses strictly; the bonus would make the reward five,
      // and this scenario is about the four.
      strictEnclosureBonus: 0,
    }))
    const seat = state.seats[0]!
    const plate = seat.tableau.plates()[0]!
    const token = seat.tableau.tilesOnBoard()[0]!
    const tokenPetal = token.location.kind === 'onPlate' ? token.location.petal : 0

    // Five of the six petals filled, all one colour and every value distinct, so the ring agrees and
    // no group holds a duplicate. The token is a 1 and the placement is `value`, so the ring avoids
    // both.
    const free = [0, 1, 2, 3, 4, 5].filter(petal => petal !== tokenPetal)
    const spare = [2, 3, 4, 5, 6].filter(v => v !== value)
    free.slice(0, 4).forEach((petal, at) => {
      const added = seat.tableau.addTile(
        { color: token.color, value: spare[at] as number },
        { kind: 'onPlate', plateId: plate.id, petal },
      )
      expect(added).toBeDefined()
    })

    const held = seat.tableau.addTile({ color: token.color, value }, { kind: 'drawer', slot: 1 })
    expect(held).toBeDefined()
    // One stem to pay with, one tile to place, two slots free: the drawer the report described.
    expect(seat.tableau.freeDrawerSlots()).toHaveLength(2)

    const to = { kind: 'onPlate' as const, plateId: plate.id, petal: free[4] as number }
    return { state, seat, held: held!, to, stem: seat.tableau.stems()[0]!.id }
  }

  it('lets a placement through when its payment makes the room', () => {
    const { state, seat, held, to, stem } = aboutToBePaidFour(4, 2)

    const result = applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [stem],
    })

    expect(result).toMatchObject({ ok: true })
    // Four stems due and four minted: none was dropped for want of a slot.
    expect(result.ok && result.awarded).toHaveLength(4)
    expect(seat.tableau.freeDrawerSlots()).toHaveLength(0)
  })

  /**
   * The other half, and why the drop's answer cannot be the last word.
   *
   * At the drop nobody knows what will pay, so the rules answer with the best a payment could do. A
   * plate spent out of its bay frees a *bay*, and the stems still need drawer slots — so the same
   * placement, paid for differently, no longer fits. Refused rather than half-paid: the award mints
   * what it can and drops the rest.
   */
  it('refuses the same placement when the payment frees nothing', () => {
    const { state, seat, held, to } = aboutToBePaidFour(4, 2)
    const bay = seat.tableau.plates().find(p => p.location.kind === 'plateSlot')
      ?? seat.tableau.addPlate({ kind: 'plateSlot', slot: 0 })!
    seat.tableau.addTile({ color: held.color, value: held.value }, {
      kind: 'onPlate', plateId: bay.id, petal: 0,
    }, { fixed: true })
    const before = snapshot(state)

    const result = applyCommand(state, {
      kind: 'put', seat: 0, item: { kind: 'tile', id: held.id }, to, paying: [bay.id],
    })

    expect(result).toMatchObject({ ok: false })
    expect(snapshot(state)).toEqual(before)
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

/**
 * The one command that is not a turn.
 *
 * Everything else in the log is somebody's move and the round moves with it. Tidying your own drawer
 * is not a move — it touches one seat's slots and nothing else — so it sits above the turn guards and
 * changes nothing about whose turn it is. These are the ways that could quietly stop being true.
 */
describe('arranging your drawer', () => {
  const settings = defaultGameSettings(0)

  /** How a seat's drawer reads right now: ids by slot, null where a slot is empty. */
  function seating(seat: { tableau: Tableau }) {
    return {
      drawer: Array.from({ length: settings.tileSlots }, (_, slot) =>
        seat.tableau.drawerSlotOccupant(slot) ?? null),
      bays: Array.from({ length: settings.plateSlots }, (_, slot) =>
        seat.tableau.plateSlotOccupant(slot) ?? null),
    }
  }

  /** A seat with its opening stems, and the plan that turns its drawer back to front. */
  function tidying(seatNumber: number) {
    const state = createGame(options())
    const seat = state.seats[seatNumber]!
    const now = seating(seat)
    const reversed = [...now.drawer].reverse()
    return {
      state,
      seat,
      reversed,
      command: { kind: 'arrange' as const, seat: seatNumber, drawer: reversed, bays: now.bays },
    }
  }

  it('is taken from the seat whose turn it is', () => {
    const { state, seat, command, reversed } = tidying(0)
    expect(state.activeSeat).toBe(0)
    // The opening stems are at one end, so reversing them is a change and not a no-op dressed up.
    expect(seating(seat).drawer).not.toEqual(reversed)

    expect(applyCommand(state, command)).toMatchObject({ ok: true })
    expect(seating(seat).drawer).toEqual(reversed)
  })

  /* The whole point of the change: waiting for your turn does not stop you sorting your tiles. */
  it('is taken from a seat whose turn it is not', () => {
    const { state, command } = tidying(2)
    expect(state.activeSeat).not.toBe(2)

    expect(applyCommand(state, command)).toMatchObject({ ok: true })
  })

  it('is taken from a seat that has already passed the round', () => {
    const { state, command } = tidying(1)
    play(state, { kind: 'pass', seat: 0 })
    play(state, { kind: 'pass', seat: 1 })
    expect(state.seats[1]!.passed).toBe(true)

    expect(applyCommand(state, command)).toMatchObject({ ok: true })
  })

  it('moves neither the turn nor the round', () => {
    const { state, command } = tidying(0)
    const before = snapshot(state)

    play(state, command)
    play(state, command)

    const after = snapshot(state)
    expect(after.turn).toBe(before.turn)
    expect(after.round).toBe(before.round)
    expect(after.activeSeat).toBe(before.activeSeat)
    expect(after.firstToPass).toBe(before.firstToPass)
  })

  /* Applying the same plan twice is applying it once — what lets a client fold back its own command. */
  it('leaves the same drawer when it arrives twice', () => {
    const { state, command } = tidying(0)

    play(state, command)
    const once = snapshot(state)
    play(state, command)

    expect(snapshot(state)).toEqual(once)
  })

  it('is refused when it is not an arrangement of that seat´s drawer', () => {
    const { state, command } = tidying(0)
    const before = snapshot(state)

    const result = applyCommand(state, { ...command, drawer: [...command.drawer, 'nope'] })

    expect(result).toMatchObject({ ok: false })
    expect(snapshot(state)).toEqual(before)
  })

  it('is refused once the game is over, like everything else', () => {
    const { state, command } = tidying(0)
    state.finished = true

    expect(applyCommand(state, command)).toMatchObject({ ok: false })
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
