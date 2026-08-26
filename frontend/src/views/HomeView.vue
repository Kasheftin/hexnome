<script setup lang="ts">
/**
 * The main menu: who you are, which game, then how it is set up.
 *
 * Two steps. There was a third — a title screen offering "New game" and "Settings" — and it is
 * gone: there are no application settings to reach, so it was one press that only ever led to the
 * same place. The kinds now stand on the first screen, which is also what makes the shape of the
 * game legible on arrival.
 *
 * Kinds that are not playable yet are shown and disabled rather than hidden — a menu listing only what
 * works today says less about the game than one that admits what is coming.
 *
 * Starting a game opens it on the server, which mints its id and its seed, and navigates to
 * whichever screen the game is actually on — `/join` for a table still filling, `/game` for one that
 * is already running (stores/game.ts).
 */
import { mdiCog, mdiDiceMultiple, mdiPodium } from '@mdi/js'
import { computed, nextTick, ref, watch, type ComponentPublicInstance, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_PLAYER_COUNT,
  DEFAULT_SINGLEPLAYER_MODE,
  GAME_KINDS,
  PLAYER_COUNT_CHOICES,
  SOLO,
  platesPerRoundChoices,
  nearestPlatesPerRound,
  reconcilePlatesPerRound,
  TILE_COPIES_CHOICES,
  PLATE_COPIES_CHOICES,
  TILE_BAG_LABELS,
  PLATE_BAG_LABELS,
  DEFAULT_TILE_COPIES,
  DEFAULT_PLATE_COPIES,
  PLATE_SLOT_CHOICES,
  TILE_SLOT_CHOICES,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_TILE_SLOTS,
  SINGLEPLAYER_MODES,
  STEM_COUNT_CHOICES,
  STEMS_PER_ANCHOR_CHOICES,
  DEFAULT_STEM_COUNT,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  ANCHOR_POINT_CHOICES,
  DEFAULT_FIRST_PASS_FINE,
  DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
  DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  FIRST_PASS_FINE_CHOICES,
  STRICT_BONUS_CHOICES,
  GROUP_BONUS_CHOICES,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE_CHOICES,
  DEFAULT_FINE_UNPLACED,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_ALLOW_UNDO,
  DEFAULT_REWARD_STEMS,
  effectiveGroupBonuses,
  effectiveFirstPassFine,
  effectiveStrictBonus,
  STRICT_BONUS_WHEN_FORCED,
  PLACEMENT_RULE_HINTS,
  PLACEMENT_RULE_LABELS,
  modeInfo,
  roundsOf,
  type GameKind,
  type GameSettings,
  type SingleplayerMode,
} from '@hexnome/rules/gameSettings'
import {
  GAME_PRESETS,
  presetSettings,
  type GamePreset,
} from '@hexnome/rules/presets'
import {
  DEFAULT_PLACEMENT_RULE,
  isPlacementRule,
  PLACEMENT_RULES,
  type PlacementRule,
} from '@hexnome/rules/placement'
import HighscoresPanel from '@/ui/HighscoresPanel.vue'
import RulesPanel from '@/ui/RulesPanel.vue'
import { bonusKey, textOf } from '@/ui/dialText'
import SettingsFlyout from '@/ui/SettingsFlyout.vue'
import { ApiError } from '@/api/base'
import { createGame } from '@/api/games'
import { currentGame } from '@/composables/currentGame'
import { playerName, rememberName, suggestName } from '@/composables/playerName'
import { forgetSetup, rememberSetup, savedSetup, type SavedSetup } from '@/composables/savedSetup'
import { rememberSeat } from '@/composables/useSeat'

type Step = 'title' | 'preset' | 'setup'

/** A yes/no dial, as the numbers the dial machinery expects and the words a player should read. */
const SWITCH_CHOICES: readonly number[] = [0, 1]
const SWITCH_LABELS: readonly string[] = ['No', 'Yes']

const router = useRouter()

/** Read once on mount, so the field arrives filled rather than empty and then populated. */
const name = ref(playerName())

/**
 * A game left unfinished, if there is one.
 *
 * Read once rather than watched: this screen cannot start or end a game without navigating away from
 * itself, so the answer cannot change while it is on screen.
 */
const unfinished = ref(currentGame())

/**
 * Another name from the pool, kept immediately.
 *
 * Stored on the press rather than waiting for a `change` the input will never emit — `v-model` sets
 * the value programmatically, and that fires no user event. Leaving it to the field would lose the
 * rolled name on the next reload.
 */
function reroll(): void {
  name.value = suggestName(name.value)
  rememberName(name.value)
}

const step = ref<Step>('title')
const kind = ref<GameKind | null>(null)
/** Only asked for multiplayer; a solo game seats one by definition. */
const playerCount = ref<number>(DEFAULT_PLAYER_COUNT)
const mode = ref<SingleplayerMode>(DEFAULT_SINGLEPLAYER_MODE)
const platesPerRound = ref<number>(DEFAULT_PLATES_PER_ROUND)
/* Held as copies, shown as bag totals — see the dials below. */
const tileCopies = ref<number>(DEFAULT_TILE_COPIES)
const plateCopies = ref<number>(DEFAULT_PLATE_COPIES)
const tileSlots = ref<number>(DEFAULT_TILE_SLOTS)
const plateSlots = ref<number>(DEFAULT_PLATE_SLOTS)
const initialStems = ref<number>(DEFAULT_STEM_COUNT)
const stemsPerInternalAnchor = ref<number>(DEFAULT_STEMS_PER_INTERNAL_ANCHOR)
const stemsPerExternalAnchor = ref<number>(DEFAULT_STEMS_PER_EXTERNAL_ANCHOR)
const strictEnclosureBonus = ref<number>(DEFAULT_STRICT_ENCLOSURE_BONUS)
const pointsPerInternalAnchor = ref<number>(DEFAULT_POINTS_PER_INTERNAL_ANCHOR)
const pointsPerExternalAnchor = ref<number>(DEFAULT_POINTS_PER_EXTERNAL_ANCHOR)
/** Only asked for multiplayer; a solo game passes first every round by definition. */
const firstPassFine = ref<number>(DEFAULT_FIRST_PASS_FINE)

const placementRule = ref<PlacementRule>(DEFAULT_PLACEMENT_RULE)

const minGroupSize = ref<number>(DEFAULT_MIN_GROUP_SIZE)

/*
 * Switches, held as 0/1 so they can share the dial machinery with everything else, and rendered as
 * No/Yes rather than as bare digits.
 */
