import { MAX_GROUP_SIZE } from '@hexnome/rules/gameSettings'

/**
 * What each setting is called, and what it does — written once.
 *
 * Two screens say this: the setup flyout, where a dial can be turned, and the read-only panel that
 * shows what a game in progress was set up with. The words are the same in both, and the words are
 * the part that takes thought, so they live here rather than in whichever screen was written first.
 *
 * That is not tidiness. `docs/game-design.md` described this game accurately once and then lost five
 * of the seven dials, because a second copy of a fact has no way of knowing the first one moved. This
 * module is the first copy.
 *
 * Only the **text** is here. Which values a dial offers, how they are labelled and which ref backs it
 * belong to the screen that edits them; a screen that only reads a game gets its values from the
 * game. Both pick up a legend or an explanation by key.
 */

export interface DialText {
  /** Spelt out in the flyout and in the settings table, where there is room for a sentence. */
  readonly legend: string
  /** Two or three words for the summary strip, where there is not. */
  readonly short: string
  /**
   * What it does, for a player deciding. Absent where the legend already says everything — "Initial
   * stems on game start" needs no gloss, and a sentence restating it is noise.
   */
  readonly hint?: string
}

/** The bonus dials are one per group size, so their keys are built the same way in both screens. */
export const bonusKey = (size: number): string => `bonus${size}`

export const DIAL_TEXT: Readonly<Record<string, DialText>> = {
  platesPerRound: {
    legend: 'Plates per round',
    short: 'plates/round',
  },
  tileCopies: {
    legend: 'Tiles in the bag',
    short: 'tile bag',
    hint: 'Two, three or four copies of each of the 36 distinct tiles. More copies means duplicates '
      + 'turn up together more often, so a colour is easier to sweep in one draft.',
  },
  plateCopies: {
    legend: 'Plates in the bag',
    short: 'plate bag',
    hint: 'One, two or three per distinct tile. A four-round game draws sixteen, so beyond the first '
      + 'copy the bag never runs dry and nothing you spend comes back around.',
  },
  tileSlots: {
    legend: 'Tile slots in your drawer',
    short: 'tile slots',
    hint: 'Room to hold tiles you cannot place yet — and stems take these slots too, so a large '
      + 'opening allowance eats into it.',
  },
  plateSlots: {
    legend: 'Plate bays in your drawer',
    short: 'plate bays',
    hint: 'How many plates you can hold before committing one to the board.',
  },
  initialStems: {
    legend: 'Initial stems on game start',
    short: 'starting stems',
  },
  stemsPerInternalAnchor: {
    legend: 'Stems per enclosed internal anchor',
    short: 'internal stems',
  },
  stemsPerExternalAnchor: {
    legend: 'Stems per enclosed external anchor',
    short: 'external stems',
  },
  strictEnclosureBonus: {
    legend: 'Stem bonus for strict enclosure',
    short: 'strict bonus',
    hint: 'Extra stems when every neighbouring pair around an enclosed anchor matches. Strict placement '
      + 'guarantees that already, so the bonus only exists under the regular rule.',
  },
  firstPassFine: {
    legend: 'Fine for passing first',
    short: 'first-pass fine',
    hint: 'The first player out of a round gives up these points — and takes the first turn of the '
      + 'next round, at a source nobody has touched. At 0 there is no reason not to leave the moment '
      + 'the source turns awkward.',
  },
  pointsPerInternalAnchor: {
    legend: 'Points per internal anchor each round',
    short: 'internal points',
    hint: 'Every plate on your board has exactly one, so this is what another plate is worth — every '
      + 'round, for the rest of the game. One placed in round 1 of a four-round game pays four.',
  },
  pointsPerExternalAnchor: {
    legend: 'Points per external anchor each round',
    short: 'external points',
    hint: 'A bare cell your plates have wrapped on all six sides. Off by default: it is a by-product '
      + 'of placing plates loosely rather than something worth chasing.',
  },
  minGroupSize: {
    legend: 'Smallest group that scores',
    short: 'min group',
    hint: 'Connected tiles of one colour, or of one value. The single biggest lever on the endgame: '
      + 'at 2 almost anything pays, at 4 only deliberate building does.',
  },
  fineUnplaced: {
    legend: 'Fine for tiles left unplaced',
    short: 'fine unplaced',
    hint: 'At the very end, everything still in your drawer is charged at its face value — a plate '
      + 'through its own tile. Tiles carry between rounds freely; this settles once, for the whole '
      + 'game, so a six you never placed is an expensive thing to have hoarded.',
  },
  rewardStems: {
    legend: 'Bonus for stems left over',
    short: 'stem bonus',
    hint: 'A point for each stem still held when the game ends — the mirror of the fine, so spending '
      + 'a stem you did not need is a real choice.',
  },
  // One per group size above the smallest, built rather than written out.
  ...Object.fromEntries(
    Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, index) => {
      const size = index + 2
      return [bonusKey(size), {
        legend: `Bonus for a group of ${size}`,
        short: `bonus ${size}`,
      }]
    }),
  ),
}

/** The text for a dial, or a legible fallback if a key ever arrives without any. */
export function textOf(key: string): DialText {
  return DIAL_TEXT[key] ?? { legend: key, short: key }
}
