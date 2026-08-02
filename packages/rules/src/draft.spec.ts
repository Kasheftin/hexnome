import { describe, expect, it } from 'vitest'
import {
  canConfirmDraft,
  completedStrategies,
  draftAttribute,
  draftFits,
  draftSpace,
  draftStates,
  toggleDraftSelection,
  type DraftItem,
} from './draft'

/** Loose tiles. Ids are positional so duplicate kinds stay distinguishable. */
function source(...specs: [number, number][]): DraftItem[] {
  return specs.map(([color, value], i) => ({ id: `t${i}`, kind: 'tile' as const, color, value }))
}

/** A revealed plate, which drafts as its own token. */
function plate(id: string, color: number, value: number): DraftItem {
  return { id, kind: 'plate' as const, color, value }
}

const RED = 4
const BLUE = 1
const GREEN = 0
const YELLOW = 3

describe('the worked example from the rules', () => {
  // red-4, red-2, red-2, blue-1 — the case that pins down what "not the identical tiles" means.
  const tiles = source([RED, 4], [RED, 2], [RED, 2], [BLUE, 1])
  const [red4, red2a, red2b, blue1] = tiles as [DraftItem, DraftItem, DraftItem, DraftItem]

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

  it('confirms red-4 alone, because it is the only 4', () => {
    // The value sweep is finished even though red-2 is still clickable under the colour reading. A
    // finished strategy does not need the other one ruled out.
    expect(canConfirmDraft(tiles, [red4.id])).toBe(true)
    expect(completedStrategies(tiles, [red4.id])).toEqual({ color: false, value: true })
    expect(draftStates(tiles, [red4.id]).get(red2a.id)).toBe('active')
  })

  it('confirms red-2 alone too, as the only 2', () => {
    expect(completedStrategies(tiles, [red2a.id])).toEqual({ color: false, value: true })
    expect(canConfirmDraft(tiles, [red2a.id])).toBe(true)
  })
})

describe('pinning the criterion', () => {
  const tiles = source([RED, 4], [BLUE, 4], [RED, 2], [GREEN, 6])
  const [red4, blue4, red2, green6] = tiles as [DraftItem, DraftItem, DraftItem, DraftItem]

  it('keeps both attributes live on the first pick', () => {
    const states = draftStates(tiles, [red4.id])
    expect(states.get(blue4.id)).toBe('active')  // same symbol
    expect(states.get(red2.id)).toBe('active')   // same colour
    expect(states.get(green6.id)).toBe('inactive')
    expect(draftAttribute(tiles, [red4.id])).toBeNull()
    // Neither sweep is finished: another red and another 4 are both outstanding.
    expect(canConfirmDraft(tiles, [red4.id])).toBe(false)
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
    const tiles = source([RED, 1], [RED, 2], [BLUE, 1])
    const [red1, red2, blue1] = tiles as [DraftItem, DraftItem, DraftItem]
    // Neither sweep finished: another red and another 1 are both outstanding.
    expect(canConfirmDraft(tiles, [red1.id])).toBe(false)
    expect(canConfirmDraft(tiles, [red1.id, red2.id])).toBe(true)   // all the reds
    expect(canConfirmDraft(tiles, [red1.id, blue1.id])).toBe(true)  // all the 1s
    // Not a sweep of anything: three tiles sharing no single attribute. Unreachable by clicking, but
    // this function is the rule of record for callers that are not the UI.
    expect(canConfirmDraft(tiles, [red1.id, red2.id, blue1.id])).toBe(false)
  })

  it('finishes both strategies at once when a tile is unique in each', () => {
    const tiles = source([RED, 4], [BLUE, 2])
    const [red4] = tiles as [DraftItem, DraftItem]
    expect(completedStrategies(tiles, [red4.id])).toEqual({ color: true, value: true })
    expect(canConfirmDraft(tiles, [red4.id])).toBe(true)
  })

  it('does not need the other strategy ruled out, only its own swept', () => {
    // The distinction the rule turns on: red-4 is the only 4 in both sources. What differs is whether a
    // still-clickable red blocks it — and it must not.
    const shared = source([RED, 4], [RED, 2])
    const lone = source([RED, 4], [BLUE, 2])
    const first = (t: DraftItem[]) => [(t[0] as DraftItem).id]
    expect(canConfirmDraft(shared, first(shared))).toBe(true)
    expect(canConfirmDraft(lone, first(lone))).toBe(true)
    // ...and the still-clickable red really is still clickable.
    expect(draftStates(shared, first(shared)).get((shared[1] as DraftItem).id)).toBe('active')
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
    // The duplicate is inactive, not active, so nothing is left on offer and one copy finishes it.
    const tiles = source([RED, 4], [RED, 4])
    const [first, second] = tiles as [DraftItem, DraftItem]
    expect(draftStates(tiles, [first.id]).get(second.id)).toBe('inactive')
    expect(canConfirmDraft(tiles, [first.id])).toBe(true)
  })
})

