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
import { mdiCog, mdiDiceMultiple } from '@mdi/js'
import HintTip from '@/ui/HintTip.vue'
import { computed, nextTick, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_PLAYER_COUNT,
  DEFAULT_SINGLEPLAYER_MODE,
  GAME_KINDS,
  PLAYER_COUNT_CHOICES,
  SOLO,
  PLATES_PER_ROUND_CHOICES,
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
  PLACEMENT_RULE_HINTS,
  PLACEMENT_RULE_LABELS,
  modeInfo,
  type GameKind,
  type SingleplayerMode,
} from '@hexnome/rules/gameSettings'
import {
  DEFAULT_PLACEMENT_RULE,
  isPlacementRule,
  PLACEMENT_RULES,
  type PlacementRule,
} from '@hexnome/rules/placement'
import RulesPanel from '@/ui/RulesPanel.vue'
import { bonusKey, textOf } from '@/ui/dialText'
import SettingsFlyout from '@/ui/SettingsFlyout.vue'
import { ApiError, createGame } from '@/api/games'
import { playerName, rememberName, suggestName } from '@/composables/playerName'
import { forgetSetup, rememberSetup, savedSetup, type SavedSetup } from '@/composables/savedSetup'
import { rememberSeat } from '@/composables/useSeat'

type Step = 'title' | 'setup'

/** A yes/no dial, as the numbers the dial machinery expects and the words a player should read. */
const SWITCH_CHOICES: readonly number[] = [0, 1]
const SWITCH_LABELS: readonly string[] = ['No', 'Yes']

const router = useRouter()

/** Read once on mount, so the field arrives filled rather than empty and then populated. */
const name = ref(playerName())

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
  /** False hides the dial entirely — see the strict bonus. */
  readonly applies?: () => boolean
  /** Omitted from the readout strip, which would otherwise run to a dozen pills. */
  readonly minor?: boolean
}

