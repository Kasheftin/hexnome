import { describe, expect, it } from 'vitest'
import {
  canConfirmDraft,
  draftAttribute,
  draftStates,
  toggleDraftSelection,
  type DraftTile,
} from './draft'

/** `c4` reads as "colour 1, value 4". Ids are positional so duplicates stay distinguishable. */
function source(...specs: [number, number][]): DraftTile[] {
  return specs.map(([color, value], i) => ({ id: `t${i}`, color, value }))
}

const RED = 4
const BLUE = 1
const GREEN = 0

describe('the worked example from the rules', () => {
  // red-4, red-2, red-2, blue-1 — the case that pins down what "not the identical tiles" means.
  const tiles = source([RED, 4], [RED, 2], [RED, 2], [BLUE, 1])
  const [red4, red2a, red2b, blue1] = tiles as [DraftTile, DraftTile, DraftTile, DraftTile]

  it('offers everything before anything is picked', () => {
    const states = draftStates(tiles, [])
    expect([...states.values()]).toEqual(['active', 'active', 'active', 'active'])
  })

  it('after red-4: both red-2s stay live, blue-1 drops out', () => {
    const states = draftStates(tiles, [red4.id])
    expect(states.get(red4.id)).toBe('selected')
    expect(states.get(red2a.id)).toBe('active')
    expect(states.get(red2b.id)).toBe('active')
    // Shares neither the colour nor the symbol.
    expect(states.get(blue1.id)).toBe('inactive')
  })

  it('after red-4 + red-2: the duplicate red-2 goes inactive', () => {
    const states = draftStates(tiles, [red4.id, red2a.id])
    expect(states.get(red2a.id)).toBe('selected')
    // Already represented — one per distinct tile.
    expect(states.get(red2b.id)).toBe('inactive')
    expect(states.get(blue1.id)).toBe('inactive')
  })

  it('is a complete colour draft at that point, leaving the duplicate behind', () => {
    expect(canConfirmDraft(tiles, [red4.id, red2a.id])).toBe(true)
    expect(draftAttribute(tiles, [red4.id, red2a.id])).toBe('color')
  })

  it('lets a single tile be complete when it is the only one of its symbol', () => {
    // Both of these are incomplete colour drafts — red-2 and red-4 are both red — but each is the
    // whole of its symbol, so each stands alone as a legal symbol draft.
    expect(canConfirmDraft(tiles, [red4.id])).toBe(true)
    expect(draftAttribute(tiles, [red4.id])).toBeNull()
    expect(canConfirmDraft(tiles, [red2a.id])).toBe(true)
  })
})

describe('pinning the criterion', () => {
  const tiles = source([RED, 4], [BLUE, 4], [RED, 2], [GREEN, 6])
  const [red4, blue4, red2, green6] = tiles as [DraftTile, DraftTile, DraftTile, DraftTile]

  it('keeps both attributes live on the first pick', () => {
    const states = draftStates(tiles, [red4.id])
    expect(states.get(blue4.id)).toBe('active')  // same symbol
    expect(states.get(red2.id)).toBe('active')   // same colour
    expect(states.get(green6.id)).toBe('inactive')
    expect(draftAttribute(tiles, [red4.id])).toBeNull()
  })

  it('pins to symbol once a second tile shares only the symbol', () => {
    const states = draftStates(tiles, [red4.id, blue4.id])
    expect(states.get(red2.id)).toBe('inactive')
    expect(draftAttribute(tiles, [red4.id, blue4.id])).toBe('value')
    expect(canConfirmDraft(tiles, [red4.id, blue4.id])).toBe(true)
  })

  it('pins to colour once a second tile shares only the colour', () => {
    const states = draftStates(tiles, [red4.id, red2.id])
    expect(states.get(blue4.id)).toBe('inactive')
    expect(draftAttribute(tiles, [red4.id, red2.id])).toBe('color')
  })

  it('un-pins when the second tile is deselected', () => {
    // The reason states are recomputed rather than patched: this has to widen again.
    const after = toggleDraftSelection(tiles, [red4.id, red2.id], red2.id)
    expect(after).toEqual([red4.id])
    expect(draftStates(tiles, after).get(blue4.id)).toBe('active')
  })
})

describe('completeness', () => {
  it('rejects a partial sweep', () => {
    // Every tile here is incomplete under *both* attributes on its own, which is what makes this a
    // real partial-sweep test: red-1 leaves red-2 unswept as a colour and blue-1 unswept as a symbol.
    const tiles = source([RED, 1], [RED, 2], [BLUE, 1])
    const [red1, red2, blue1] = tiles as [DraftTile, DraftTile, DraftTile]
    expect(canConfirmDraft(tiles, [red1.id])).toBe(false)
    expect(canConfirmDraft(tiles, [red1.id, red2.id])).toBe(true)   // all the reds
    expect(canConfirmDraft(tiles, [red1.id, blue1.id])).toBe(true)  // all the 1s
    // Not a sweep of anything: three tiles sharing no single attribute.
    expect(canConfirmDraft(tiles, [red1.id, red2.id, blue1.id])).toBe(false)
  })

  it('accepts a single tile that is the whole attribute', () => {
    const tiles = source([RED, 4], [BLUE, 2])
    const [red4] = tiles as [DraftTile, DraftTile]
    expect(canConfirmDraft(tiles, [red4.id])).toBe(true)
  })

  it('rejects an empty selection', () => {
    expect(canConfirmDraft(source([RED, 4]), [])).toBe(false)
  })

  it('rejects two copies of one tile even if a caller forces them in', () => {
    // toggleDraftSelection cannot produce this, but canConfirmDraft is the rule of record.
    const tiles = source([RED, 4], [RED, 4])
    expect(canConfirmDraft(tiles, tiles.map(t => t.id))).toBe(false)
  })

  it('treats a lone pair of duplicates as one takeable kind', () => {
    const tiles = source([RED, 4], [RED, 4])
    const [first] = tiles as [DraftTile, DraftTile]
    expect(canConfirmDraft(tiles, [first.id])).toBe(true)
  })
})

describe('toggling', () => {
  const tiles = source([RED, 4], [BLUE, 4], [GREEN, 6])
  const [red4, blue4, green6] = tiles as [DraftTile, DraftTile, DraftTile]

  it('ignores a click on an inactive tile', () => {
    const after = toggleDraftSelection(tiles, [red4.id], green6.id)
    expect(after).toEqual([red4.id])
  })

  it('adds an active tile and removes a selected one', () => {
    const added = toggleDraftSelection(tiles, [red4.id], blue4.id)
    expect(added).toEqual([red4.id, blue4.id])
    expect(toggleDraftSelection(tiles, added, red4.id)).toEqual([blue4.id])
  })

  it('never lets a duplicate in, so a valid selection cannot be built by clicking', () => {
    const dupes = source([RED, 2], [RED, 2])
    const [a, b] = dupes as [DraftTile, DraftTile]
    expect(toggleDraftSelection(dupes, [a.id], b.id)).toEqual([a.id])
  })
})