describe('toggling', () => {
  const tiles = source([RED, 4], [BLUE, 4], [GREEN, 6])
  const [red4, blue4, green6] = tiles as [DraftItem, DraftItem, DraftItem]

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
    const [a, b] = dupes as [DraftItem, DraftItem]
    expect(toggleDraftSelection(dupes, [a.id], b.id)).toEqual([a.id])
  })
})

describe('the worked example: blue-1, blue-3, red-3, yellow-3', () => {
  const tiles = source([BLUE, 1], [BLUE, 3], [RED, 3], [YELLOW, 3])
  const [blue1, blue3, red3, yellow3] = tiles as [DraftItem, DraftItem, DraftItem, DraftItem]

  it('takes yellow-3 on its own — the only yellow', () => {
    expect(completedStrategies(tiles, [yellow3.id])).toEqual({ color: true, value: false })
    expect(canConfirmDraft(tiles, [yellow3.id])).toBe(true)
    // And the other 3s are still offered, in case the player meant the symbol instead.
    expect(draftStates(tiles, [yellow3.id]).get(blue3.id)).toBe('active')
    expect(draftStates(tiles, [yellow3.id]).get(red3.id)).toBe('active')
  })

  it('takes red-3 on its own too — the only red', () => {
    expect(canConfirmDraft(tiles, [red3.id])).toBe(true)
  })

  it('but adding red-3 to yellow-3 pins the symbol and then demands blue-3', () => {
    const two = [yellow3.id, red3.id]
    expect(draftAttribute(tiles, two)).toBe('value')
    expect(canConfirmDraft(tiles, two)).toBe(false)
    // Colour is off the table for the rest of the draft.
    expect(completedStrategies(tiles, two)).toEqual({ color: false, value: false })
    expect(canConfirmDraft(tiles, [...two, blue3.id])).toBe(true)
  })

  it('takes blue-1 on its own — the only 1, though blue-3 is also blue', () => {
    expect(completedStrategies(tiles, [blue1.id])).toEqual({ color: false, value: true })
    expect(canConfirmDraft(tiles, [blue1.id])).toBe(true)
  })

  it('will not take blue-3 on its own — unique in neither', () => {
    expect(canConfirmDraft(tiles, [blue3.id])).toBe(false)
    // Either sweep finishes it: all the blues, or all the 3s.
    expect(canConfirmDraft(tiles, [blue3.id, blue1.id])).toBe(true)
    expect(canConfirmDraft(tiles, [blue3.id, red3.id, yellow3.id])).toBe(true)
  })
})

