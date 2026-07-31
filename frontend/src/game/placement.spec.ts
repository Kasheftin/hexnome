import { describe, expect, it } from 'vitest'
import { groupsAllow, isPlacementRule, neighboursAllow } from './placement'

const BLUE = 1
const RED = 4
const GREEN = 2

const spec = (color: number, value: number) => ({ color, value })
const BLUE_3 = spec(BLUE, 3)

describe('a tile with nothing around it', () => {
  it('may go anywhere, under either rule', () => {
    expect(neighboursAllow(BLUE_3, [], 'regular')).toBe(true)
    expect(neighboursAllow(BLUE_3, [], 'strict')).toBe(true)
  })
})

describe('regular: one neighbour has to agree', () => {
  it('accepts a colour match among strangers', () => {
    const around = [spec(RED, 5), spec(BLUE, 6), spec(GREEN, 2)]
    expect(neighboursAllow(BLUE_3, around, 'regular')).toBe(true)
  })

  it('accepts a value match among strangers', () => {
    const around = [spec(RED, 3), spec(GREEN, 6)]
    expect(neighboursAllow(BLUE_3, around, 'regular')).toBe(true)
  })

  it('refuses when nothing around it agrees', () => {
    const around = [spec(RED, 5), spec(GREEN, 6)]
    expect(neighboursAllow(BLUE_3, around, 'regular')).toBe(false)
  })

  it('counts an identical tile as agreeing — it shares both', () => {
    expect(neighboursAllow(BLUE_3, [spec(BLUE, 3)], 'regular')).toBe(true)
  })
})

describe('strict: every neighbour has to agree', () => {
  it('accepts when all of them share the colour', () => {
    const around = [spec(BLUE, 1), spec(BLUE, 6)]
    expect(neighboursAllow(BLUE_3, around, 'strict')).toBe(true)
  })

  it('accepts when all of them share the value', () => {
    const around = [spec(RED, 3), spec(GREEN, 3)]
    expect(neighboursAllow(BLUE_3, around, 'strict')).toBe(true)
  })

  it('accepts a mix, each agreeing on its own attribute', () => {
    // The open reading, pinned: colour for one, value for the other. Change this test and
    // `neighboursAllow` together if the rule should demand a single shared attribute.
    const around = [spec(BLUE, 6), spec(RED, 3)]
    expect(neighboursAllow(BLUE_3, around, 'strict')).toBe(true)
  })

  it('refuses if a single neighbour disagrees', () => {
    const around = [spec(BLUE, 1), spec(BLUE, 6), spec(RED, 5)]
    expect(neighboursAllow(BLUE_3, around, 'strict')).toBe(false)
  })
})

describe('strict is the tighter of the two', () => {
  it('allows nothing regular would refuse', () => {
    const cases = [
      [spec(RED, 5)],
      [spec(BLUE, 1), spec(RED, 5)],
      [spec(RED, 3), spec(GREEN, 3)],
      [spec(GREEN, 6), spec(GREEN, 2)],
    ]
    for (const around of cases) {
      if (neighboursAllow(BLUE_3, around, 'strict')) {
        expect(neighboursAllow(BLUE_3, around, 'regular')).toBe(true)
      }
    }
  })
})

describe('parsing the setting', () => {
  it('accepts the two rules and nothing else', () => {
    expect(isPlacementRule('regular')).toBe(true)
    expect(isPlacementRule('strict')).toBe(true)
    expect(isPlacementRule('lenient')).toBe(false)
    expect(isPlacementRule(undefined)).toBe(false)
    expect(isPlacementRule(2)).toBe(false)
  })
})

/* ── the no-duplicates rule ───────────────────────────────────────────────────── */

/** A tiny board keyed by "q,r", so a test can draw a shape and ask about it. */
function board(cells: Record<string, [number, number]>) {
  const map = new Map(
    Object.entries(cells).map(([key, [color, value]]) => [key, { color, value }]),
  )
  return (cell: { q: number, r: number }) => map.get(`${cell.q},${cell.r}`)
}

const AT = (q: number, r: number) => ({ q, r })

describe('a tile alone', () => {
  it('is its own group in both attributes, and that is fine', () => {
    expect(groupsAllow(AT(0, 0), spec(BLUE, 1), board({}))).toBe(true)
  })
})

describe('the bridging case from the rules', () => {
  // Blue-1 at (-1,0) · gap at (0,0) · Blue-1 at (1,0).
  const twoBlueOnes = board({ '-1,0': [BLUE, 1], '1,0': [BLUE, 1] })

  it('allows the two Blue-1s to coexist while nothing connects them', () => {
    // Placing far away leaves them in separate groups, so neither is troubled.
    expect(groupsAllow(AT(5, 0), spec(BLUE, 2), twoBlueOnes)).toBe(true)
  })

  it('refuses the Blue-2 that would bridge them', () => {
    expect(groupsAllow(AT(0, 0), spec(BLUE, 2), twoBlueOnes)).toBe(false)
  })

  it('allows a bridge of a different colour, which joins nothing', () => {
    // A red tile is in neither Blue-1's colour group, and its value group is 2s only.
    expect(groupsAllow(AT(0, 0), spec(RED, 2), twoBlueOnes)).toBe(true)
  })

  it('refuses a value bridge just as readily as a colour one', () => {
    // Two Red-4s apart; a Green-4 between them joins one value group holding both.
    const twoRedFours = board({ '-1,0': [RED, 4], '1,0': [RED, 4] })
    expect(groupsAllow(AT(0, 0), spec(GREEN, 4), twoRedFours)).toBe(false)
  })
})

describe('the obvious consequence', () => {
  it('never lets a tile sit beside its own copy', () => {
    const twin = board({ '1,0': [BLUE, 3] })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 3), twin)).toBe(false)
  })

  it('allows the copy one cell further out, unconnected', () => {
    const twin = board({ '2,0': [BLUE, 3] })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 3), twin)).toBe(true)
  })
})

describe('groups follow connections, not proximity', () => {
  it('walks a chain of the same colour to find a distant duplicate', () => {
    // Blue-1, Blue-2, Blue-4 in a row; placing Blue-4 at the near end joins all of them.
    const chain = board({ '1,0': [BLUE, 1], '2,0': [BLUE, 2], '3,0': [BLUE, 4] })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 4), chain)).toBe(false)
  })

  it('stops at a tile of another colour, which breaks the run', () => {
    // The Red-9 in the middle is not in the blue group, so the far Blue-4 is never reached.
    const broken = board({ '1,0': [BLUE, 1], '2,0': [RED, 6], '3,0': [BLUE, 4] })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 4), broken)).toBe(true)
  })

  it('sees a duplicate reached the long way round', () => {
    // A ring of blues curling back on itself: the duplicate is four steps away, not adjacent.
    const ring = board({
      '1,0': [BLUE, 1], '1,-1': [BLUE, 2], '0,-1': [BLUE, 5], '-1,0': [BLUE, 6],
    })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 1), ring)).toBe(false)
  })
})

describe('both groups are checked, not just one', () => {
  it('refuses when only the value group offends', () => {
    // Colour group is just the placed tile; value group picks up two 3s.
    const twoThrees = board({ '1,0': [RED, 3], '2,0': [RED, 3] })
    expect(groupsAllow(AT(0, 0), spec(GREEN, 3), twoThrees)).toBe(false)
  })

  it('refuses when only the colour group offends', () => {
    const twoBlues = board({ '1,0': [BLUE, 2], '2,0': [BLUE, 2] })
    expect(groupsAllow(AT(0, 0), spec(BLUE, 5), twoBlues)).toBe(false)
  })
})