const fineUnplaced = ref<number>(DEFAULT_FINE_UNPLACED ? 1 : 0)
const rewardStems = ref<number>(DEFAULT_REWARD_STEMS ? 1 : 0)
const allowUndo = ref<number>(DEFAULT_ALLOW_UNDO ? 1 : 0)

/**
 * One ref per group size, rather than one ref holding the table.
 *
 * Which of these the player can see depends on the minimum, and a size that goes out of reach keeps
 * its value while hidden — so raising the minimum and lowering it again does not silently wipe a
 * bonus the player had set. The table handed to the game is assembled from these on start.
 */
const bonusBySize = Object.fromEntries(
  Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, index) => {
    const size = index + 2
    return [size, ref<number>(DEFAULT_GROUP_BONUSES[size] ?? 0)]
  }),
) as Record<number, Ref<number>>

/** The table as the game will run it: zeroed at and below the minimum. */
const groupBonuses = computed(() => effectiveGroupBonuses(
  minGroupSize.value,
  Array.from({ length: MAX_GROUP_SIZE + 1 }, (_, size) => bonusBySize[size]?.value ?? 0),
))

/**
 * A numeric dial: a row of choices behind the gear.
 *
 * **Declared once and read twice** — the flyout renders these, and the summary line on the menu reads
 * the same list. Two hand-written lists would drift the first time a dial was added and the summary
 * forgotten, and the summary is exactly the thing that has to stay honest: it is what a player sees
 * instead of opening the panel.
 */
interface Dial {
  readonly key: string
  /** Spelt out in the flyout, where there is room for a sentence. */
  readonly legend: string
  /** Two or three words for the summary, where there is not. */
  readonly short: string
  readonly choices: readonly number[]
  /** Shown instead of the raw numbers, positionally. Used by the yes/no switches. */
  readonly labels?: readonly string[]
  readonly model: Ref<number>
  readonly hint?: string
  /** False hides the dial entirely. */
  readonly applies?: () => boolean
  /**
   * When this returns a value, the dial shows that value, says why, and cannot be turned.
   *
   * Distinct from hiding it. A setting the rules decide for you is still worth seeing — a player who
   * knows a strict ring pays a bonus needs to see that it is still being paid, or the stricter rule
   * looks like it took something away.
   */
  readonly lockedTo?: () => { value: number, why: string } | null
  /** Omitted from the readout strip, which would otherwise run to a dozen pills. */
  readonly minor?: boolean
}

const SUPPLY_DIALS: readonly Dial[] = [
  {
    key: 'platesPerRound',
    ...textOf('platesPerRound'),
    // Replaced per mode in `visibleSections` — see there for why it cannot be stated here.
    choices: platesPerRoundChoices(DEFAULT_SINGLEPLAYER_MODE),
    model: platesPerRound,
  },
]

/**
 * How much material the game is dealt from.
 *
 * The dial holds copies and renders totals, which is what `labels` is for. A player thinks in "how
 * many tiles are in this game", not in multiples of 36 — and the totals come from the rules package
 * rather than being written out here, so a fourth choice cannot arrive with a stale label.
 */
const DECK_DIALS: readonly Dial[] = [
  {
    key: 'tileCopies',
    ...textOf('tileCopies'),
    choices: TILE_COPIES_CHOICES,
    labels: TILE_BAG_LABELS,
    model: tileCopies,
  },
  {
    key: 'plateCopies',
    ...textOf('plateCopies'),
    choices: PLATE_COPIES_CHOICES,
    labels: PLATE_BAG_LABELS,
    model: plateCopies,
  },
]

const DRAWER_DIALS: readonly Dial[] = [
  {
    key: 'tileSlots',
    ...textOf('tileSlots'),
    choices: TILE_SLOT_CHOICES,
    model: tileSlots,
  },
  {
    key: 'plateSlots',
    ...textOf('plateSlots'),
    choices: PLATE_SLOT_CHOICES,
    model: plateSlots,
  },
]

const STEM_DIALS: readonly Dial[] = [
  {
    key: 'initialStems',
    ...textOf('initialStems'),
    choices: STEM_COUNT_CHOICES,
    model: initialStems,
  },
  {
    key: 'stemsPerInternalAnchor',
    ...textOf('stemsPerInternalAnchor'),
    choices: STEMS_PER_ANCHOR_CHOICES,
    model: stemsPerInternalAnchor,
  },
  {
    key: 'stemsPerExternalAnchor',
    ...textOf('stemsPerExternalAnchor'),
    choices: STEMS_PER_ANCHOR_CHOICES,
    model: stemsPerExternalAnchor,
  },
  {
    key: 'strictEnclosureBonus',
    ...textOf('strictEnclosureBonus'),
    choices: STRICT_BONUS_CHOICES,
    model: strictEnclosureBonus,
    /*
     * Locked rather than hidden under strict placement.
     *
     * It used to be hidden, on the reasoning that a control you cannot use invites the question "why
     * can I not have this?". Hiding it asked a worse one: the bonus vanished from the panel at the
     * same moment the rules started granting it every time, so a player who had learned that a strict
     * ring pays a stem extra saw the stricter rule apparently take it away. Shown, holding its 1, with
     * the reason written underneath.
     *
     * The chosen value is kept underneath the lock, so switching to strict and back does not silently
     * reset it.
     */
    lockedTo: () => (placementRule.value === 'strict'
      ? { value: STRICT_BONUS_WHEN_FORCED, why: 'Strict placement earns this at every enclosure, so it is always on.' }
      : null),
  },
]

/**
 * The one band that exists only at a table.
 *
 * The whole band disappears in a solo game rather than the dial being disabled inside it — there is
 * nothing to explain, because with one seat every pass is the first one and leading the next round
 * means nothing. `visibleSections` drops a band once its last dial goes.
 */
const PASSING_DIALS: readonly Dial[] = [
  {
    key: 'firstPassFine',
    ...textOf('firstPassFine'),
    choices: FIRST_PASS_FINE_CHOICES,
    model: firstPassFine,
    applies: () => kind.value === 'multiplayer',
  },
]

/**
 * The one band that exists only *away* from a table — the mirror of the passing band above.
 *
 * Undo rewinds the shared source, so at a table it would take back a lot the others have already
 * drafted against. The band disappears rather than the dial being disabled inside it, for the same
 * reason: there is nothing to explain to somebody it can never apply to.
 */
const SOLO_DIALS: readonly Dial[] = [
  {
    key: 'allowUndo',
    ...textOf('allowUndo'),
    choices: SWITCH_CHOICES,
    labels: SWITCH_LABELS,
    model: allowUndo,
    applies: () => kind.value === 'singleplayer',
  },
]

