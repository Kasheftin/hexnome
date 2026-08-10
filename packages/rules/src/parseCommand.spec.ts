import { describe, expect, it } from 'vitest'
import { parseCommand } from './parseCommand'

/**
 * The gate in front of `applyCommand`.
 *
 * Its job is narrow and worth stating: establish that a value has the *shape* of a command, so that
 * nothing downstream has to wonder. Whether the ids name anything, whether the seat may act, whether
 * the placement is legal — all of that is `applyCommand`'s, and asking it twice is how two answers
 * come to disagree.
 *
 * So most of these are refusals. The parser is only interesting when it says no.
 */

const PASS = { kind: 'pass', seat: 1 }
const DRAFT = { kind: 'draft', seat: 0, ids: ['src:t1', 'src:t2'] }
const ARRANGE = { kind: 'arrange', seat: 0, drawer: ['0:t1', null, '0:s2'], bays: [null, '0:p3'] }
const PUT = {
  kind: 'put',
  seat: 2,
  item: { kind: 'tile', id: '2:t7' },
  to: { kind: 'onPlate', plateId: '2:p1', petal: 3 },
  paying: ['2:t9', '2:s1'],
}

describe('what it reads', () => {
  it('takes a pass', () => {
    expect(parseCommand(PASS)).toEqual({ kind: 'pass', seat: 1 })
  })

  it('takes a draft', () => {
    expect(parseCommand(DRAFT)).toEqual({ kind: 'draft', seat: 0, ids: ['src:t1', 'src:t2'] })
  })

  /* Holes and all: a plan says what is in every slot, and most drawers have empty ones. */
  it('takes an arrangement, keeping its empty slots', () => {
    expect(parseCommand(ARRANGE)).toEqual({
      kind: 'arrange',
      seat: 0,
      drawer: ['0:t1', null, '0:s2'],
      bays: [null, '0:p3'],
    })
  })

  it('takes an arrangement of an empty drawer', () => {
    expect(parseCommand({ kind: 'arrange', seat: 0, drawer: [], bays: [] }))
      .toEqual({ kind: 'arrange', seat: 0, drawer: [], bays: [] })
  })

  it('takes a put, and leaves a tile without a rotation', () => {
    expect(parseCommand(PUT)).toEqual({
      kind: 'put',
      seat: 2,
      item: { kind: 'tile', id: '2:t7' },
      to: { kind: 'onPlate', plateId: '2:p1', petal: 3 },
      paying: ['2:t9', '2:s1'],
      rotation: undefined,
    })
  })

  it('takes a plate onto the board, turned', () => {
    const command = parseCommand({
      ...PUT,
      item: { kind: 'plate', id: '2:p4' },
      to: { kind: 'board', hole: { q: -3, r: 2 } },
      rotation: 4,
    })

    expect(command).toMatchObject({
      item: { kind: 'plate', id: '2:p4' },
      to: { kind: 'board', hole: { q: -3, r: 2 } },
      rotation: 4,
    })
  })

  /* Free placements are ordinary — a value-1 tile costs nothing. */
  it('takes a put that pays with nothing', () => {
    expect(parseCommand({ ...PUT, paying: [] })).toMatchObject({ paying: [] })
  })
})

