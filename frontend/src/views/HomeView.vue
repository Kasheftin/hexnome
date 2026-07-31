<script setup lang="ts">
/**
 * The main menu: a drill-down from the title screen to a startable game.
 *
 * Three steps, and the path taken stays on screen beside them. Drilling down is genuinely a
 * sequence here — you cannot pick a mode before picking singleplayer — so recording the trail
 * carries real information rather than decorating the page, and it means the choices already
 * made are legible without going back.
 *
 * Kinds that are not playable yet are shown and disabled rather than hidden, so the shape of the
 * game is visible from the menu.
 *
 * Starting a game mints an id, stores its settings against it, and navigates to `/game?id=…` —
 * which is what lets a refresh come back as the same game (composables/useSavedGames.ts).
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_SINGLEPLAYER_MODE,
  GAME_KINDS,
  PLATES_PER_ROUND_CHOICES,
  SINGLEPLAYER_MODES,
  STEM_COUNT_CHOICES,
  DEFAULT_STEM_COUNT,
  PLACEMENT_RULE_HINTS,
  PLACEMENT_RULE_LABELS,
  modeInfo,
  type GameKind,
  type SingleplayerMode,
} from '@/game/gameSettings'
import {
  DEFAULT_PLACEMENT_RULE,
  PLACEMENT_RULES,
  type PlacementRule,
} from '@/game/placement'
import { useSavedGames } from '@/composables/useSavedGames'

type Step = 'title' | 'kind' | 'singleplayer'

const router = useRouter()
const savedGames = useSavedGames()

const step = ref<Step>('title')
const kind = ref<GameKind | null>(null)
const mode = ref<SingleplayerMode>(DEFAULT_SINGLEPLAYER_MODE)
const platesPerRound = ref<number>(DEFAULT_PLATES_PER_ROUND)
const initialStems = ref<number>(DEFAULT_STEM_COUNT)
const placementRule = ref<PlacementRule>(DEFAULT_PLACEMENT_RULE)

/** The choices made so far, newest last. Empty on the title screen. */
const trail = computed(() => {
  const out: { label: string, value: string }[] = []
  if (step.value !== 'title') out.push({ label: 'Game', value: 'New' })
  if (kind.value) {
    out.push({
      label: 'Players',
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
  if (step.value === 'singleplayer') {
    step.value = 'kind'
    kind.value = null
  } else {
    step.value = 'title'
  }
}

function startGame(): void {
  const id = savedGames.create({
    kind: 'singleplayer',
    mode: mode.value,
    platesPerRound: platesPerRound.value,
    initialStems: initialStems.value,
    placementRule: placementRule.value,
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
      :aria-label="step === 'title' ? 'Main menu' : step === 'kind' ? 'Choose players' : 'Game setup'"
    >
      <!-- Step 1 -->
      <template v-if="step === 'title'">
        <button
          type="button"
          class="option"
          @click="step = 'kind'"
        >
          <span class="option-label">New game</span>
        </button>
        <button
          type="button"
          class="option"
          disabled
        >
          <span class="option-label">Settings</span>
          <span class="soon">Soon</span>
        </button>
      </template>

      <!-- Step 2 -->
      <template v-else-if="step === 'kind'">
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
      </template>

      <!-- Step 3 -->
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
          <legend>Plates per round</legend>
          <div class="counts">
            <button
              v-for="count in PLATES_PER_ROUND_CHOICES"
              :key="count"
              type="button"
              class="count"
              :class="{ chosen: platesPerRound === count }"
              :aria-pressed="platesPerRound === count"
              @click="platesPerRound = count"
            >
              {{ count }}
            </button>
          </div>
        </fieldset>

        <fieldset class="group">
          <legend>Stems</legend>
          <div class="counts">
            <button
              v-for="count in STEM_COUNT_CHOICES"
              :key="count"
              type="button"
              class="count"
              :class="{ chosen: initialStems === count }"
              :aria-pressed="initialStems === count"
              @click="initialStems = count"
            >
              {{ count }}
            </button>
          </div>
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

.counts {
  display: flex;
  gap: 8px;
}

.count {
  flex: 1;
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

:is(.option, .count, .back):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  :is(.option, .count) {
    transition: none;
  }
}
</style>
