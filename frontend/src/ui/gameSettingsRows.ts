import {
  MAX_GROUP_SIZE,
  PLATE_BAG_LABELS,
  PLATE_COPIES_CHOICES,
  SOLO,
  TILE_BAG_LABELS,
  TILE_COPIES_CHOICES,
  modeInfo,
  roundsOf,
  type GameSettings,
} from '@hexnome/rules/gameSettings'
import { bonusKey, textOf, type DialText } from './dialText'

/**
 * A game's settings, as rows to read.
 *
 * The setup screen turns dials; this reports what a game in progress was set up with, which is a
 * different job with the same words. The words come from `dialText` so there is one copy of them; the
 * values come from the game's own `GameSettings`, so this cannot describe a game other than the one
 * on screen.
 *
 * Pure: settings in, rows out, no Vue. Which makes the awkward part — the four settings whose stored
 * value is not the number a player thinks in — testable rather than eyeballed.
 */

export interface SettingRow {
  readonly key: string
  readonly label: string
  /** Already formatted: bag totals rather than copies, Yes/No rather than 1/0. */
  readonly value: string
  readonly hint?: string
}

/** A choice rendered through its labels, the way the setup screen renders it. */
function labelled(value: number, choices: readonly number[], labels: readonly string[]): string {
  return labels[choices.indexOf(value)] ?? String(value)
}

/**
 * The order the setup screen presents them in.
 *
 * Listed rather than derived, because the grouping is an editorial judgement about what a player
 * wants to see first and there is nothing in the data that knows it. `gameSettingsRows.spec` checks
 * that every dial with text appears here, so adding one and forgetting this list is a failing test
 * rather than a row that quietly never shows.
 */
export const ROW_ORDER: readonly string[] = [
  'platesPerRound',
  'tileCopies',
  'plateCopies',
  'tileSlots',
  'plateSlots',
  'initialStems',
  'stemsPerInternalAnchor',
  'stemsPerExternalAnchor',
  'strictEnclosureBonus',
  'firstPassFine',
  'pointsPerInternalAnchor',
  'pointsPerExternalAnchor',
  'minGroupSize',
  ...Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, index) => bonusKey(index + 2)),
  'fineUnplaced',
  'rewardStems',
  'allowUndo',
]

/** How to read each dial out of a game. The keys are `ROW_ORDER`'s. */
function valueOf(key: string, s: GameSettings): string {
  if (key === 'tileCopies') return labelled(s.tileCopies, TILE_COPIES_CHOICES, TILE_BAG_LABELS)
  if (key === 'plateCopies') return labelled(s.plateCopies, PLATE_COPIES_CHOICES, PLATE_BAG_LABELS)
  if (key === 'fineUnplaced') return s.fineUnplaced ? 'Yes' : 'No'
  if (key === 'rewardStems') return s.rewardStems ? 'Yes' : 'No'
  if (key === 'allowUndo') return s.allowUndo ? 'Yes' : 'No'

  const bonus = /^bonus(\d+)$/.exec(key)
  if (bonus) return String(s.groupBonuses[Number(bonus[1])] ?? 0)

  const held = (s as unknown as Record<string, unknown>)[key]
  return typeof held === 'number' ? String(held) : '—'
}

/**
 * The rows above the dials: what kind of game this is.
 *
 * Not dials — they are chosen by pressing a card rather than turning something — but they are the
 * first things anyone opening this panel wants to know, and the rounds are only knowable from the
 * mode.
 */
function shapeRows(s: GameSettings): SettingRow[] {
  const rounds = roundsOf(s.mode)
  const rows: SettingRow[] = [
    {
      key: 'mode',
      label: 'Mode',
      value: `${modeInfo(s.mode)?.label ?? s.mode}${rounds ? ` · ${rounds} rounds` : ''}`,
      hint: modeInfo(s.mode)?.description,
    },
    {
      key: 'placementRule',
      label: 'Placement',
      value: s.placementRule === 'strict' ? 'Strict' : 'Regular',
      hint: s.placementRule === 'strict'
        ? 'Every neighbour must share the placed tile’s colour or its value.'
        : 'At least one neighbour must share the placed tile’s colour or its value.',
    },
  ]

  // A solo game has no table to describe, and "Players 1" reads as though it could have been more.
  if (s.players > SOLO) {
    rows.push({ key: 'players', label: 'Players', value: String(s.players) })
  }
  return rows
}

/**
 * Every setting this game is running under.
 *
 * Nothing is hidden. The setup screen drops a dial that cannot apply — the strict bonus under the
 * strict rule, a group bonus at or below the minimum — because a control you cannot use is a
 * question you have to answer. Here they are all shown, reading 0, because this panel answers "what
 * is this game" and "that one does not apply, so it is nothing" is part of the answer.
 */
export function settingRows(settings: GameSettings): SettingRow[] {
  const dials = ROW_ORDER.map((key): SettingRow => {
    const text: DialText = textOf(key)
    return { key, label: text.legend, value: valueOf(key, settings), hint: text.hint }
  })
  return [...shapeRows(settings), ...dials]
}