describe('what it refuses', () => {
  it('anything that is not an object with a known kind', () => {
    for (const bad of [null, undefined, 42, 'pass', [], [PASS], {}, { kind: 'shove', seat: 0 }]) {
      expect(parseCommand(bad)).toBeNull()
    }
  })

  /**
   * A deal is not a client's to make.
   *
   * It carries what the desk dealt, and the desk is the server's — one a client could submit would be
   * a client choosing its own tiles. The server builds its own and never parses one, so there is
   * nothing here that could accidentally accept it.
   */
  it('a deal, whoever sends it', () => {
    expect(parseCommand({ kind: 'deal', seat: 0, plate: { color: 1, value: 1 }, tiles: [] })).toBeNull()
  })

  it('a seat that is not a whole index', () => {
    for (const seat of [undefined, null, -1, 1.5, '0', {}]) {
      expect(parseCommand({ ...PASS, seat })).toBeNull()
    }
  })

  it('ids that are not strings, are empty, or run on', () => {
    for (const bad of [[''], [7], [null], ['x'.repeat(65)], 'src:t1', { 0: 'src:t1' }]) {
      expect(parseCommand({ ...DRAFT, ids: bad })).toBeNull()
    }
  })

  /*
   * `null` is a slot with nothing in it and is the one non-string a plan may hold. Everything else
   * that is not an id is refused, in both indexes.
   */
  it('a seating plan holding anything but ids and empty slots', () => {
    for (const bad of [[''], [7], [undefined], [{}], [['0:t1']], '0:t1', { 0: '0:t1' }, null]) {
      expect(parseCommand({ ...ARRANGE, drawer: bad })).toBeNull()
      expect(parseCommand({ ...ARRANGE, bays: bad })).toBeNull()
    }
  })

  /* Length is the tableau's to check exactly; this only refuses an array nobody could have a drawer for. */
  it('a seating plan longer than a drawer could be', () => {
    const many = Array.from({ length: 65 }, (_, at) => `0:t${at}`)
    expect(parseCommand({ ...ARRANGE, drawer: many })).toBeNull()
    expect(parseCommand({ ...ARRANGE, bays: many })).toBeNull()
  })

  it('an arrangement missing one of its two indexes', () => {
    expect(parseCommand({ kind: 'arrange', seat: 0, drawer: ['0:t1'] })).toBeNull()
    expect(parseCommand({ kind: 'arrange', seat: 0, bays: ['0:p1'] })).toBeNull()
  })

  it('a draft or a payment longer than a game could produce', () => {
    const many = Array.from({ length: 200 }, (_, at) => `src:t${at}`)
    expect(parseCommand({ ...DRAFT, ids: many })).toBeNull()
    expect(parseCommand({ ...PUT, paying: many })).toBeNull()
  })

  /**
   * The one refusal that is really about `moveTile`.
   *
   * A tile addressed to a plate's hole, or a plate addressed to a petal, would reach the model as a
   * location of the wrong shape — which is exactly what the cast in `applyCommand` cannot notice.
   */
  it('a location of the wrong shape for the item', () => {
    expect(parseCommand({ ...PUT, to: { kind: 'board', hole: { q: 0, r: 0 } } })).toBeNull()
    expect(parseCommand({
      ...PUT,
      item: { kind: 'plate', id: '2:p1' },
      to: { kind: 'onPlate', plateId: '2:p1', petal: 0 },
    })).toBeNull()
  })

  it('a location missing a field, or holding the wrong type in one', () => {
    for (const to of [
      { kind: 'drawer' },
      { kind: 'drawer', slot: -1 },
      { kind: 'onPlate', plateId: '2:p1' },
      { kind: 'onPlate', plateId: 2, petal: 0 },
      { kind: 'source', lot: 0 },
      { kind: 'nowhere', slot: 0 },
      'drawer',
      null,
    ]) {
      expect(parseCommand({ ...PUT, to })).toBeNull()
    }
  })

  it('a board hole that is not a pair of whole numbers', () => {
    for (const hole of [{ q: 0 }, { q: 0, r: '1' }, { q: 0.5, r: 0 }, [0, 0], null]) {
      expect(parseCommand({
        ...PUT,
        item: { kind: 'plate', id: '2:p4' },
        to: { kind: 'board', hole },
      })).toBeNull()
    }
  })

  it('an item that is not a tile or a plate', () => {
    for (const item of [{ kind: 'stem', id: '2:s1' }, { id: '2:t7' }, { kind: 'tile' }, null]) {
      expect(parseCommand({ ...PUT, item })).toBeNull()
    }
  })

  it('a rotation that is present and not a whole number', () => {
    for (const rotation of [1.5, '2', null]) {
      expect(parseCommand({ ...PUT, rotation })).toBeNull()
    }
  })
})

/**
 * A parsed command holds nothing but what was named.
 *
 * A stray field surviving the parse would be one the model never reads and a reviewer would assume
 * it did — and, in a command stored as JSON, one that comes back on the next replay.
 */
describe('what it keeps', () => {
  it('drops anything it was not asked for', () => {
    const parsed = parseCommand({ ...PUT, seat: 2, cheat: true, to: { ...PUT.to, extra: 1 } })

    expect(parsed).not.toHaveProperty('cheat')
    expect(parsed?.kind === 'put' && parsed.to).not.toHaveProperty('extra')
  })
})
