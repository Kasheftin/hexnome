import { describe, expect, it } from 'vitest'
import { createRandom, shuffleInPlace } from './random'
import { createRecyclingBag, inDiscardOrder, tileCode } from './recycling'
import type { PlateSpec, TileSpec } from './tableau'

const spec = (color: number, value: number): TileSpec => ({ color, value })

/** Every distinct tile, in a fixed order, for piles big enough to be worth shuffling. */
function everyTile(): TileSpec[] {
  const all: TileSpec[] = []
  for (let color = 0; color < 6; color++) for (let value = 1; value <= 6; value++) all.push(spec(color, value))
  return all
}

describe('tileCode', () => {
  it('is two digits from 11 to 66', () => {
    expect(tileCode(spec(0, 1))).toBe(11)
    expect(tileCode(spec(5, 6))).toBe(66)
  })

  /*
   * The +1 is load-bearing, not cosmetic. Colour is 0-based in code, and a code of `01` would lose its
   * leading zero once concatenated into the seed — `01` and `1` would be the same digit string, so two
   * different piles could seed the same reshuffle.
   */
  it('lifts colour 0 off zero so the digit string stays unambiguous', () => {
    expect(tileCode(spec(0, 6))).toBe(16)
    expect(String(tileCode(spec(0, 1)))).toHaveLength(2)
  })
})

describe('inDiscardOrder', () => {
  it('sorts ascending by code', () => {
    const sorted = inDiscardOrder([spec(2, 5), spec(0, 1), spec(5, 6), spec(0, 3)])
    expect(sorted.map(tileCode)).toEqual([11, 13, 35, 66])
  })

  it('gives the same answer whatever order the batch arrived in', () => {
    const batch = [spec(3, 2), spec(1, 4), spec(0, 6), spec(5, 1)]
    expect(inDiscardOrder([...batch].reverse())).toEqual(inDiscardOrder(batch))
  })

  it('leaves the caller\'s array alone', () => {
    const batch = [spec(5, 6), spec(0, 1)]
    inDiscardOrder(batch)
    expect(batch[0]).toEqual(spec(5, 6))
  })

  it('breaks ties on petal, so plates in a batch cannot swap places', () => {
    const plate = (color: number, value: number, petal: number): PlateSpec => ({ color, value, petal })
    const sorted = inDiscardOrder([plate(0, 1, 4), plate(0, 1, 2)])
    expect(sorted.map(p => p.petal)).toEqual([2, 4])
  })
})

