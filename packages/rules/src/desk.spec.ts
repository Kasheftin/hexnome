import { describe, expect, it } from 'vitest'
import { DISTINCT_TILES } from './deck'
import {
  createDesk,
  deskRemaining,
  discardToDesk,
  drawFromDesk,
  inDiscardOrder,
  isTileCode,
  tileCode,
  tileFromCode,
  undiscardFromDesk,
  undrawFromDesk,
  type DeskState,
} from './desk'
import { createRandom, shuffleInPlace } from './random'

const SEED_A = '3f2a1c8e-5b6d-4e7f-9a0b-1c2d3e4f5a6b:tiles'
const SEED_B = '00000000-0000-4000-8000-000000000000:tiles'

/** Build or blow up — the tests below are not about `createDesk` refusing. */
function desk(seed: string, copies = 1, exclude?: readonly number[]): DeskState {
  const built = createDesk(seed, { copies, exclude })
  if (!built.ok) throw new Error(built.error)
  return built.value
}

function drawn(state: DeskState, n: number): { state: DeskState, codes: readonly number[] } {
  const result = drawFromDesk(state, n)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function discarded(state: DeskState, codes: readonly number[]): DeskState {
  const result = discardToDesk(state, codes)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('tile codes', () => {
  it('are two digits from 11 to 66', () => {
    expect(tileCode({ color: 0, value: 1 })).toBe(11)
    expect(tileCode({ color: 5, value: 6 })).toBe(66)
  })

  /*
   * The +1 is load-bearing, not cosmetic. Colour is 0-based in code, and a code of `01` would lose its
   * leading zero once concatenated into the seed — `01` and `1` would be the same digit string, so two
   * different piles could seed the same reshuffle.
   */
  it('lift colour 0 off zero so the digit string stays unambiguous', () => {
    expect(tileCode({ color: 0, value: 6 })).toBe(16)
    expect(String(tileCode({ color: 0, value: 1 }))).toHaveLength(2)
  })

  it('decode back to the tile they came from', () => {
    for (let color = 0; color < 6; color++) {
      for (let value = 1; value <= 6; value++) {
        expect(tileFromCode(tileCode({ color, value }))).toEqual({ color, value })
      }
    }
  })

  it('reject anything that is not one', () => {
    for (const bad of [0, 10, 17, 67, 71, 6, 111, 11.5, -11, NaN]) {
      expect(tileFromCode(bad)).toBeNull()
      expect(isTileCode(bad)).toBe(false)
    }
    expect(isTileCode('11')).toBe(false)
  })
})

describe('inDiscardOrder', () => {
  it('sorts ascending', () => {
    expect(inDiscardOrder([35, 11, 66, 13])).toEqual([11, 13, 35, 66])
  })

  it('gives the same answer whatever order the batch arrived in', () => {
    const batch = [42, 24, 16, 61]
    expect(inDiscardOrder([...batch].reverse())).toEqual(inDiscardOrder(batch))
  })

  it('leaves the caller\'s array alone', () => {
    const batch = [66, 11]
    inDiscardOrder(batch)
    expect(batch[0]).toBe(66)
  })
})

/**
 * These are the tests that earn the module.
 *
 * Once a seed has been used, the desk it deals is a promise: the same game, replayed, deals the same
 * tiles. Nothing at runtime can notice that promise being broken — a changed hash or a flipped shuffle
 * direction just quietly deals something else. Pinning the exact output is what turns that into a
 * failing test rather than a player's confusion.
 *
 * So if one of these fails, the question is not "what are the new values" — it is whether existing
 * seeds were meant to change. If they were, the pins move and the reason goes in the commit. If not,
 * the code is wrong.
 */
describe('the desk a given seed deals', () => {
  it('is exactly this, for these two seeds', () => {
    expect(desk(SEED_A).desk.slice(0, 8)).toEqual([55, 26, 62, 16, 61, 63, 44, 65])

    // A second seed, chosen to be all-zeros where the first is arbitrary: a hash that collapsed on
    // low-entropy input would show up here and not in the first.
    expect(desk(SEED_B).desk.slice(0, 8)).toEqual([63, 24, 45, 33, 12, 36, 55, 43])
  })

  it('is the same every time it is built', () => {
    expect(desk(SEED_A)).toEqual(desk(SEED_A))
  })

  it('is unrelated for seeds differing by one character', () => {
    // Consecutive randomUUID() values are unrelated, but a hand-edited or sequentially generated
    // seed need not be. A weak hash would deal near-identical desks for near-identical seeds.
    const near = desk(`${SEED_A.slice(0, -1)}c`)
    const same = desk(SEED_A).desk.filter((code, i) => code === near.desk[i]).length
    // Two independent shuffles of 36 items agree in ~1 position on average.
    expect(same).toBeLessThan(8)
  })

  /* The two desks of one game are told apart by their seed alone — the desk has no notion of kind. */
  it('differs between the tile desk and the plate desk of one game', () => {
    expect(desk('game:tiles').desk).not.toEqual(desk('game:plates').desk)
  })
})

describe('what is in a desk', () => {
  it('holds one of each distinct tile per copy', () => {
    for (const copies of [1, 2, 3, 4]) {
      const state = desk(SEED_A, copies)
      expect(state.desk).toHaveLength(DISTINCT_TILES * copies)

      const counts = new Map<number, number>()
      for (const code of state.desk) counts.set(code, (counts.get(code) ?? 0) + 1)
      expect(counts.size).toBe(DISTINCT_TILES)
      for (const count of counts.values()) expect(count).toBe(copies)
    }
  })

  /*
   * Copies are spread through the bag, not appended as a second shuffled bag after the first. Two bags
   * end to end would deal all 36 kinds before repeating any of them, which is a different game: the
   * first round could never show a duplicate.
   */
  it('shuffles the copies together rather than stacking one bag on the next', () => {
    const first = desk(SEED_A, 2).desk.slice(0, DISTINCT_TILES)
    expect(new Set(first).size).toBeLessThan(DISTINCT_TILES)
  })

  it('leaves out exactly the excluded codes, one occurrence each', () => {
    const state = desk(SEED_A, 2, [11, 11, 66])
    expect(state.desk).toHaveLength(DISTINCT_TILES * 2 - 3)
    expect(state.desk.filter(code => code === 11)).toHaveLength(0)
    expect(state.desk.filter(code => code === 66)).toHaveLength(1)
  })

  it('refuses to hold back more of a code than it has', () => {
    expect(createDesk(SEED_A, { copies: 1, exclude: [11, 11] })).toMatchObject({ ok: false })
    expect(createDesk(SEED_A, { copies: 1, exclude: [99] })).toMatchObject({ ok: false })
  })

  it('refuses a seed or a copy count it cannot use', () => {
    expect(createDesk('', { copies: 1 })).toMatchObject({ ok: false })
    for (const copies of [0, -1, 2.5, 99, NaN]) {
      expect(createDesk(SEED_A, { copies })).toMatchObject({ ok: false })
    }
  })
})

describe('drawing', () => {
  it('takes from the front, in desk order', () => {
    const state = desk(SEED_A)
    const { codes, state: after } = drawn(state, 3)
    expect(codes).toEqual(state.desk.slice(0, 3))
    expect(after.desk).toEqual(state.desk.slice(3))
  })

  it('leaves the desk it was given alone', () => {
    const state = desk(SEED_A)
    drawn(state, 5)
    expect(state.desk).toHaveLength(DISTINCT_TILES)
  })

  it('counts the pile as still drawable', () => {
    const emptied = drawn(desk(SEED_A), DISTINCT_TILES).state
    expect(deskRemaining(emptied)).toBe(0)
    expect(deskRemaining(discarded(emptied, [11, 22, 33]))).toBe(3)
  })

  /*
   * Refused rather than short. The bag this replaces handed back what it had, because a caller holding
   * the whole deck could see for itself that the game was over. Over HTTP a short array is a silent
   * surprise, so a draw that cannot be filled moves nothing.
   */
  it('refuses a draw bigger than the desk and pile together', () => {
    const state = desk(SEED_A)
    expect(drawFromDesk(state, 1000)).toMatchObject({ ok: false })
    expect(drawFromDesk(state, DISTINCT_TILES + 1)).toMatchObject({ ok: false })
    expect(drawFromDesk(state, DISTINCT_TILES)).toMatchObject({ ok: true })
  })

  it('refuses a nonsense count', () => {
    for (const n of [0, -1, 2.5, NaN]) {
      expect(drawFromDesk(desk(SEED_A), n)).toMatchObject({ ok: false })
    }
  })
})

describe('running short mid-draw', () => {
  /** Draw the desk dry, discard a pile, then draw across the boundary. */
  function spanning(pile: readonly number[], take: number) {
    const emptied = drawn(desk(SEED_A), DISTINCT_TILES).state
    return drawn(discarded(emptied, pile), take)
  }

  it('finishes the draw out of the pile', () => {
    const { codes, state } = spanning([11, 12, 13, 14], 4)
    expect(inDiscardOrder(codes)).toEqual([11, 12, 13, 14])
    expect(state.generation).toBe(1)
    expect(state.discard).toEqual([])
  })

  it('hands over the desk\'s stragglers first, then the pile', () => {
    const state = drawn(desk(SEED_A), DISTINCT_TILES - 2).state
    const last = state.desk.slice()
    const { codes } = drawn(discarded(state, [11, 12, 13]), 4)
    expect(codes.slice(0, 2)).toEqual(last)
  })

  /* The deck-of-cards rule: the old remnant is taken first, never shuffled back in with the pile. */
  it('never shuffles back what was already drawn', () => {
    const { codes } = spanning([11, 12], 2)
    expect(new Set(codes)).toEqual(new Set([11, 12]))
  })

  it('does not burn a generation when there is nothing to reshuffle', () => {
    const emptied = drawn(desk(SEED_A), DISTINCT_TILES).state
    expect(emptied.generation).toBe(0)
    expect(drawFromDesk(emptied, 1)).toMatchObject({ ok: false })
  })

  it('loses nothing and duplicates nothing across a reshuffle', () => {
    const all = desk(SEED_A).desk.slice()
    const emptied = drawn(desk(SEED_A), DISTINCT_TILES).state
    const { codes } = drawn(discarded(emptied, all), DISTINCT_TILES)
    expect(inDiscardOrder(codes)).toEqual(inDiscardOrder(all))
  })
})

describe('the reshuffle is decided by the seed and the pile', () => {
  function recycled(seed: string, pile: readonly number[]): readonly number[] {
    const emptied = drawn(desk(seed), DISTINCT_TILES).state
    return drawn(discarded(emptied, pile), pile.length).codes
  }

  const PILE = [11, 12, 13, 14, 15, 16, 21, 22]

  it('gives the same order for the same pile in the same game', () => {
    expect(recycled(SEED_A, PILE)).toEqual(recycled(SEED_A, PILE))
  })

  it('gives a different order for a different pile', () => {
    expect(recycled(SEED_A, PILE)).not.toEqual(recycled(SEED_A, [12, 13, 14, 15, 16, 21, 22, 23]))
  })

  it('gives a different order in a different game', () => {
    expect(recycled(SEED_A, PILE)).not.toEqual(recycled(SEED_B, PILE))
  })

  /*
   * The seed tag earns its place here. Without it, a plate pile and a tile pile that happened to hold
   * the same codes would reshuffle identically — and the two desks of one game run dry independently,
   * so that is not a hypothetical.
   */
  it('gives a different order to the two desks of one game', () => {
    expect(recycled('g:tiles', PILE)).not.toEqual(recycled('g:plates', PILE))
  })

  it('is not fooled by the order the batch arrived in', () => {
    expect(recycled(SEED_A, [...PILE].reverse())).toEqual(recycled(SEED_A, PILE))
  })

  /*
   * Two batches are not one batch. Each is sorted as it lands, so the pile is sorted *runs*, and a
   * payment followed by a sweep must not seed the same as a sweep followed by a payment.
   */
  it('keeps batch boundaries, so two batches are not one', () => {
    function twoBatches(first: readonly number[], second: readonly number[]): readonly number[] {
      let state = drawn(desk(SEED_A), DISTINCT_TILES).state
      state = discarded(state, first)
      state = discarded(state, second)
      return drawn(state, 4).codes
    }
    expect(twoBatches([66, 11], [33, 22])).not.toEqual(twoBatches([33, 22], [66, 11]))
  })

  /*
   * The golden pin. This is the frozen contract in one assertion: the seed format, the encoding, the
   * generation and the shuffle, all the way through. If this changes, every reshuffle in every game
   * that ever ran changes with it.
   */
  it('matches the seed the contract specifies, exactly', () => {
    const pile = inDiscardOrder(PILE)
    const digits = pile.join('')
    // Colour 0's six values, then colour 1's first two: 11–16, 21, 22.
    expect(digits).toBe('1112131415162122')
    expect(recycled(SEED_A, PILE))
      .toEqual(shuffleInPlace([...pile], createRandom(`${SEED_A}:0:${digits}`)))
  })

  it('advances the generation, so the same pile twice is not the same shuffle', () => {
    const emptied = drawn(desk(SEED_A), DISTINCT_TILES).state
    const first = drawn(discarded(emptied, PILE), PILE.length)
    const second = drawn(discarded(first.state, PILE), PILE.length)
    expect(second.state.generation).toBe(2)
    expect(second.codes).not.toEqual(first.codes)
  })
})

describe('discarding', () => {
  it('appends a batch in canonical order', () => {
    const { state, codes } = drawn(desk(SEED_A), 4)
    expect(discarded(state, [...codes].reverse()).discard).toEqual(inDiscardOrder(codes))
  })

  /* Sorted *runs*, not one sorted pile — which is what keeps two batches from seeding as one. */
  it('keeps earlier batches ahead of later ones', () => {
    const { state, codes } = drawn(desk(SEED_A), 6)
    const first = codes.slice(0, 3)
    const second = codes.slice(3)
    const after = discarded(discarded(state, first), second)
    expect(after.discard).toEqual([...inDiscardOrder(first), ...inDiscardOrder(second)])
  })

  it('takes an empty batch as a no-op', () => {
    const state = desk(SEED_A)
    expect(discarded(state, [])).toEqual(state)
  })

  /*
   * The check that makes the desk the authority rather than a store. Desk plus pile can never hold more
   * of a code than exists; anything past that was never drawn, and a desk that accepted it would deal
   * out a tile the game does not have.
   */
  it('refuses a code that was never drawn', () => {
    const state = drawn(desk(SEED_A), 4).state
    // Still sitting in the desk, so the game's one copy of it is accounted for already.
    const undrawn = state.desk[0] as number
    expect(discardToDesk(state, [undrawn])).toMatchObject({ ok: false })
  })

  it('accepts a code that is genuinely out, and refuses one more of it', () => {
    const { state, codes } = drawn(desk(SEED_A), 4)
    const one = codes[0] as number
    expect(discardToDesk(state, [one])).toMatchObject({ ok: true })
    expect(discardToDesk(state, [one, one])).toMatchObject({ ok: false })
  })

  /*
   * An opening plate is held rather than destroyed, so spending it is a legal discard even though it
   * was never in the bag — it can then be dealt out of a bag it was never in, which is intended.
   */
  it('accepts a code that was held back at creation', () => {
    expect(discardToDesk(desk(SEED_A, 1, [11]), [11])).toMatchObject({ ok: true })
  })

  it('refuses anything that is not a tile code', () => {
    const state = drawn(desk(SEED_A), 4).state
    expect(discardToDesk(state, [99])).toMatchObject({ ok: false })
    expect(discardToDesk(state, [0])).toMatchObject({ ok: false })
  })

  it('lets several copies come back when the desk was built with several', () => {
    const { state, codes } = drawn(desk(SEED_A, 3), 12)
    const one = codes[0] as number
    expect(discardToDesk(state, [one, one])).toMatchObject({ ok: true })
  })
})

/**
 * The invariant the whole module exists to keep: nothing is created and nothing is lost.
 *
 * Desk plus pile plus what the player is holding is constant, through draws, discards and reshuffles
 * alike.
 */
describe('conservation', () => {
  it('holds across a scripted run', () => {
    let state = desk(SEED_A, 3)
    const total = DISTINCT_TILES * 3
    let held: number[] = []

    // Long enough that the desk runs dry and the pile has to come back: 30 × 5 draws against 108.
    for (let round = 0; round < 30; round++) {
      const take = drawn(state, 5)
      state = take.state
      held.push(...take.codes)
      expect(deskRemaining(state) + held.length).toBe(total)

      // Spend three of them, as a payment would.
      const spent = held.slice(0, 3)
      held = held.slice(3)
      state = discarded(state, spent)
      expect(deskRemaining(state) + held.length).toBe(total)
    }

    expect(state.generation).toBeGreaterThan(0)
  })
})

describe('handing the desk back', () => {
  const options = { copies: 2 }

  function fresh(): DeskState {
    const built = createDesk('undo-seed', options)
    if (!built.ok) throw new Error(built.error)
    return built.value
  }

  it('puts a draw back exactly as it was', () => {
    const before = fresh()
    const drawn = drawFromDesk(before, 5)
    if (!drawn.ok) throw new Error(drawn.error)

    const back = undrawFromDesk(drawn.value.state, drawn.value.codes)
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(before)
  })

  it('puts several draws back when they are handed over as one run', () => {
    const before = fresh()
    const first = drawFromDesk(before, 1)
    if (!first.ok) throw new Error(first.error)
    const second = drawFromDesk(first.value.state, 4)
    if (!second.ok) throw new Error(second.error)

    // Draw order, which is also the order they came off the front.
    const codes = [...first.value.codes, ...second.value.codes]
    const back = undrawFromDesk(second.value.state, codes)
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(before)
  })

  it('refuses once the bag has reshuffled and the pile is empty again', () => {
    const state = fresh()
    // Empty the bag into hands, discard it all, then draw again to force the pile back in.
    const all = drawFromDesk(state, state.desk.length)
    if (!all.ok) throw new Error(all.error)
    const piled = discardToDesk(all.value.state, all.value.codes)
    if (!piled.ok) throw new Error(piled.error)
    const after = drawFromDesk(piled.value, 3)
    if (!after.ok) throw new Error(after.error)
    expect(after.value.state.generation).toBeGreaterThan(state.generation)

    const back = undrawFromDesk(after.value.state, after.value.codes)
    expect(back.ok).toBe(false)
  })

  it('allows it after a reshuffle when the pile proves nothing was lost since', () => {
    /*
     * The middle case, and the one the guard exists to get right. The bag has reshuffled at some
     * point, so `generation` is past zero — but there is material in the pile that got there *after*
     * that reshuffle, which is only possible if no reshuffle has happened since. The order this undo
     * would restore is therefore still intact.
     */
    const state = fresh()
    const all = drawFromDesk(state, state.desk.length)
    if (!all.ok) throw new Error(all.error)
    const piled = discardToDesk(all.value.state, all.value.codes)
    if (!piled.ok) throw new Error(piled.error)
    const reshuffled = drawFromDesk(piled.value, 3)
    if (!reshuffled.ok) throw new Error(reshuffled.error)
    expect(reshuffled.value.state.generation).toBeGreaterThan(0)

    // Something lands in the pile after the reshuffle, and now a draw can be taken back.
    const later = discardToDesk(reshuffled.value.state, reshuffled.value.codes)
    if (!later.ok) throw new Error(later.error)
    const drawn = drawFromDesk(later.value, 2)
    if (!drawn.ok) throw new Error(drawn.error)

    const back = undrawFromDesk(drawn.value.state, drawn.value.codes)
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(later.value)
  })

  it('will not accept codes the game does not contain', () => {
    const state = fresh()
    // Nothing has been drawn, so the bag already holds every copy there is.
    expect(undrawFromDesk(state, [11]).ok).toBe(false)
    expect(undrawFromDesk(state, [99]).ok).toBe(false)
  })

  it('takes a batch back off the pile', () => {
    const before = fresh()
    const drawn = drawFromDesk(before, 4)
    if (!drawn.ok) throw new Error(drawn.error)
    const piled = discardToDesk(drawn.value.state, drawn.value.codes)
    if (!piled.ok) throw new Error(piled.error)

    const back = undiscardFromDesk(piled.value, drawn.value.codes)
    if (!back.ok) throw new Error(back.error)
    expect(back.value).toEqual(drawn.value.state)
  })

  it('refuses when its batch is no longer on top', () => {
    const before = fresh()
    const drawn = drawFromDesk(before, 6)
    if (!drawn.ok) throw new Error(drawn.error)
    const mine = drawn.value.codes.slice(0, 3)
    const later = drawn.value.codes.slice(3)

    let state = drawn.value.state
    const first = discardToDesk(state, mine)
    if (!first.ok) throw new Error(first.error)
    const second = discardToDesk(first.value, later)
    if (!second.ok) throw new Error(second.error)
    state = second.value

    // Somebody else's batch is on top now, so this one cannot be lifted off.
    expect(undiscardFromDesk(state, mine).ok).toBe(false)
    // The one that is on top comes off fine.
    expect(undiscardFromDesk(state, later).ok).toBe(true)
  })

  it('does nothing for an empty hand back', () => {
    const state = fresh()
    expect(undrawFromDesk(state, [])).toEqual({ ok: true, value: state })
    expect(undiscardFromDesk(state, [])).toEqual({ ok: true, value: state })
  })

  /*
   * The order a turn is undone in, which is the reverse of the order it was played in: the server
   * draws its restock and *then* discards what the turn spent, so undo lifts the batch off the pile
   * before putting the draw back.
   */
  it('reverses a whole turn when applied back to front', () => {
    // Tiles the player was already holding, drawn in some earlier turn.
    const hand = drawFromDesk(fresh(), 2)
    if (!hand.ok) throw new Error(hand.error)
    const spent = hand.value.codes
    const atTurn = hand.value.state

    // The turn: the server restocks the source, then puts what the turn spent on the pile.
    const drawn = drawFromDesk(atTurn, 4)
    if (!drawn.ok) throw new Error(drawn.error)
    const played = discardToDesk(drawn.value.state, spent)
    if (!played.ok) throw new Error(played.error)

    const unpiled = undiscardFromDesk(played.value, spent)
    if (!unpiled.ok) throw new Error(unpiled.error)
    const undrawn = undrawFromDesk(unpiled.value, drawn.value.codes)
    if (!undrawn.ok) throw new Error(undrawn.error)
    expect(undrawn.value).toEqual(atTurn)
  })
})