describe('a revealed plate drafts as its token', () => {
  // The worked example: a plate showing blue-4, with loose blue-3 and blue-2 beside it.
  const BLUE_PLATE = plate('p1', BLUE, 4)
  const items = [BLUE_PLATE, ...source([BLUE, 3], [BLUE, 2])]
  const [, blue3, blue2] = items as [DraftItem, DraftItem, DraftItem]

  it('lets blue-3 go alone, as the only 3', () => {
    expect(canConfirmDraft(items, [blue3.id])).toBe(true)
    // The plate is offered too: it is blue, and the colour reading is still live.
    expect(draftStates(items, [blue3.id]).get('p1')).toBe('active')
  })

  it('demands the plate once a second blue pins the colour', () => {
    const two = [blue3.id, blue2.id]
    expect(draftAttribute(items, two)).toBe('color')
    // Sweeping blue means sweeping the plate as well — it is a blue item.
    expect(canConfirmDraft(items, two)).toBe(false)
    expect(draftStates(items, two).get('p1')).toBe('active')
    expect(canConfirmDraft(items, [...two, 'p1'])).toBe(true)
  })

  it('lets the plate be swept by its value like any other item', () => {
    const withFours = [BLUE_PLATE, ...source([GREEN, 4], [RED, 2])]
    expect(canConfirmDraft(withFours, ['p1', (withFours[1] as DraftItem).id])).toBe(true)
  })

  it('treats a plate and a tile of the same token as one kind — take one or the other', () => {
    const both = [plate('p1', BLUE, 4), ...source([BLUE, 4])]
    const tileId = (both[1] as DraftItem).id

    // Picking the plate rules out the matching tile, and vice versa: they repeat.
    expect(draftStates(both, ['p1']).get(tileId)).toBe('inactive')
    expect(draftStates(both, [tileId]).get('p1')).toBe('inactive')
    expect(toggleDraftSelection(both, ['p1'], tileId)).toEqual(['p1'])

    // Either one alone is the whole sweep, because they are the same kind.
    expect(canConfirmDraft(both, ['p1'])).toBe(true)
    expect(canConfirmDraft(both, [tileId])).toBe(true)
    // Both together is the repetition the rule forbids.
    expect(canConfirmDraft(both, ['p1', tileId])).toBe(false)
  })

  it('lets the choice of plate-or-tile decide whether a sweep fits', () => {
    // The same kind, two different homes. With the bays full, taking the tile is what makes it possible.
    const both = [plate('p1', BLUE, 4), ...source([BLUE, 4])]
    const tileId = (both[1] as DraftItem).id
    expect(draftFits(both, ['p1'], { tiles: 16, plates: 0 })).toBe(false)
    expect(draftFits(both, [tileId], { tiles: 16, plates: 0 })).toBe(true)
  })
})

describe('how much drawer room a draft needs', () => {
  const items = [plate('p1', BLUE, 4), ...source([BLUE, 3], [BLUE, 2])]
  const all = items.map(i => i.id)

  it('counts tiles and plates separately, because they land in different places', () => {
    expect(draftSpace(items, all)).toEqual({ tiles: 2, plates: 1 })
    expect(draftSpace(items, [])).toEqual({ tiles: 0, plates: 0 })
  })

  it('fits when both kinds have room', () => {
    expect(draftFits(items, all, { tiles: 16, plates: 2 })).toBe(true)
    expect(draftFits(items, all, { tiles: 2, plates: 1 })).toBe(true)
  })

  it('does not fit when the plate bays are full, however many tile slots are free', () => {
    // The case the message exists for: a legal colour sweep that drags a plate into a full bay.
    expect(canConfirmDraft(items, all)).toBe(true)
    expect(draftFits(items, all, { tiles: 16, plates: 0 })).toBe(false)
  })

  it('does not fit when the tile grid is full, however many bays are free', () => {
    expect(draftFits(items, all, { tiles: 1, plates: 2 })).toBe(false)
  })

  it('lets a plate-only draft through a full tile grid', () => {
    expect(draftFits(items, ['p1'], { tiles: 0, plates: 1 })).toBe(true)
  })
})