/**
 * The only reward for building *wide*.
 *
 * Everything else on this panel pays for tiles, so without these a player is best served by one plate
 * worked to death. An anchor comes with a plate — one internal each, always — and it is paid for again
 * at the end of every round, which is what makes an early plate worth more than a late one.
 *
 * Separate from the stem rates above, and deliberately so: those pay for *enclosing* an anchor, which
 * is a feat, while these pay for it existing, which is a decision about the shape of the board.
 */
const ANCHOR_POINT_DIALS: readonly Dial[] = [
  {
    key: 'pointsPerInternalAnchor',
    ...textOf('pointsPerInternalAnchor'),
    choices: ANCHOR_POINT_CHOICES,
    model: pointsPerInternalAnchor,
  },
  {
    key: 'pointsPerExternalAnchor',
    ...textOf('pointsPerExternalAnchor'),
    choices: ANCHOR_POINT_CHOICES,
    model: pointsPerExternalAnchor,
  },
]

const FINAL_DIALS: readonly Dial[] = [
  {
    key: 'minGroupSize',
    ...textOf('minGroupSize'),
    choices: MIN_GROUP_SIZE_CHOICES,
    model: minGroupSize,
  },
  ...Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, index): Dial => {
    const size = index + 2
    return {
      key: bonusKey(size),
      ...textOf(bonusKey(size)),
      choices: GROUP_BONUS_CHOICES,
      model: bonusBySize[size] as Ref<number>,
      minor: true,
      // Nothing is paid at or below the minimum: that size is the baseline, not an achievement.
      applies: () => size > minGroupSize.value,
    }
  }),
  {
    key: 'fineUnplaced',
    ...textOf('fineUnplaced'),
    choices: SWITCH_CHOICES,
    labels: SWITCH_LABELS,
    model: fineUnplaced,
  },
  {
    key: 'rewardStems',
    ...textOf('rewardStems'),
    choices: SWITCH_CHOICES,
    labels: SWITCH_LABELS,
    model: rewardStems,
  },
]

/**
 * The dials in bands, each under its own heading.
 *
 * Thirteen dials in one list is a wall. Grouping them by the question they answer — how the supply
 * behaves, how big your drawer is, how stems are come by, how the finished board is added up — is what
 * makes the panel scannable, and it gives a new dial an obvious home.
 *
 * The first band has no heading: it sits directly under the panel's own title, which serves.
 */
interface DialSection {
  readonly key: string
  readonly title?: string
  readonly dials: readonly Dial[]
  /** A closing note under the band. */
  readonly note?: string
}

const SECTIONS: readonly DialSection[] = [
  { key: 'supply', dials: SUPPLY_DIALS },
  {
    key: 'passing',
    ...textOf('passing'),
    title: 'Passing',
    dials: PASSING_DIALS,
    note: 'Passing takes you out of the round, not out of the game. The first to go pays the fine and '
      + 'opens the next round.',
  },
  {
    key: 'solo',
    title: 'Playing alone',
    dials: SOLO_DIALS,
    note: 'Undo reaches back to the start of the round you are in, one turn at a time. The deck is '
      + 'put back as it was, so replaying the same turn deals the same tiles.',
  },
  { key: 'deck', title: 'Deck', dials: DECK_DIALS },
  { key: 'drawer', title: 'Drawer', dials: DRAWER_DIALS },
  { key: 'stems', title: 'Receiving stems', dials: STEM_DIALS },
  {
    key: 'anchorPoints',
    ...textOf('anchorPoints'),
    title: 'Round anchor points',
    dials: ANCHOR_POINT_DIALS,
    note: 'Counted at the end of every round, over the whole board, enclosed or not — so a plate keeps '
      + 'paying for as long as the game lasts.',
  },
  {
    key: 'final',
    ...textOf('final'),
    title: 'Final score',
    dials: FINAL_DIALS,
    note: 'A group scores the sum of its tiles\' values, and a bonus for its size on top. Six is as '
      + 'large as a group can get — no group may repeat a tile, and there are only six values and six '
      + 'colours.',
  },
]

/**
 * Every dial there is, hidden ones included.
 *
 * Not `visibleDials`: which dials are on screen depends on the others — the strict bonus disappears
 * under the strict rule, a bonus above the minimum group size goes out of reach — and a setup has to
 * carry those too. The code already takes care that a dial keeps its value while hidden, for exactly
 * the same reason.
 */
const ALL_DIALS: readonly Dial[] = SECTIONS.flatMap(section => section.dials)

/**
 * Where every dial started, captured before anything is restored over it.
 *
 * The refs were initialised from the `DEFAULT_*` constants a hundred lines above, so this is those
 * values without naming them a second time — a list that could fall out of step with the one that
 * matters.
 */
const DIAL_DEFAULTS = new Map(ALL_DIALS.map(dial => [dial.key, dial.model.value]))

/** What this screen is currently set to, in the form the next game will read it back from. */
function currentSetup(): SavedSetup {
  return {
    dials: Object.fromEntries(ALL_DIALS.map(dial => [dial.key, dial.model.value])),
    mode: mode.value,
    placementRule: placementRule.value,
    players: playerCount.value,
  }
}

/**
 * What a dial will accept *now*, which for one of them depends on the mode.
 *
 * `Dial.choices` is fixed when the module loads, before any mode is chosen, so for `platesPerRound` it
 * holds the classic range whatever mode is showing. Reading it directly is what broke the restore
 * below: a quick game's saved 12 failed a test against `[3, 4, 5, 6]` and was dropped on the floor.
 */
function choicesOf(dial: Dial): readonly number[] {
  return dial.key === 'platesPerRound' ? platesPerRoundChoices(mode.value) : dial.choices
}

/**
 * Open on the last game's setup rather than on the defaults.
 *
 * Every value is checked against the choices the dial that owns it still offers, so nothing here needs
 * to know what a dial means or be kept in step when one changes. A stored value a dial no longer
 * accepts is simply not applied, and that dial keeps its default.
 *
 * **The mode is restored before the dials, and that order is load-bearing.** It decides what the dials
 * below will accept, so restoring it afterwards tests every value against the wrong range — which is
 * how a saved quick game came back holding 12 plates, failed a test against the classic `[3, 4, 5, 6]`,
 * and opened on 4: a count its own dial does not offer, with nothing highlighted.
 *
 * The `watch` on the mode cannot cover for this. It is registered after this function has already run.
 */
