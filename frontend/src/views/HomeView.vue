<script setup lang="ts">
/**
 * The main menu: who you are, which game, then how it is set up.
 *
 * Two steps. There was a third — a title screen offering "New game" and "Settings" — and it is
 * gone: there are no application settings to reach, so it was one press that only ever led to the
 * same place. The kinds now stand on the first screen, which is also what makes the shape of the
 * game legible on arrival.
 *
 * The path taken stays on screen beside the panel. Drilling down is genuinely a sequence here — you
 * cannot pick a mode before picking singleplayer — so the trail carries real information rather than
 * decorating the page.
 *
 * Kinds that are not playable yet are shown and disabled rather than hidden, for the same reason.
 *
 * Starting a game mints an id, stores its settings against it, and navigates to `/game?id=…` —
 * which is what lets a refresh come back as the same game (composables/useSavedGames.ts).
 */
import { mdiCog, mdiDiceMultiple } from '@mdi/js'
import { computed, nextTick, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_SINGLEPLAYER_MODE,
  GAME_KINDS,
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
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  STRICT_BONUS_CHOICES,
  GROUP_BONUS_CHOICES,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE_CHOICES,
  DEFAULT_FINE_UNPLACED,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_REWARD_STEMS,
  effectiveGroupBonuses,
  effectiveStrictBonus,
  PLACEMENT_RULE_HINTS,
  PLACEMENT_RULE_LABELS,
  modeInfo,
  type GameKind,
  type SingleplayerMode,
} from '@hexnome/rules/gameSettings'
import {
  DEFAULT_PLACEMENT_RULE,
  PLACEMENT_RULES,
  type PlacementRule,
} from '@hexnome/rules/placement'
import SettingsFlyout from '@/ui/SettingsFlyout.vue'
import { createGameId } from '@/composables/createGameId'
import { playerName, rememberName, suggestName } from '@/composables/playerName'
import { useSavedGames } from '@/composables/useSavedGames'

type Step = 'title' | 'singleplayer'

/** A yes/no dial, as the numbers the dial machinery expects and the words a player should read. */
const SWITCH_CHOICES: readonly number[] = [0, 1]
const SWITCH_LABELS: readonly string[] = ['No', 'Yes']

const router = useRouter()
const savedGames = useSavedGames()

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

const placementRule = ref<PlacementRule>(DEFAULT_PLACEMENT_RULE)

const minGroupSize = ref<number>(DEFAULT_MIN_GROUP_SIZE)

/*
 * Switches, held as 0/1 so they can share the dial machinery with everything else, and rendered as
 * No/Yes rather than as bare digits.
 */
const fineUnplaced = ref<number>(DEFAULT_FINE_UNPLACED ? 1 : 0)
const rewardStems = ref<number>(DEFAULT_REWARD_STEMS ? 1 : 0)

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
    legend: 'Plates per round',
    short: 'plates/round',
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
    legend: 'Tiles in the bag',
    short: 'tile bag',
    choices: TILE_COPIES_CHOICES,
    labels: TILE_BAG_LABELS,
    model: tileCopies,
    hint: 'Two, three or four copies of each of the 36 distinct tiles. More copies means duplicates '
      + 'turn up together more often, so a colour is easier to sweep in one draft.',
  },
  {
    key: 'plateCopies',
    legend: 'Plates in the bag',
    short: 'plate bag',
    choices: PLATE_COPIES_CHOICES,
    labels: PLATE_BAG_LABELS,
    model: plateCopies,
    hint: 'One, two or three per distinct tile. A four-round game draws sixteen, so beyond the first '
      + 'copy the bag never runs dry and nothing you spend comes back around.',
  },
]