const SUPPLY_DIALS: readonly Dial[] = [
  {
    key: 'platesPerRound',
    ...textOf('platesPerRound'),
    choices: PLATES_PER_ROUND_CHOICES,
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
     * Hidden rather than disabled under strict placement, because a disabled control invites the
     * question "why can I not have this?" when the honest answer is that strict placement already gives
     * it to you every time. The chosen value is kept while hidden, so switching to strict and back does
     * not silently reset it.
     */
    applies: () => placementRule.value !== 'strict',
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
 * Open on the last game's setup rather than on the defaults.
 *
 * Every value is checked against the list of choices the dial that owns it still offers, so nothing
 * here needs to know what a dial means or be kept in step when one changes. A stored value a dial no
 * longer accepts is simply not applied, and that dial keeps its default.
 */
function restoreSetup(): void {
  const saved = savedSetup()
  if (!saved) return

  for (const dial of ALL_DIALS) {
    const value = saved.dials[dial.key]
    if (value !== undefined && dial.choices.includes(value)) dial.model.value = value
  }
  if (SINGLEPLAYER_MODES.some(entry => entry.id === saved.mode)) {
    mode.value = saved.mode as SingleplayerMode
  }
  if (isPlacementRule(saved.placementRule)) placementRule.value = saved.placementRule
  if (saved.players !== undefined && PLAYER_COUNT_CHOICES.includes(saved.players)) {
    playerCount.value = saved.players
  }
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

/** Bands with anything left to show, their hidden dials already dropped. */
const visibleSections = computed(() => SECTIONS
  .map(section => ({ ...section, dials: section.dials.filter(dial => dial.applies?.() ?? true) }))
  .filter(section => section.dials.length > 0))

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
const gear = ref<HTMLButtonElement | null>(null)

const rulesOpen = ref(false)
const rulesButton = ref<HTMLButtonElement | null>(null)

/** Focus goes back to the button that opened it, as the settings flyout does. */
function closeRules(): void {
  rulesOpen.value = false
  void nextTick(() => rulesButton.value?.focus())
}

/** Focus goes back where it came from, so closing the panel does not strand a keyboard at the top. */
function closeSettings(): void {
  settingsOpen.value = false
  void nextTick(() => gear.value?.focus())
}

function chooseKind(id: GameKind): void {
  kind.value = id
  step.value = 'setup'
}

function back(): void {
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
async function startGame(): Promise<void> {
  if (starting.value) return
  starting.value = true
  startProblem.value = ''

  const multiplayer = kind.value === 'multiplayer'
  const players = multiplayer ? playerCount.value : SOLO
  const settings = {
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

const selectedMode = computed(() => modeInfo(mode.value))
</script>

<template>
  <main class="menu">
    <div class="lockup">
      <h1>hexnome</h1>
      <p class="tagline">
        Build · Adapt · Evolve
      </p>
    </div>

    <section
      class="panel"
      :aria-label="step === 'title' ? 'Main menu' : 'Game setup'"
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
        <div class="who">
          <label
            class="who-label"
            for="player-name"
          >Your name</label>
          <input
            id="player-name"
            v-model="name"
            type="text"
            maxlength="40"
            placeholder="Player"
            @change="rememberName(name)"
          >
          <!--
            Deliberately outside the label: a button nested in one is also a click on the label, so
            every reroll would drag focus into the field it just filled.
          -->
          <HintTip text="Suggest another name">
            <button
              type="button"
              class="reroll"
              aria-label="Suggest another name"
              @click="reroll"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="mdiDiceMultiple" />
              </svg>
            </button>
          </HintTip>
        </div>

        <fieldset class="group kinds">
          <legend>New game</legend>
          <button
            v-for="entry in GAME_KINDS"
            :key="entry.id"
            type="button"
            class="option"
            :disabled="!entry.available"
            @click="chooseKind(entry.id)"
          >
            <span class="option-label">{{ entry.label }}</span>
            <span
              v-if="!entry.available"
              class="soon"
            >Soon</span>
          </button>
        </fieldset>

        <!--
          Below the kinds and quieter than them: it starts nothing, and somebody who came here to
          play should not have to read past it.
        -->
        <button
          ref="rulesButton"
          type="button"
          class="rules-link"
          @click="rulesOpen = true"
        >
          Game rules
        </button>
      </template>

      <!-- Step 2 -->
      <template v-else>
        <!--
          First, because it is the biggest thing about a table and everything below reads differently
          once it is set. Absent for a solo game rather than shown as a fixed 1, which would be a
          control that cannot be used.
        -->
        <fieldset
          v-if="kind === 'multiplayer'"
          class="group"
        >
          <legend>Players</legend>
          <div class="counts">
            <button
              v-for="count in PLAYER_COUNT_CHOICES"
              :key="count"
              type="button"
              class="count"
              :class="{ chosen: playerCount === count }"
              :aria-pressed="playerCount === count"
              @click="playerCount = count"
            >
              {{ count }}
            </button>
          </div>
        </fieldset>

        <fieldset class="group">
          <legend>Mode</legend>
          <button
            v-for="entry in SINGLEPLAYER_MODES"
            :key="entry.id"
            type="button"
            class="option"
            :class="{ chosen: mode === entry.id }"
            :aria-pressed="mode === entry.id"
            @click="mode = entry.id"
          >
            <span class="option-label">{{ entry.label }}</span>
            <span class="rounds">{{ entry.rounds }} rounds</span>
          </button>
          <p
            v-if="selectedMode?.description"
            class="description"
          >
            {{ selectedMode.description }}
          </p>
        </fieldset>

        <fieldset class="group">
          <legend>Placement</legend>
          <button
            v-for="rule in PLACEMENT_RULES"
            :key="rule"
            type="button"
            class="option"
            :class="{ chosen: placementRule === rule }"
            :aria-pressed="placementRule === rule"
            @click="placementRule = rule"
          >
            <span class="option-label">{{ PLACEMENT_RULE_LABELS[rule] }}</span>
            <span class="rounds">{{ PLACEMENT_RULE_HINTS[rule] }}</span>
          </button>
          <p class="description">
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
        <button
          ref="gear"
          type="button"
          class="settings"
          :aria-expanded="settingsOpen"
          aria-label="Game settings"
          @click="settingsOpen = true"
        >
          <span class="settings-values">
            <span
              v-for="dial in summaryDials"
              :key="dial.key"
              class="pill"
            >
              <span class="pill-label">{{ dial.short }}</span>
              <span class="pill-value">{{ pillValue(dial) }}</span>
            </span>
            <span
              v-if="bonusSummary"
              class="pill"
            >
              <span class="pill-label">group bonus</span>
              <span class="pill-value">{{ bonusSummary }}</span>
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path :d="mdiCog" />
          </svg>
        </button>

        <button
          type="button"
          class="option start"
          :disabled="starting"
          @click="startGame"
        >
          <span class="option-label">{{ starting ? 'Opening…' : 'Start game' }}</span>
        </button>

        <!-- The one failure this screen can have of its own: the table would not open. -->
        <p
          v-if="startProblem"
          class="problem"
          role="alert"
        >
          {{ startProblem }}
        </p>
      </template>

      <button
        v-if="step !== 'title'"
        type="button"
        class="back"
        @click="back"
      >
        Back
      </button>
    </section>

    <RulesPanel
      :open="rulesOpen"
      @close="closeRules"
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
          class="section"
        >
          {{ section.title }}
        </h3>
        <div class="dials">
          <fieldset
            v-for="dial in section.dials"
            :key="dial.key"
            class="group"
          >
            <legend>{{ dial.legend }}</legend>
            <div
              class="counts"
              :class="{ wide: dial.choices.length > 4 }"
            >
              <button
                v-for="(count, index) in dial.choices"
                :key="count"
                type="button"
                class="count"
                :class="{ chosen: dial.model.value === count }"
                :aria-pressed="dial.model.value === count"
                @click="dial.model.value = count"
              >
                {{ dial.labels?.[index] ?? count }}
              </button>
            </div>
            <p
              v-if="dial.hint"
              class="description"
            >
              {{ dial.hint }}
            </p>
          </fieldset>
        </div>
        <p
          v-if="section.note"
          class="description"
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
        <button
          v-if="changedFromDefaults"
          type="button"
          class="reset"
          @click="resetToDefaults"
        >
          Reset to defaults
        </button>
      </template>
    </SettingsFlyout>
  </main>
</template>

<style scoped>
/* Quieter than anything that starts a game: undoing is allowed, not encouraged. */
/* A way out of the menu, not another way in: underlined text rather than another framed option. */
.rules-link {
  justify-self: center;
  margin-top: 4px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: #79808f;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  transition: color 140ms;
}

.rules-link:hover {
  color: #e8c878;
}

.rules-link:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .rules-link {
    transition: none;
  }
}

.reset {
  flex: 0 0 auto;
  padding: 9px 14px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.reset:hover {
  border-color: #7d6a41;
  color: #e8c878;
}

.reset:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .reset {
    transition: none;
  }
}

.menu {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 32px;
  align-items: center;
  justify-content: center;
  height: 100%;
  max-width: 952px;
  margin: 0 auto;
}

@media (width <= 760px) {
  .menu {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    align-content: center;
  }
}

/* ── title lockup ──────────────────────────────────────────────────────────── */

h1 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  /*
   * The game lockup: display type, outside the text scale in styles/main.css.
   *
   * It has to opt out of the base **line height** as well as the size. That line height is absolute
   * (1.5rem), so it does not grow with the font — inheriting it put 52px capitals in a 24px box and
   * pulled the tagline up under them. An exception is only an exception if it declines both.
   */
  font-size: clamp(34px, 6vw, 52px);
  line-height: normal;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.tagline {
  margin: 6px 0 0;
  color: #6b7382;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

/* ── the current step ──────────────────────────────────────────────────────── */

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px;
  border: 1px solid #3a3222;
  border-radius: 4px;
  background: rgb(21 23 28 / 82%);
  box-shadow: 0 2px 24px rgb(0 0 0 / 45%);
}

.group {
  margin: 0;
  padding: 0;
  border: 0;
}

.group + .group {
  margin-top: 10px;
}

legend {
  padding: 0 0 8px;
  color: #6b7382;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.option {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #cfd4de;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, color 140ms;
}

.group .option + .option {
  margin-top: 8px;
}

.option-label {
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.option:hover:not(:disabled) {
  border-color: #7d6a41;
  background: rgb(232 200 120 / 7%);
  color: #e8c878;
}

.option:disabled {
  border-color: #24272d;
  color: #575d68;
  cursor: not-allowed;
}

/* Reuses the mint the board already uses to mean "this is the target". */
.option.chosen,
.count.chosen {
  border-color: #8fe6c0;
  background: rgb(143 230 192 / 8%);
  color: #8fe6c0;
}

.problem {
  margin: 8px 0 0;
  color: #d98b74;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.option.start {
  margin-top: 14px;
  justify-content: center;
  border-color: #7d6a41;
  color: #e8c878;
}

.option.start:hover {
  background: rgb(232 200 120 / 14%);
}

.rounds,
.soon {
  color: #6b7382;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
}

.description {
  margin: 10px 0 0;
  color: #79808f;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

/*
 * A fixed four-column grid, not a flex row.
 *
 * Flex made every dial's buttons fill the width, so the two-choice strict bonus rendered as two slabs
 * twice the size of the four-choice dials above it — the smallest decision on the panel drawn as the
 * biggest control. On a grid a choice is the same size everywhere, a short row simply stops early, and
 * a dial with more than four choices wraps onto a second line at that same size.
 */
.counts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

/* Ten choices sit as two rows of five; at four columns they would come out 4 + 4 + 2. */
.counts.wide {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.count {
  padding: 11px 0;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #cfd4de;
  font: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, color 140ms;
}

.count:hover:not(.chosen) {
  border-color: #7d6a41;
  color: #e8c878;
}

/* A rule across the flyout, so the second half reads as a different question rather than more dials. */
.section {
  margin: 22px 0 14px;
  padding-top: 16px;
  border-top: 1px solid #3a3222;
  color: #e8c878;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
  font-weight: 600;
  text-transform: uppercase;
}

/* Dials sit closer together than the menu's own groups, being a list of one kind of thing. */
.dials .group + .group {
  margin-top: 16px;
}

/* ── the settings readout ──────────────────────────────────────────────────── */

/*
 * Quieter than an `.option`: it is not one of the choices, it is a report on the ones already made.
 * Dashed, so it reads as a summary that can be opened rather than a button that does something.
 */
.settings {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed #33383f;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.settings:hover {
  border-color: #7d6a41;
  color: #e8c878;
}

.settings svg {
  flex: none;
  width: 17px;
  height: 17px;
  fill: currentcolor;
}

.settings-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

/* Label then value, so the column of numbers stays scannable however the row wraps. */
.pill {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
}

.pill-label {
  color: #6b7382;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
  text-transform: uppercase;
}

.pill-value {
  color: #cfd4de;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  font-variant-numeric: tabular-nums;
}

.settings:hover .pill-value {
  color: #e8c878;
}

/* ── who you are ───────────────────────────────────────────────────────────── */

/*
 * The rule sits under the name row rather than over the kinds below it, which is a fieldset: a
 * legend cuts its own border, so the same line drawn there would start halfway across the panel.
 */
.who {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid #22252b;
}

.kinds {
  margin-top: 14px;
}

.who-label {
  color: #6b7382;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  white-space: nowrap;
}

.who input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: #1b1e24;
  color: #cfd4de;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.who input::placeholder {
  color: #575d68;
}

.who input:focus-visible {
  border-color: #7d6a41;
  outline: none;
}

/* Square, and the same height as the field, so the row reads as one control with a handle on it. */
.reroll {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 33px;
  height: 33px;
  padding: 0;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #6b7382;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.reroll:hover {
  border-color: #7d6a41;
  color: #e8c878;
}

.reroll svg {
  width: 16px;
  height: 16px;
  fill: currentcolor;
  /* The die tumbles a sixth of a turn on press — the shortest way to say "that did something". */
  transition: transform 220ms ease-out;
}

.reroll:active svg {
  transform: rotate(60deg);
}

@media (prefers-reduced-motion: reduce) {
  .reroll svg {
    transition: none;
  }
}

.back {
  align-self: flex-start;
  margin-top: 6px;
  padding: 6px 0;
  border: 0;
  background: none;
  color: #6b7382;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
  cursor: pointer;
}

.back:hover {
  color: #e8c878;
}

:is(.option, .count, .back, .settings, .reroll):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  :is(.option, .count, .settings) {
    transition: none;
  }
}
</style>