function restoreSetup(): void {
  const saved = savedSetup()
  if (!saved) return

  if (SINGLEPLAYER_MODES.some(entry => entry.id === saved.mode)) {
    mode.value = saved.mode as SingleplayerMode
  }
  if (isPlacementRule(saved.placementRule)) placementRule.value = saved.placementRule
  if (saved.players !== undefined && PLAYER_COUNT_CHOICES.includes(saved.players)) {
    playerCount.value = saved.players
  }

  for (const dial of ALL_DIALS) {
    const value = saved.dials[dial.key]
    if (value !== undefined && choicesOf(dial).includes(value)) dial.model.value = value
  }

  /*
   * Whatever the stored setup could not supply falls to the mode's own default rather than to the
   * screen's. Only this dial can be left stranded — it is the only one whose range moves with the mode
   * — and `reconcilePlatesPerRound` is the same repair the parser makes to a stored game.
   */
  platesPerRound.value = reconcilePlatesPerRound(mode.value, platesPerRound.value)
}

/** Whether anything has been turned away from where it started. Drives the way back. */
const changedFromDefaults = computed(() =>
  ALL_DIALS.some(dial => dial.model.value !== DIAL_DEFAULTS.get(dial.key))
  || mode.value !== DEFAULT_SINGLEPLAYER_MODE
  || placementRule.value !== DEFAULT_PLACEMENT_RULE
  || playerCount.value !== DEFAULT_PLAYER_COUNT)

/** Put everything back, and stop remembering — otherwise the next visit undoes this one. */
function resetToDefaults(): void {
  for (const dial of ALL_DIALS) {
    const value = DIAL_DEFAULTS.get(dial.key)
    if (value !== undefined) dial.model.value = value
  }
  mode.value = DEFAULT_SINGLEPLAYER_MODE
  placementRule.value = DEFAULT_PLACEMENT_RULE
  playerCount.value = DEFAULT_PLAYER_COUNT
  forgetSetup()
}

restoreSetup()

/**
 * Bands with anything left to show, their hidden dials already dropped.
 *
 * Choices come from `choicesOf` rather than from the dial itself, because one of them moves with the
 * mode and `SECTIONS` is a module constant built before any mode is chosen. Over four rounds the
 * plates dial is one round's width and offers 3-6; in a one-round game it is the whole game's length
 * and offers 8-20.
 */
const visibleSections = computed(() => SECTIONS
  .map(section => ({
    ...section,
    dials: section.dials
      .filter(dial => dial.applies?.() ?? true)
      .map(dial => ({ ...dial, choices: choicesOf(dial), lock: dial.lockedTo?.() ?? null })),
  }))
  .filter(section => section.dials.length > 0))

/**
 * Move the plate count onto the new mode's range when the mode changes.
 *
 * Without it a classic game's 4 stays selected against a dial that starts at 8 — a choice the
 * player appears to have made and cannot see, and one the parser would then repair to something else
 * again. The nearest offered value keeps "I wanted few" or "I wanted many" across the switch.
 */
watch(mode, (next, previous) => {
  if (next === previous) return
  platesPerRound.value = nearestPlatesPerRound(next, platesPerRound.value)
})

const visibleDials = computed(() => visibleSections.value.flatMap(section => section.dials))

/** Every bonus still in reach, as one pill — a dozen of them would swamp the strip. */
const bonusSummary = computed(() => visibleDials.value
  .filter(dial => dial.minor)
  .map(dial => dial.model.value)
  .join(' · '))

const summaryDials = computed(() => visibleDials.value.filter(dial => !dial.minor))

/** Switches read as words in the strip too; a bare 1 beside "fine unplaced" says nothing. */
const pillValue = (dial: Dial): string =>
  dial.labels?.[dial.choices.indexOf(dial.model.value)] ?? String(dial.model.value)

const settingsOpen = ref(false)
const gear = ref<ComponentPublicInstance | null>(null)

const rulesOpen = ref(false)
const rulesButton = ref<ComponentPublicInstance | null>(null)

/**
 * Focus the underlying element of a `v-btn`.
 *
 * A ref on a component gives the instance, not the DOM node, so `.focus()` has to go through `$el` —
 * the one thing that changes when a native `<button>` becomes a Vuetify one.
 */
function focusButton(button: ComponentPublicInstance | null): void {
  ;(button?.$el as HTMLElement | undefined)?.focus()
}

/** Focus goes back to the button that opened it, as the settings flyout does. */
function closeRules(): void {
  rulesOpen.value = false
  void nextTick(() => focusButton(rulesButton.value))
}

/** Focus goes back where it came from, so closing the panel does not strand a keyboard at the top. */
function closeSettings(): void {
  settingsOpen.value = false
  void nextTick(() => focusButton(gear.value))
}

function chooseKind(id: GameKind): void {
  kind.value = id
  step.value = 'preset'
}

/**
 * Back one step, not back to the start.
 *
 * The preset screen is between the kinds and the dials, so the way out of the dials is the presets —
 * somebody who opened Custom to look and changed their mind wants the list they came from, not the
 * front door.
 */
function back(): void {
  if (step.value === 'setup') {
    step.value = 'preset'
    return
  }
  step.value = 'title'
  kind.value = null
}

/** True while the server is opening the table, so Start cannot be pressed twice. */
const starting = ref(false)
const startProblem = ref('')

/**
 * Open the table on the server, and go where it says.
 *
 * The **server** mints the game, its id and its seed; this only says what was chosen. That is the
 * whole difference from before, when a game was a localStorage entry and the id was minted here —
 * and it is what makes a game something another person can be handed a link to.
 *
 * Where to go is decided from the status that comes back rather than from the kind that went out. A
 * solo game is already `running`, because its only seat was claimed in the same request; a table is
 * `waiting`. Reading it off the answer means this screen has no opinion about which kinds have
 * lobbies, and the store would put a wrong guess right anyway (stores/game.ts).
 */
async function startGame(chosen?: GameSettings): Promise<void> {
  if (starting.value) return
  starting.value = true
  startProblem.value = ''

  const settings = chosen ?? settingsFromDials()

  try {
    const claim = await createGame(settings, name.value)
    /*
     * Remembered here, after the table exists — "the setup my last game ran with", not "the last
     * thing I fiddled with". A create that failed leaves the screen exactly as it was, so there is
     * nothing to recover and nothing worth writing down.
     */
    rememberSetup(currentSetup())
    // Before navigating: the store's first fetch must carry the token, or the creator arrives at
    // their own table as a spectator.
    rememberSeat(claim.game.id, { seat: claim.seat, token: claim.token })
    const path = claim.game.status === 'waiting' ? '/join' : '/game'
    await router.push({ path, query: { id: claim.game.id } })
  } catch (error) {
    startProblem.value = error instanceof ApiError ? error.message : 'Cannot reach the table.'
  } finally {
    starting.value = false
  }
}

