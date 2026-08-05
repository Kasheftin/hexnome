/**
 * A game's rules, in rows a player can read.
 *
 * The waiting screen has to answer "what am I about to play?" before anyone commits, and the person
 * arriving on a link chose none of it. So the whole setup is shown rather than a summary — a rule you
 * cannot see is one you will be surprised by three rounds in.
 *
 * Derived from `GameSettings` as it came back from the server, not from the menu's dials: the game on
 * the server is what will actually be played, and a row missing here would be a rule in play that
 * nobody was told about.
 */
import { modeInfo, roundsOf, type GameSettings } from '@hexnome/rules/gameSettings'

export interface SettingsRow {
  readonly label: string
  readonly value: string
}

const yes = (on: boolean) => (on ? 'Yes' : 'No')

export function settingsRows(settings: GameSettings): SettingsRow[] {
  const rows: SettingsRow[] = [
    { label: 'Mode', value: modeInfo(settings.mode)?.label ?? settings.mode },
    { label: 'Rounds', value: String(roundsOf(settings.mode)) },
    { label: 'Players', value: String(settings.players) },
    { label: 'Plates per round', value: String(settings.platesPerRound) },
    { label: 'Placement', value: settings.placementRule === 'strict' ? 'Strict' : 'Regular' },
    { label: 'Tile slots', value: String(settings.tileSlots) },
    { label: 'Plate bays', value: String(settings.plateSlots) },
    { label: 'Starting stems', value: String(settings.initialStems) },
    { label: 'Stems per plate anchor', value: String(settings.stemsPerInternalAnchor) },
    { label: 'Stems per open anchor', value: String(settings.stemsPerExternalAnchor) },
  ]

  /*
   * Zero under strict placement, where a strict enclosure is the only kind there is — the bonus would
   * be paid for meeting the ordinary rule. Hidden rather than shown as zero, which would read as a
   * setting somebody had turned off.
   */
  if (settings.strictEnclosureBonus > 0) {
    rows.push({ label: 'Strict enclosure bonus', value: `+${settings.strictEnclosureBonus}` })
  }

  rows.push(
    { label: 'Smallest scoring group', value: String(settings.minGroupSize) },
    { label: 'Group size bonuses', value: describeBonuses(settings) },
    { label: 'Fine for tiles left over', value: yes(settings.fineUnplaced) },
    { label: 'Point per stem kept', value: yes(settings.rewardStems) },
  )

  return rows
}

/**
 * The size bonuses, as the sizes that actually pay.
 *
 * The table is indexed by group size and zeroed at or below the minimum, so printing it raw is a run
 * of noughts followed by the numbers that matter. "4:+3, 6:+6" is the same information in a form a
 * player can hold in their head.
 */
function describeBonuses(settings: GameSettings): string {
  const paying = settings.groupBonuses
    .map((bonus, size) => ({ bonus, size }))
    .filter(({ bonus, size }) => bonus > 0 && size >= settings.minGroupSize)
    .map(({ bonus, size }) => `${size}:+${bonus}`)
  return paying.length > 0 ? paying.join(', ') : 'None'
}
