import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIRST_PASS_FINE,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_PLATE_COPIES,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_PLAYER_COUNT,
  DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
  DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_STEM_COUNT,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  DEFAULT_TILE_COPIES,
  DEFAULT_TILE_SLOTS,
  MAX_GROUP_SIZE,
  roundsOf,
} from '@hexnome/rules/gameSettings'
import { DISTINCT_TILES, TILE_VALUE_COUNT } from '@hexnome/rules/deck'
import { COLOR_POINTS } from '@hexnome/rules/agenda'
import { POINTS_PER_STEM } from '@hexnome/rules/groups'
import { SOURCE_TILES_PER_LOT } from '@hexnome/rules/source'
import rules from './rules.md?raw'
import { sectionsOf } from '@/ui/rulesDocument'

/**
 * The rules, against the rules.
 *
 * `docs/game-design.md` described this game accurately once. By the time anyone checked, five of the
 * seven dials had been added without it — the round anchor points among them — and the document was
 * quietly lying to whoever read it. Nothing was wrong with the writing; there was simply no way for
 * changing a default to be anybody's problem.
 *
 * This is that way. Every number the rulebook states is asserted against the constant it came from,
 * so a dial that moves without the prose moving fails here. It cannot check that a *sentence* is
 * true — only a reader can — but the numbers are what go stale, because they are what change.
 */

/**
 * The document with its line breaks flattened.
 *
 * The prose is hard-wrapped, so a claim can be split across two lines and would otherwise fail for
 * having been rewrapped rather than for being wrong — which would teach whoever hits it that this
 * suite cries wolf.
 */
const FLAT = rules.replace(/\s+/g, ' ')

/** Asserted as a labelled string so a failure says which claim broke, not just `false`. */
function claims(what: string, text: string): void {
  expect(`${what}: ${FLAT.includes(text.replace(/\s+/g, ' '))}`).toBe(`${what}: true`)
}

describe('what the rulebook says the numbers are', () => {
  it('states the drawer', () => {
    claims('tile slots', `**${DEFAULT_TILE_SLOTS} tiles**`)
    claims('plate bays', `**${DEFAULT_PLATE_SLOTS} plates**`)
  })

  it('states the bags, as totals rather than as copies', () => {
    claims('tile bag', `| ${DEFAULT_TILE_COPIES * DISTINCT_TILES} |`)
    claims('plate bag', `| ${DEFAULT_PLATE_COPIES * DISTINCT_TILES} |`)
    claims('distinct kinds', `${DISTINCT_TILES} kinds`)
  })

  it('states the source', () => {
    claims('plates per round', `**${DEFAULT_PLATES_PER_ROUND} plates per round**`)
    claims('tiles per lot', `${SOURCE_TILES_PER_LOT} loose tiles`)
  })

  it('states what stems cost and pay', () => {
    claims('starting stems', `You start with **${DEFAULT_STEM_COUNT}**`)
    claims('internal stems', `**${DEFAULT_STEMS_PER_INTERNAL_ANCHOR} stems** for an internal anchor`)
    claims('external stems', `**${DEFAULT_STEMS_PER_EXTERNAL_ANCHOR}** for an external one`)
    claims('strict bonus', `pays\n**${DEFAULT_STRICT_ENCLOSURE_BONUS} more**`)
  })

  it('states what a round pays', () => {
    claims('colour target', `pays **${COLOR_POINTS}** for each tile`)
    claims('internal anchor points', `**${DEFAULT_POINTS_PER_INTERNAL_ANCHOR}** if internal`)
    claims('external anchor points', `**${DEFAULT_POINTS_PER_EXTERNAL_ANCHOR}** if external`)
    claims('first-pass fine', `**${DEFAULT_FIRST_PASS_FINE} point**`)
  })

  it('states the closing reckoning', () => {
    claims('minimum group', `reaches **${DEFAULT_MIN_GROUP_SIZE}** tiles`)
    claims('group bonus', `**${DEFAULT_GROUP_BONUSES[MAX_GROUP_SIZE]}** for a group of six`)
    claims('stem bonus', `every stem still held pays **${POINTS_PER_STEM}**`)
  })

  it('states the shape of the game', () => {
    claims('classic rounds', `**Classic** is ${roundsOf('classic')} rounds`)
    claims('random rounds', `**Random** is ${roundsOf('random')} (*mode*)`)
    claims('values', `**${TILE_VALUE_COUNT}**`)
  })

  /** The table repeats the defaults, so it can go stale on its own. */
  it('repeats them in the reference table', () => {
    for (const [dial, value] of [
      ['Players', DEFAULT_PLAYER_COUNT],
      ['Plates per round', DEFAULT_PLATES_PER_ROUND],
      ['Tile slots', DEFAULT_TILE_SLOTS],
      ['Plate bays', DEFAULT_PLATE_SLOTS],
      ['Starting stems', DEFAULT_STEM_COUNT],
      ['Internal stems', DEFAULT_STEMS_PER_INTERNAL_ANCHOR],
      ['External stems', DEFAULT_STEMS_PER_EXTERNAL_ANCHOR],
      ['Strict bonus', DEFAULT_STRICT_ENCLOSURE_BONUS],
      ['Internal points', DEFAULT_POINTS_PER_INTERNAL_ANCHOR],
      ['External points', DEFAULT_POINTS_PER_EXTERNAL_ANCHOR],
      ['First-pass fine', DEFAULT_FIRST_PASS_FINE],
      ['Min group', DEFAULT_MIN_GROUP_SIZE],
    ] as const) {
      claims(`${dial} row`, `| ${dial} | ${value} |`)
    }
  })
})

/**
 * The rulebook is also a document the panel has to be able to show, and the panel builds its
 * navigation out of it. A section that loses its heading loses its way in.
 */
describe('the rulebook as a document', () => {
  it('is divided into sections the panel can navigate', () => {
    const sections = sectionsOf(rules)
    expect(sections.length).toBeGreaterThanOrEqual(8)
    expect(sections.map(s => s.title)).toContain('A turn')
    expect(new Set(sections.map(s => s.slug)).size).toBe(sections.length)
  })

  /**
   * Every picture the rulebook asks for is really on disk.
   *
   * This used to assert the opposite — that there were no image references at all — because the
   * slots were HTML comments until the pictures existed. Now they exist, and the question worth
   * asking is the one that will go wrong later: a renamed or deleted file leaves a reference behind,
   * and a broken image in a rulebook is invisible to every test that only reads the text.
   *
   * The paths are absolute and resolved against `public/`, which is what Vite serves them from — a
   * relative path would not work at all, since the markdown is imported as a raw string and Vite
   * never sees inside it to rewrite anything.
   */
  it('asks only for pictures that exist', () => {
    const referenced = [...rules.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1] ?? '')
    expect(referenced.length).toBeGreaterThan(6)

    for (const path of referenced) {
      expect(`${path}: absolute`).toBe(`${path.startsWith('/') ? path : `/${path}`}: absolute`)
      const onDisk = resolve(import.meta.dirname, '../../public', path.replace(/^\//, ''))
      expect(`${path}: ${existsSync(onDisk)}`).toBe(`${path}: true`)
    }
  })

  /** Alt text, because a rulebook read aloud should still describe its pictures. */
  it('describes every picture', () => {
    for (const [, alt, path] of rules.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      // The symbol table's cells are labelled by the row around them, so those are deliberately bare.
      if (path?.includes('/textures/symbols/')) continue
      expect(`${path}: ${(alt ?? '').length > 12}`).toBe(`${path}: true`)
    }
  })
})