/** How many are at the table, which a preset needs before it can say what it deals. */
const seats = computed(() => (kind.value === 'multiplayer' ? playerCount.value : SOLO))

/**
 * Start one of the named games.
 *
 * The preset supplies the rules and this supplies the people: `presetSettings` deliberately says
 * nothing about who is playing, so the name is added here exactly as the dialled path adds it.
 */
function startPreset(preset: GamePreset): void {
  void startGame({
    ...presetSettings(preset, seats.value),
    playerNames: [name.value],
  })
}

/**
 * The cards, with their numbers read off the settings they will actually deal.
 *
 * Derived rather than written down: a card claiming "5 plates/round" beside a preset that deals seven
 * is the one failure this screen can have that a player would not spot until the game was under way.
 */
const presetCards = computed(() => GAME_PRESETS.map((preset) => {
  const settings = presetSettings(preset, seats.value)
  const rounds = roundsOf(settings.mode)
  return {
    preset,
    summary: [
      `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`,
      `${settings.platesPerRound} ${rounds === 1 ? 'plates' : 'plates/round'}`,
      settings.placementRule === 'strict' ? 'strict' : 'regular',
    ].join(' · '),
  }
}))

/** Everything the dials say, for the custom path. */
function settingsFromDials(): GameSettings {
  const multiplayer = kind.value === 'multiplayer'
  const players = multiplayer ? playerCount.value : SOLO
  return {
    kind: multiplayer ? 'multiplayer' : 'singleplayer',
    players,
    // Seat 0 is whoever made the game. The rest name themselves as they join.
    playerNames: [name.value],
    mode: mode.value,
    platesPerRound: platesPerRound.value,
    tileCopies: tileCopies.value,
    plateCopies: plateCopies.value,
    tileSlots: tileSlots.value,
    plateSlots: plateSlots.value,
    initialStems: initialStems.value,
    stemsPerInternalAnchor: stemsPerInternalAnchor.value,
    stemsPerExternalAnchor: stemsPerExternalAnchor.value,
    strictEnclosureBonus: effectiveStrictBonus({
      placementRule: placementRule.value,
      strictEnclosureBonus: strictEnclosureBonus.value,
    }),
    pointsPerInternalAnchor: pointsPerInternalAnchor.value,
    pointsPerExternalAnchor: pointsPerExternalAnchor.value,
    firstPassFine: effectiveFirstPassFine({ players, firstPassFine: firstPassFine.value }),
    placementRule: placementRule.value,
    minGroupSize: minGroupSize.value,
    groupBonuses: groupBonuses.value,
    fineUnplaced: fineUnplaced.value === 1,
    rewardStems: rewardStems.value === 1,
    allowUndo: allowUndo.value === 1,
    createdAt: 0,
  }
}

/**
 * The board on screen, and the button to give focus back to when it closes.
 *
 * One panel serving three cards, so which card opened it has to be remembered — `focusButton` further
 * up handles a single button, and here there are three that look alike. The map is keyed by preset id
 * and holds only the icons; the card buttons are kept out of it by the `scores` flag.
 */
const scoresFor = ref<string | null>(null)
const scoresButtons = new Map<string, ComponentPublicInstance | null>()

function keepScoresButton(id: string, el: unknown, scores: boolean): void {
  if (!scores) return
  scoresButtons.set(id, (el ?? null) as ComponentPublicInstance | null)
}

function openScores(id: string): void {
  scoresFor.value = id
}

function closeScores(): void {
  const opened = scoresFor.value
  scoresFor.value = null
  if (opened) void nextTick(() => focusButton(scoresButtons.get(opened) ?? null))
}

const selectedMode = computed(() => modeInfo(mode.value))

/** What a screen reader is told the panel is, since all three steps share one card. */
const PANEL_LABELS: Readonly<Record<Step, string>> = {
  title: 'Main menu',
  preset: 'Choose a game',
  setup: 'Game setup',
}
</script>