const DRAWER_DIALS: readonly Dial[] = [
  {
    key: 'tileSlots',
    legend: 'Tile slots in your drawer',
    short: 'tile slots',
    choices: TILE_SLOT_CHOICES,
    model: tileSlots,
    hint: 'Room to hold tiles you cannot place yet — and stems take these slots too, so a large '
      + 'opening allowance eats into it.',
  },
  {
    key: 'plateSlots',
    legend: 'Plate bays in your drawer',
    short: 'plate bays',
    choices: PLATE_SLOT_CHOICES,
    model: plateSlots,
    hint: 'How many plates you can hold before committing one to the board.',
  },
]

const STEM_DIALS: readonly Dial[] = [
  {
    key: 'initialStems',
    legend: 'Initial stems on game start',
    short: 'starting stems',
    choices: STEM_COUNT_CHOICES,
    model: initialStems,
  },
  {
    key: 'stemsPerInternalAnchor',
    legend: 'Stems per enclosed internal anchor',
    short: 'internal anchor',
    choices: STEMS_PER_ANCHOR_CHOICES,
    model: stemsPerInternalAnchor,
  },
  {
    key: 'stemsPerExternalAnchor',
    legend: 'Stems per enclosed external anchor',
    short: 'external anchor',
    choices: STEMS_PER_ANCHOR_CHOICES,
    model: stemsPerExternalAnchor,
  },
  {
    key: 'strictEnclosureBonus',
    legend: 'Stem bonus for strict enclosure',
    short: 'strict bonus',
    choices: STRICT_BONUS_CHOICES,
    model: strictEnclosureBonus,
    hint: 'Extra stems when every neighbouring pair around an enclosed anchor matches. Strict placement '
      + 'guarantees that already, so the bonus only exists under the regular rule.',
    /*
     * Hidden rather than disabled under strict placement, because a disabled control invites the
     * question "why can I not have this?" when the honest answer is that strict placement already gives
     * it to you every time. The chosen value is kept while hidden, so switching to strict and back does
     * not silently reset it.
     */
    applies: () => placementRule.value !== 'strict',
  },
]