describe('a recycling bag', () => {
  it('draws from the deck like an ordinary bag while it has one', () => {
    const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
    expect(bag.draw(3)).toEqual([spec(0, 1), spec(0, 2), spec(0, 3)])
    expect(bag.reshuffles()).toBe(0)
  })

  it('refuses a nonsense count the way `Bag.take` does', () => {
    const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
    expect(bag.draw(0)).toEqual([])
    expect(bag.draw(-2)).toEqual([])
    expect(bag.draw(1.5)).toEqual([])
    expect(bag.remaining()).toBe(36)
  })

  it('counts the pile as still drawable', () => {
    const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
    bag.draw(30)
    bag.discard([spec(0, 1), spec(0, 2)])
    expect(bag.remaining()).toBe(8)
  })

  describe('running short', () => {
    /** Two left in the bag, six in the pile. */
    function nearlyDry() {
      const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
      bag.draw(34)
      bag.discard([spec(0, 1), spec(1, 2), spec(2, 3), spec(3, 4), spec(4, 5), spec(5, 6)])
      return bag
    }

    it('finishes the draw out of the pile', () => {
      const bag = nearlyDry()
      expect(bag.draw(4)).toHaveLength(4)
      expect(bag.reshuffles()).toBe(1)
    })

    it('hands over the bag\'s stragglers first', () => {
      const bag = nearlyDry()
      // The last two of the original deck, before anything recycled arrives.
      expect(bag.draw(4).slice(0, 2)).toEqual([spec(5, 5), spec(5, 6)])
    })

    it('leaves nothing of the pile behind once it is shuffled in', () => {
      const bag = nearlyDry()
      bag.draw(3)
      expect(bag.pile()).toEqual([])
      expect(bag.remaining()).toBe(5)
    })

    it('never shuffles back what was already drawn', () => {
      const bag = nearlyDry()
      // Six discarded plus two stragglers is eight; a ninth would mean a drawn tile came back.
      expect(bag.draw(9)).toHaveLength(8)
    })
  })

  describe('running out', () => {
    it('returns short rather than throwing, with an empty pile', () => {
      const bag = createRecyclingBag([spec(0, 1), spec(0, 2)], { seed: 'g:reshuffle:tiles' })
      expect(bag.draw(5)).toHaveLength(2)
      expect(bag.draw(1)).toEqual([])
    })

    /*
     * A no-op reshuffle would still burn a generation, and the generation is in the seed — so the next
     * *real* reshuffle would come out differently depending on how many times the bag had been asked
     * for something it could not give.
     */
    it('does not burn a generation on an empty pile', () => {
      const bag = createRecyclingBag([spec(0, 1)], { seed: 'g:reshuffle:tiles' })
      bag.draw(4)
      bag.draw(4)
      expect(bag.reshuffles()).toBe(0)
    })

    it('terminates when bag and pile together cannot cover the draw', () => {
      const bag = createRecyclingBag([spec(0, 1)], { seed: 'g:reshuffle:tiles' })
      bag.draw(1)
      bag.discard([spec(1, 1), spec(2, 2)])
      expect(bag.draw(100)).toHaveLength(2)
    })
  })

  describe('determinism', () => {
    /** Draw the deck dry, discard `pile`, then draw it all back. */
    function recycled(seed: string, pile: readonly TileSpec[]): TileSpec[] {
      const bag = createRecyclingBag(everyTile(), { seed })
      bag.draw(36)
      bag.discard(pile)
      return bag.draw(pile.length)
    }

    const PILE = everyTile().slice(0, 8)

    it('gives the same order for the same pile in the same game', () => {
      expect(recycled('g:reshuffle:tiles', PILE)).toEqual(recycled('g:reshuffle:tiles', PILE))
    })

    it('gives a different order for a different pile', () => {
      const other = everyTile().slice(1, 9)
      expect(recycled('g:reshuffle:tiles', PILE)).not.toEqual(recycled('g:reshuffle:tiles', other))
    })

    it('gives a different order in a different game', () => {
      expect(recycled('g:reshuffle:tiles', PILE)).not.toEqual(recycled('h:reshuffle:tiles', PILE))
    })

    /*
     * The `kind` term earns its place here. Without it, a plate pile and a tile pile that happened to
     * hold the same colour/value multiset would reshuffle identically — and the plate bag and tile bag
     * of one game run dry independently, so that is not a hypothetical.
     */
    it('gives a different order to the two bags for the same digits', () => {
      expect(recycled('g:reshuffle:tiles', PILE)).not.toEqual(recycled('g:reshuffle:plates', PILE))
    })

    it('is not fooled by the order the batch arrived in', () => {
      expect(recycled('g:reshuffle:tiles', [...PILE].reverse())).toEqual(recycled('g:reshuffle:tiles', PILE))
    })

    /*
     * Two batches are not one batch. Each is sorted as it lands, so the pile is sorted *runs*, and a
     * payment followed by a sweep must not seed the same as a sweep followed by a payment.
     */
    it('keeps batch boundaries, so two batches are not one', () => {
      function twoBatches(first: readonly TileSpec[], second: readonly TileSpec[]): TileSpec[] {
        const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
        bag.draw(36)
        bag.discard(first)
        bag.discard(second)
        return bag.draw(4)
      }
      const a = [spec(5, 6), spec(0, 1)]
      const b = [spec(3, 3), spec(1, 2)]
      expect(twoBatches(a, b)).not.toEqual(twoBatches(b, a))
    })

    /*
     * The golden pin. This is the frozen contract in one assertion: the seed format, the encoding, the
     * generation and the shuffle, all the way through. If this changes, every reshuffle in every game
     * that ever ran changes with it.
     */
    it('matches the seed the contract specifies, exactly', () => {
      const pile = inDiscardOrder(PILE)
      const digits = pile.map(tileCode).join('')
      const expected = shuffleInPlace([...pile], createRandom(`g:reshuffle:tiles:0:${digits}`))
      // Colour 0's six values, then colour 1's first two: 11–16, 21, 22.
      expect(digits).toBe('1112131415162122')
      expect(recycled('g:reshuffle:tiles', PILE)).toEqual(expected)
    })

    it('advances the generation, so the same pile twice is not the same shuffle', () => {
      const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
      bag.draw(36)
      bag.discard(PILE)
      const first = bag.draw(8)
      bag.discard(PILE)
      const second = bag.draw(8)
      expect(bag.reshuffles()).toBe(2)
      expect(second).not.toEqual(first)
    })
  })

  it('loses nothing and duplicates nothing across a reshuffle', () => {
    const bag = createRecyclingBag(everyTile(), { seed: 'g:reshuffle:tiles' })
    const held = bag.draw(36)
    bag.discard(held)
    const again = bag.draw(36)
    expect(inDiscardOrder(again)).toEqual(inDiscardOrder(everyTile()))
  })
})