<template>
  <main class="hx-menu">
    <div class="hx-menu__lockup">
      <h1 class="hx-lockup__name">
        hexnome
      </h1>
      <p class="hx-lockup__tagline">
        Build · Adapt · Evolve
      </p>
    </div>

    <div class="hx-menu__column">
      <v-card
        class="hx-panel"
        :aria-label="PANEL_LABELS[step]"
      >
        <!-- Step 1 -->
        <template v-if="step === 'title'">
          <!--
          Asked once, here, and kept. A name belongs to the person rather than to any one game, so it
          sits above the kinds rather than inside their settings — those are frozen against a game id.
          Optional: clear it and nothing insists.

          Stored on `change` rather than on every keystroke, so a half-typed name is not what gets
          remembered if the tab is closed mid-word.
        -->
          <v-text-field
            id="player-name"
            v-model="name"
            label="Your name"
            placeholder="Player"
            maxlength="40"
            @change="rememberName(name)"
          >
            <!--
            In the field's own slot rather than beside it. A button nested in a `<label>` is also a
            click on the label, which used to drag focus into the field it had just filled; the slot
            is inside the control but outside the label, so it does not.
          -->
            <template #append-inner>
              <v-tooltip
                text="Suggest another name"
                location="top"
              >
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    variant="text"
                    icon
                    rounded="md"
                    size="x-small"
                    aria-label="Suggest another name"
                    @click="reroll"
                  >
                    <v-icon
                      :icon="mdiDiceMultiple"
                      size="32"
                    />
                  </v-btn>
                </template>
              </v-tooltip>
            </template>
          </v-text-field>

          <v-divider />

          <fieldset class="hx-group hx-group--stack">
            <legend class="hx-group__legend">
              New game
            </legend>
            <v-btn
              v-for="entry in GAME_KINDS"
              :key="entry.id"
              block
              :disabled="!entry.available"
              class="hx-option"
              @click="chooseKind(entry.id)"
            >
              <span class="hx-option__label">{{ entry.label }}</span>
              <v-spacer />
              <v-chip
                v-if="!entry.available"
                size="small"
                variant="text"
                class="hx-option__note"
              >
                Soon
              </v-chip>
            </v-btn>
          </fieldset>

          <!--
          Below the kinds and quieter than them: it starts nothing, and somebody who came here to
          play should not have to read past it.
        -->
          <v-btn
            ref="rulesButton"
            :border="false"
            color="muted"
            class="hx-panel__rules"
            @click="rulesOpen = true"
          >
            Game rules
          </v-btn>
        </template>

        <!-- Step 2 -->
        <template v-else-if="step === 'preset'">
          <!--
          The table first, because a preset deals differently to two players than to four and the
          numbers on the cards below change as it moves. Absent when playing alone, where it would be
          a control with one setting.
        -->
          <fieldset
            v-if="kind === 'multiplayer'"
            class="hx-group"
          >
            <legend class="hx-group__legend">
              Players
            </legend>
            <v-btn-toggle
              v-model="playerCount"
              color="success"
              base-color="on-surface"
              variant="text"
              mandatory
              class="hx-choices"
            >
              <v-btn
                v-for="count in PLAYER_COUNT_CHOICES"
                :key="count"
                :value="count"
              >
                {{ count }}
              </v-btn>
            </v-btn-toggle>
          </fieldset>

          <fieldset class="hx-group hx-group--stack">
            <legend class="hx-group__legend">
              Game
            </legend>
            <!--
              A row rather than a button, because the scores button cannot live *inside* the card:
              a button nested in a button is not markup a browser will honour. The card keeps the
              whole width it had; the icon sits beside it.
            -->
            <div
              v-for="card in presetCards"
              :key="card.preset.id"
              class="hx-preset-row"
            >
              <v-btn
                :ref="el => keepScoresButton(card.preset.id, el, false)"
                :disabled="starting"
                class="hx-option hx-preset"
                @click="startPreset(card.preset)"
              >
                <span class="hx-preset__text">
                  <span class="hx-option__label">{{ card.preset.label }}</span>
                  <span class="hx-preset__note">{{ card.preset.note }}</span>
                  <span class="hx-preset__facts">{{ card.summary }}</span>
                </span>
              </v-btn>

              <v-tooltip
                :text="`High scores for ${card.preset.label}`"
                location="top"
              >
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    :ref="el => keepScoresButton(card.preset.id, el, true)"
                    :icon="mdiPodium"
                    :border="false"
                    variant="text"
                    class="hx-preset__scores"
                    :aria-label="`High scores for ${card.preset.label}`"
                    @click="openScores(card.preset.id)"
                  />
                </template>
              </v-tooltip>
            </div>

            <!--
            Not a preset, and deliberately not in the list above: the others deal a game, this one
            opens the dials. Kept in the same group so it reads as the last of the ways to start.
          -->
            <div class="hx-preset-row">
              <v-btn
                :disabled="starting"
                class="hx-option hx-preset"
                @click="step = 'setup'"
              >
                <span class="hx-preset__text">
                  <span class="hx-option__label">Custom</span>
                  <span class="hx-preset__note">Set every rule yourself.</span>
                  <span class="hx-preset__facts">{{ visibleDials.length }} settings</span>
                </span>
              </v-btn>
              <!--
                No board, and no button — a game nobody else played the same way cannot be compared
                with one. The gap is held open so the four cards still line up.
              -->
              <div class="hx-preset__scores hx-preset__scores--absent" />
            </div>
          </fieldset>

          <p
            v-if="startProblem"
            class="hx-panel__problem"
          >
            {{ startProblem }}
          </p>
        </template>

        <!-- Step 3 -->
        <template v-else>
          <!--
          First, because it is the biggest thing about a table and everything below reads differently
          once it is set. Absent for a solo game rather than shown as a fixed 1, which would be a
          control that cannot be used.
        -->
          <fieldset
            v-if="kind === 'multiplayer'"
            class="hx-group"
          >
            <legend class="hx-group__legend">
              Players
            </legend>
            <v-btn-toggle
              v-model="playerCount"
              color="success"
              base-color="on-surface"
              variant="text"
              mandatory
              class="hx-choices"
            >
              <v-btn
                v-for="count in PLAYER_COUNT_CHOICES"
                :key="count"
                :value="count"
              >
                {{ count }}
              </v-btn>
            </v-btn-toggle>
          </fieldset>

          <fieldset class="hx-group">
            <legend class="hx-group__legend">
              Mode
            </legend>
            <v-btn-toggle
              v-model="mode"
              color="success"
              base-color="on-surface"
              variant="text"
              mandatory
              class="hx-choices hx-choices--stacked"
            >
              <v-btn
                v-for="entry in SINGLEPLAYER_MODES"
                :key="entry.id"
                :value="entry.id"
                class="hx-option"
              >
                <span class="hx-option__label">{{ entry.label }}</span>
                <v-spacer />
                <span class="hx-option__note">
                  {{ entry.rounds }} {{ entry.rounds === 1 ? 'round' : 'rounds' }}
                </span>
              </v-btn>
            </v-btn-toggle>
            <p
              v-if="selectedMode?.description"
              class="hx-group__hint"
            >
              {{ selectedMode.description }}
            </p>
          </fieldset>

          <fieldset class="hx-group">
            <legend class="hx-group__legend">
              Placement
            </legend>
            <v-btn-toggle
              v-model="placementRule"
              color="success"
              base-color="on-surface"
              variant="text"
              mandatory
              class="hx-choices hx-choices--stacked"
            >
              <v-btn
                v-for="rule in PLACEMENT_RULES"
                :key="rule"
                :value="rule"
                class="hx-option"
              >
                <span class="hx-option__label">{{ PLACEMENT_RULE_LABELS[rule] }}</span>
                <v-spacer />
                <span class="hx-option__note">{{ PLACEMENT_RULE_HINTS[rule] }}</span>
              </v-btn>
            </v-btn-toggle>
            <p class="hx-group__hint">
              A tile with nothing beside it may go anywhere. Once it touches something, this decides how
              much of what it touches has to share its colour or its symbol.
            </p>
          </fieldset>

          <!--
          The rest of the dials, as a readout you can open.

          It states the values rather than saying "Advanced settings", so the common case — glancing to
          check what this game will be, then starting it — never needs the panel at all. The whole strip
          is the button: the gear says what it does, but a thin icon is a poor target for a row that is
          already the right shape to press.
        -->
          <v-btn
            ref="gear"
            block
            :append-icon="mdiCog"
            :aria-expanded="settingsOpen"
            aria-label="Game settings"
            class="hx-summary"
            @click="settingsOpen = true"
          >
            <span class="hx-summary__values">
              <span
                v-for="dial in summaryDials"
                :key="dial.key"
                class="hx-summary__pill"
              >
                <span class="hx-summary__label">{{ dial.short }}</span>
                <span class="hx-summary__value">{{ pillValue(dial) }}</span>
              </span>
              <span
                v-if="bonusSummary"
                class="hx-summary__pill"
              >
                <span class="hx-summary__label">group bonus</span>
                <span class="hx-summary__value">{{ bonusSummary }}</span>
              </span>
            </span>
          </v-btn>

          <v-btn
            block
            color="primary"
            :loading="starting"
            class="hx-panel__start"
            @click="startGame"
          >
            {{ starting ? 'Opening…' : 'Start game' }}
          </v-btn>

          <!-- The one failure this screen can have of its own: the table would not open. -->
          <v-alert
            v-if="startProblem"
            type="error"
            variant="tonal"
            density="compact"
            role="alert"
          >
            {{ startProblem }}
          </v-alert>
        </template>

        <v-btn
          v-if="step !== 'title'"
          :border="false"
          color="muted"
          class="hx-panel__back"
          @click="back"
        >
          Back
        </v-btn>
      </v-card>

      <!--
        A way back into a game already in progress.

        Its own thing below the panel, not another entry inside it: everything in there starts
        something, and this resumes. It appears only when there is a table to return to — the id is
        dropped the moment that game ends (composables/currentGame.ts).
      -->
      <v-btn
        v-if="unfinished && step === 'title'"
        block
        color="primary"
        class="hx-resume"
        :to="{ path: '/game', query: { id: unfinished } }"
      >
        Continue playing
      </v-btn>
    </div>

    <RulesPanel
      :open="rulesOpen"
      @close="closeRules"
    />

    <!--
      One panel for all three boards. It opens on the card that was pressed and on the table size the
      screen is set up for; its own toggles take it anywhere else.
    -->
    <HighscoresPanel
      :open="scoresFor !== null"
      :preset-id="scoresFor ?? ''"
      :players="seats"
      @close="closeScores"
    />

    <SettingsFlyout
      :open="settingsOpen"
      title="Game settings"
      @close="closeSettings"
    >
      <template
        v-for="section in visibleSections"
        :key="section.key"
      >
        <h3
          v-if="section.title"
          class="hx-section"
        >
          {{ section.title }}
        </h3>
        <div class="hx-dials">
          <fieldset
            v-for="dial in section.dials"
            :key="dial.key"
            class="hx-group"
          >
            <legend class="hx-group__legend">
              {{ dial.legend }}
            </legend>
            <v-btn-toggle
              :model-value="dial.lock ? dial.lock.value : dial.model.value"
              color="success"
              base-color="on-surface"
              variant="text"
              mandatory
              :disabled="!!dial.lock"
              class="hx-choices"
              :class="{ 'hx-choices--wide': dial.choices.length > 8 }"
              @update:model-value="value => { if (!dial.lock) dial.model.value = value as number }"
            >
              <v-btn
                v-for="(count, index) in dial.choices"
                :key="count"
                :value="count"
              >
                {{ dial.labels?.[index] ?? count }}
              </v-btn>
            </v-btn-toggle>
            <p
              v-if="dial.lock || dial.hint"
              class="hx-group__hint"
            >
              {{ dial.lock ? dial.lock.why : dial.hint }}
            </p>
          </fieldset>
        </div>
        <p
          v-if="section.note"
          class="hx-group__hint"
        >
          {{ section.note }}
        </p>
      </template>

      <!--
        The way back, and only when there is somewhere to go back to.

        A game remembers what it was started with, so this screen usually is not showing the defaults
        — and a tile bag reading 216 with no way to find out what it started as is worse than not
        remembering at all. Its presence is the signal that something has been changed; its absence
        says these are the defaults, which is why it goes in the footer rather than under thirteen
        sections of dials where a signal nobody scrolls to is no signal.
      -->
      <template #aside>
        <v-btn
          v-if="changedFromDefaults"
          color="muted"
          @click="resetToDefaults"
        >
          Reset to defaults
        </v-btn>
      </template>
    </SettingsFlyout>
  </main>