const FINAL_DIALS: readonly Dial[] = [
  {
    key: 'minGroupSize',
    legend: 'Smallest group that scores',
    short: 'min group',
    choices: MIN_GROUP_SIZE_CHOICES,
    model: minGroupSize,
    hint: 'Connected tiles of one colour, or of one value. The single biggest lever on the endgame: '
      + 'at 2 almost anything pays, at 4 only deliberate building does.',
  },
  ...Array.from({ length: MAX_GROUP_SIZE - 1 }, (_, index): Dial => {
    const size = index + 2
    return {
      key: `bonus${size}`,
      legend: `Bonus for a group of ${size}`,
      short: `bonus ${size}`,
      choices: GROUP_BONUS_CHOICES,
      model: bonusBySize[size] as Ref<number>,
      minor: true,
      // Nothing is paid at or below the minimum: that size is the baseline, not an achievement.
      applies: () => size > minGroupSize.value,
    }
  }),
  {
    key: 'fineUnplaced',
    legend: 'Fine for tiles left unplaced',
    short: 'fine unplaced',
    choices: SWITCH_CHOICES,
    labels: SWITCH_LABELS,
    model: fineUnplaced,
    hint: 'At the very end, everything still in your drawer is charged at its face value — a plate '
      + 'through its own tile. Tiles carry between rounds freely; this settles once, for the whole '
      + 'game, so a six you never placed is an expensive thing to have hoarded.',
  },
  {
    key: 'rewardStems',
    legend: 'Bonus for stems left over',
    short: 'stem bonus',
    choices: SWITCH_CHOICES,
    labels: SWITCH_LABELS,
    model: rewardStems,
    hint: 'A point for each stem still held when the game ends — the mirror of the fine, so spending '
      + 'a stem you did not need is a real choice.',
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
  { key: 'deck', title: 'Deck', dials: DECK_DIALS },
  { key: 'drawer', title: 'Drawer', dials: DRAWER_DIALS },
  { key: 'stems', title: 'Receiving stems', dials: STEM_DIALS },
  {
    key: 'final',
    title: 'Final score',
    dials: FINAL_DIALS,
    note: 'A group scores the sum of its tiles\' values, and a bonus for its size on top. Six is as '
      + 'large as a group can get — no group may repeat a tile, and there are only six values and six '
      + 'colours.',
  },
]

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

/** Focus goes back where it came from, so closing the panel does not strand a keyboard at the top. */
function closeSettings(): void {
  settingsOpen.value = false
  void nextTick(() => gear.value?.focus())
}

/** The choices made so far, newest last. Empty on the first screen. */
const trail = computed(() => {
  const out: { label: string, value: string }[] = []
  if (kind.value) {
    out.push({
      label: 'Game',
      value: GAME_KINDS.find(k => k.id === kind.value)?.label ?? '',
    })
  }
  return out
})

function chooseKind(id: GameKind): void {
  kind.value = id
  step.value = 'singleplayer'
}

function back(): void {
  step.value = 'title'
  kind.value = null
}

function startGame(): void {
  const id = savedGames.create({
    kind: 'singleplayer',
    mode: mode.value,
    /*
     * Minted here and stored with the game, separately from its id.
     *
     * The desks are built from it on the server, so the same seed always deals the same game — which
     * is what makes a reload deal what it dealt before. It is deliberately not the id: the id is in
     * the URL and gets shared, and this is the value that becomes a secret once the server mints it.
     */
    seed: createGameId(),
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
    placementRule: placementRule.value,
    minGroupSize: minGroupSize.value,
    groupBonuses: groupBonuses.value,
    fineUnplaced: fineUnplaced.value === 1,
    rewardStems: rewardStems.value === 1,
  })
  void router.push({ path: '/game', query: { id } })
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

      <!-- The path taken, recorded down a brass spine. -->
      <ol
        v-if="trail.length"
        class="trail"
      >
        <li
          v-for="entry in trail"
          :key="entry.label"
        >
          <span class="trail-label">{{ entry.label }}</span>
          <span class="trail-value">{{ entry.value }}</span>
        </li>
      </ol>
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
          <button
            type="button"
            class="reroll"
            aria-label="Suggest another name"
            title="Suggest another name"
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
      </template>

      <!-- Step 2 -->
      <template v-else>
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
          @click="startGame"
        >
          <span class="option-label">Start game</span>
        </button>
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
    </SettingsFlyout>
  </main>
</template>

<style scoped>
.menu {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 64px;
  align-items: center;
  justify-content: center;
  height: 100%;
  max-width: 940px;
  margin: 0 auto;
  padding: 32px;
}

@media (width <= 760px) {
  .menu {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    align-content: center;
  }
}

/* ── title lockup and the trail of choices ─────────────────────────────────── */

h1 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  font-size: clamp(34px, 6vw, 52px);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.tagline {
  margin: 6px 0 0;
  color: #6b7382;
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
}

.trail {
  margin: 34px 0 0;
  padding: 0 0 0 18px;
  /* The spine: choices hang off it in the order they were made. */
  border-left: 1px solid #3a3222;
  list-style: none;
}

.trail li {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 5px 0;
}

.trail li + li {
  border-top: 1px solid #22252b;
}

.trail-label {
  min-width: 62px;
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.trail-value {
  color: #cfd4de;
  font-size: 12px;
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
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.option {
  display: flex;
  gap: 12px;
  align-items: baseline;
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
  font-size: 13px;
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
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
}

.description {
  margin: 10px 0 0;
  color: #79808f;
  font-size: 12px;
  line-height: 1.5;
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
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
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
  align-items: baseline;
  white-space: nowrap;
}

.pill-label {
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.pill-value {
  color: #cfd4de;
  font-size: 12px;
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
  font-size: 10px;
  letter-spacing: 0.18em;
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
  font-size: 13px;
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
  font-size: 11px;
  letter-spacing: 0.12em;
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
