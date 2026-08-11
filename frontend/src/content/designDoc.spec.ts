import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DISTINCT_TILES, STANDARD_PLATE_COPIES, STANDARD_TILE_COPIES } from '@hexnome/rules/deck'
import {
  DEFAULT_FIRST_PASS_FINE,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
  DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
  DEFAULT_TILE_SLOTS,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE_CHOICES,
  PLATES_PER_ROUND_CHOICES,
  PLATE_SLOT_CHOICES,
  TILE_SLOT_CHOICES,
  ANCHOR_POINT_CHOICES,
  FIRST_PASS_FINE_CHOICES,
  roundsOf,
} from '@hexnome/rules/gameSettings'

/**
 * The design document, against the code it describes.
 *
 * `docs/game-design.md` is the reasoning behind the rules — why each is what it is, what was
 * rejected, what is still open. It is not the rulebook (that is `frontend/src/content/rules.md`,
 * checked by its own spec), but it quotes numbers, and quoted numbers go stale.
 *
 * They did. The drawer was documented at 16 slots with choices 12/14/16/18 long after the code
 * settled on a default of 12 from 10/12/14/16, and the round anchor points were added without the
 * document hearing about them at all. Nothing was wrong with the writing; there was simply no way for
 * changing a constant to be anyone's problem.
 *
 * This is that way. It sits beside `rules.spec.ts`, which does the same for the rulebook, rather than
 * in the rules package where the constants live — that package compiles without Node's types on
 * purpose, because it runs in a browser too, and a spec that reads the filesystem would mean adding
 * them and quietly weakening the boundary its own docstrings advertise.
 *
 * It cannot check that an argument still holds — only a reader can — but the numbers are what change.
 */

const DOC = readFileSync(resolve(import.meta.dirname, '../../../docs/game-design.md'), 'utf8')

/** Line breaks flattened, so a claim that was rewrapped is not read as a claim that was broken. */
const FLAT = DOC.replace(/\s+/g, ' ')

/**
 * A choice list the way the prose writes it: `3, 4, 5 or 6`.
 *
 * Built rather than hand-typed, so adding a fourth choice to a dial fails this rather than leaving a
 * sentence quietly listing three.
 */
function list(choices: readonly number[]): string {
  if (choices.length < 2) return choices.join('')
  return `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`
}

/** Labelled, so a failure names the claim rather than printing `false`. */
function states(what: string, text: string): void {
  expect(`${what}: ${FLAT.includes(text.replace(/\s+/g, ' '))}`).toBe(`${what}: true`)
}

describe('what the design doc says the numbers are', () => {
  it('describes the drawer as the code sizes it', () => {
    states('tile slot choices', `| **Tile slots** | ${TILE_SLOT_CHOICES.join(', ')} | ${DEFAULT_TILE_SLOTS} |`)
    states('plate bay choices', `| **Plate bays** | ${PLATE_SLOT_CHOICES.join(', ')} | ${DEFAULT_PLATE_SLOTS} |`)
    states('drawer capacity', `**${DEFAULT_TILE_SLOTS} tile slots**`)
  })

  it('describes the bags', () => {
    states('plate bag', `**${STANDARD_PLATE_COPIES * DISTINCT_TILES}** — one per distinct tile`)
    states('tile bag', `**${STANDARD_TILE_COPIES * DISTINCT_TILES}** — three copies`)
    states('distinct tiles', `${DISTINCT_TILES} distinct tiles`)
  })

  it('describes the round budget', () => {
    states('plates per round', `${list(PLATES_PER_ROUND_CHOICES)}, default **${DEFAULT_PLATES_PER_ROUND}**`)
  })

  it('describes what a round pays for anchors', () => {
    states('internal points', `${list(ANCHOR_POINT_CHOICES)}, default **${DEFAULT_POINTS_PER_INTERNAL_ANCHOR}**`)
    states('external points', `default **${DEFAULT_POINTS_PER_EXTERNAL_ANCHOR}**`)
  })

  it('describes the passing fine', () => {
    states('first-pass fine', `${list(FIRST_PASS_FINE_CHOICES)} points, ${DEFAULT_FIRST_PASS_FINE} by default`)
  })

  it('describes the endgame dials', () => {
    states('minimum group', `${list(MIN_GROUP_SIZE_CHOICES)}, default **${DEFAULT_MIN_GROUP_SIZE}**`)
    states('full-group bonus', `**+${DEFAULT_GROUP_BONUSES[MAX_GROUP_SIZE]} for a full group**`)
  })

  it('describes the modes and their lengths', () => {
    states('classic', `| **Classic** | ${roundsOf('classic')} |`)
    states('classic reversed', `| **Classic reversed** | ${roundsOf('classicReversed')} |`)
    states('random', `| **Random** | ${roundsOf('random')} |`)
  })
})

describe('what the design doc is for', () => {
  /**
   * It points at the rulebook rather than trying to be one. Two documents both claiming to say what
   * the rules *are* is how this one drifted in the first place.
   */
  it('sends a reader wanting the rules to the rulebook', () => {
    expect(DOC).toContain('frontend/src/content/rules.md')
  })

  /** Every anchor the header and the resolved questions link to has to exist. */
  it('has a heading behind every link it makes to itself', () => {
    const headings = new Set(
      [...DOC.matchAll(/^#{2,3} (.+)$/gm)].map(([, title]) =>
        (title ?? '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')),
    )
    for (const [, anchor] of DOC.matchAll(/\]\(#([a-z0-9-]+)\)/g)) {
      expect(`#${anchor}: found`).toBe(`#${headings.has(anchor ?? '') ? anchor : 'MISSING ' + anchor}: found`)
    }
  })
})