</template>

<!--
  Not `scoped`, on purpose. A scoped style adds a `[data-v-…]` attribute to every selector, which
  raises its specificity — and specificity is the thing cascade layers exist to stop mattering. In
  the `components` layer a plain `.hx-option` already beats Vuetify's `.v-btn.v-btn--density-default`
  without help. See styles/layers.scss.

  What is left here is layout and the two pieces of typography that carry the game's identity: the
  display lockup, and the uppercase tracking on legends and option labels. Colour, borders, radius,
  elevation and control sizing all come from the theme and the component defaults now.
-->
<style lang="scss">
@use '@/styles/mixins.import' as *;

@layer components {
  .hx-menu {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 32px;
    align-items: center;
    justify-content: center;
    height: 100%;
    max-width: 1016px;
    /* 32px of breathing room, the same inset the other full-page screens use. */
    padding: 32px;
    margin: 0 auto;
  }

  @media (width <= 760px) {
    .hx-menu {
      grid-template-columns: minmax(0, 1fr);
      align-content: center;
    }
  }

  /*
   * The game lockup: display type, and the one place that opts out of the type scale.
   *
   * It declines the base **line height** as well as the size. That line height is absolute (1.5rem)
   * so it does not grow with the font — inheriting it put 52px capitals in a 24px box and pulled the
   * tagline up under them. An exception is only an exception if it declines both.
   */
  .hx-lockup__name {
    margin: 0;
    color: rgb(var(--v-theme-primary));
    font-weight: 600;
    font-size: clamp(34px, 6vw, 52px);
    line-height: normal;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .hx-lockup__tagline {
    margin: 6px 0 0;
    color: rgb(var(--v-theme-muted-dim));
    letter-spacing: 0.32em;
    text-transform: uppercase;
  }

  /* The step's card. Only the stacking is ours; the surface, edge and radius are the `v-card`. */
  .hx-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }

  /* The panel and whatever sits under it, as one column of the menu's grid. */
  .hx-menu__column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .hx-panel__rules {
    align-self: center;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .hx-panel__back {
    align-self: flex-start;
  }

  .hx-panel__start {
    margin-top: 4px;
  }

  .hx-group {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .hx-group + .hx-group {
    margin-top: 4px;
  }

  /* A column of full-width options, rather than buttons sitting edge to edge. */
  .hx-group--stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /*
   * Legends and option labels carry the uppercase tracking the whole game is set in. This is the
   * signature, not decoration — it is why a panel reads as this game and not as a settings dialog.
   */
  .hx-group__legend {
    padding: 0 0 8px;
    color: rgb(var(--v-theme-muted-dim));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .hx-group__hint {
    margin: 8px 0 0;
    color: rgb(var(--v-theme-muted));
  }

  /* Tracking only: the uppercase comes from the button, for every button, in the settings. */
  .hx-option__label {
    letter-spacing: 0.08em;
  }

  /*
   * Wider tracking than the button's, so a note reads as an aside to the label beside it.
   *
   * **The uppercase here is not redundant**, even though every button now carries it. This class is
   * also on the "Soon" chip, and `v-chip` declares `text-transform: none` — so the chip would drop
   * out of the button's casing on its own. Saying it here wins from the `components` layer without
   * having to out-specify anything.
   */
  .hx-option__note {
    color: rgb(var(--v-theme-muted-dim));
    letter-spacing: 0.16em;
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    text-transform: uppercase;
    white-space: nowrap;
  }

  /*
   * A fixed grid, not the toggle's own flex row.
   *
   * `v-btn-toggle` lays its buttons out in a row and lets them size to their content, which is what
   * the hand-written version did too — and it was wrong for the same reason: the two-choice dials
   * rendered as two slabs twice the size of the four-choice dials above them, drawing the smallest
   * decision on the panel as the biggest control. On a grid a choice is the same size everywhere, a
   * short row simply stops early, and a long one wraps at that same size.
   *
   * This is the layer architecture earning its keep: `.hx-choices` is one class (0,1,0) and it beats
   * `.v-btn-group` outright, with no `:deep()` and no `!important`.
   */
  .hx-choices {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    height: auto;
    border: 0;
    /*
     * `v-btn-group` sets `overflow-x: auto; overflow-y: hidden` so a long strip of segments can be
     * swiped. Ours is a grid that wraps, so there is nothing to swipe and the hidden axis only
     * clipped the buttons' own edges.
     */
    overflow: visible;

    /*
     * **Put the borders back.** A button group deliberately strips them: `:not(:last-child)` loses
     * its inline-end and `:not(:first-child)` its inline-start, so the segments read as one control
     * with seams rather than as several with edges. Measured on the middle button, that leaves
     * `1px/0/1px/0`.
     *
     * On a grid there are no seams — every cell is a separate control with a gap around it — so each
     * one needs all four sides and its own radius back.
     */
    .v-btn {
      height: auto;
      min-height: 40px;
      border-radius: $v-border-radius-root;
      border: $v-border-width-root solid rgba(var(--v-border-color), var(--v-border-opacity));
      font-variant-numeric: tabular-nums;
      opacity: 1;
    }

    /*
     * The chosen one wears its own colour on its edge as well as its text — mint, the same the board
     * uses for "this is the target". `currentColor` rather than naming it again: the component has
     * already worked out what `color="success"` means here, and a second copy could disagree with it.
     */
    .v-btn--active {
      border-color: currentcolor;
    }
  }

  /* Ten choices sit as two rows of five; at four columns they would come out 4 + 4 + 2. */
  /*
   * Five columns, for the one dial long enough to want them.
   *
   * The threshold is 8 rather than 4 because five columns only helps a count that divides by five:
   * the group bonuses are ten and fall into 5 + 5, while the plate counts are seven and would fall
   * into a lopsided 5 + 2. At the default four columns those seven are 4 + 3, which is the shape the
   * range was chosen for.
   */
  .hx-choices--wide {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  /* Full-width options, one per row, rather than side by side. */
  .hx-choices--stacked {
    grid-template-columns: minmax(0, 1fr);
  }

  /*
   * Options are read left to right — label, then what it costs you — so they fill the row.
   *
   * `.v-btn__content` needs the width said out loud: it is an inline-flex that shrinks to its text,
   * so a `v-spacer` inside it has nothing to grow into and the label and its note end up jammed
   * together ("CLASSIC4 ROUNDS"). Giving the content the full width is what lets the spacer work.
   */
  .hx-option {
    justify-content: flex-start;
    min-height: 44px;
    padding-inline: 14px;
    text-align: left;

    .v-btn__content {
      width: 100%;
    }
  }

  /*
   * A preset card is three stacked lines: what it is called, why you would pick it, and what it
   * deals.
   *
   * **Stacked rather than name-left, numbers-right.** That was the first arrangement and the panel is
   * 460px wide: the numbers ran off the edge and the reason for picking it was squeezed into a column
   * four lines tall beside them. Down the card each line gets the full width, and the flavour fits on
   * one line where it belongs.
   *
   * `height: auto` because a `v-btn` is a fixed height by default, and the lines below the first
   * would otherwise spill out of it.
   */
  /*
   * The card and its scores button, side by side. `min-width: 0` on the card because a long note
   * would otherwise refuse to wrap and push the icon off the panel.
   */
  .hx-preset-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .hx-preset-row > .hx-preset {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Held open on the Custom row, which has no board, so all four cards still line up. */
  .hx-preset__scores {
    flex: none;
    align-self: center;
    width: 44px;
  }

  .hx-preset {
    height: auto;
    min-height: 64px;
    padding-block: 10px;

    /*
     * `.hx-option` puts `justify-content: flex-start` on the *button*, which was enough while a
     * `v-spacer` held the two halves apart. With one child left it is the content box that decides,
     * and its default is `center` — so every card sat centred on its own longest line, and the three
     * labels started at three different x positions.
     */
    .v-btn__content {
      justify-content: flex-start;
    }
  }

  /* Facts, under the flavour: rounds, plates and the placement rule this card will actually deal. */
  .hx-preset__facts {
    color: rgb(var(--v-theme-muted));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .hx-preset__text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    text-align: left;
  }

  .hx-preset__note {
    color: rgb(var(--v-theme-muted-dim));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    letter-spacing: normal;
    text-transform: none;
    white-space: normal;
  }

  /*
   * Quieter than an option: it is not one of the choices, it is a report on the ones already made.
   * Dashed, so it reads as a summary that can be opened rather than a button that does something.
   */
  .hx-summary {
    height: auto;
    min-height: 44px;
    padding-block: 10px;
    border-style: dashed;
    text-align: left;
  }

  .hx-summary__values {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  /* Label then value, so the column of numbers stays scannable however the row wraps. */
  .hx-summary__pill {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    white-space: nowrap;
  }

  .hx-summary__label {
    color: rgb(var(--v-theme-muted-dim));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
  }

  .hx-summary__value {
    font-variant-numeric: tabular-nums;
  }

  /* A rule across the flyout, so the second half reads as a different question rather than more dials. */
  .hx-section {
    margin: 22px 0 14px;
    padding-top: 16px;
    border-top: $v-border-width-root solid rgb(var(--v-theme-border-brass));
    color: rgb(var(--v-theme-primary));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    font-weight: 600;
    text-transform: uppercase;
  }

  /* Dials sit closer together than the menu's own groups, being a list of one kind of thing. */
  .hx-dials .hx-group + .hx-group {
    margin-top: 16px;
  }
}
</style>
