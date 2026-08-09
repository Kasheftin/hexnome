<script setup lang="ts">
/**
 * The table, before it starts: who is playing.
 *
 * **Deliberately temporary.** The real panel — game name, read-only settings, a seat list and a Ready
 * button per player — is on `backend-attempt1` and comes back when there is a server to fill it from.
 * This is the placeholder that lets the flow exist first: a row per seat, all of them on one screen,
 * because local multiplayer means everyone is already here and there is nobody to wait for.
 *
 * The names are stored against the game as they are typed, so a refresh comes back to the same table
 * rather than rolling everyone a new name (composables/useSavedGames.ts).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { GAME_KINDS, MAX_NAME_LENGTH, modeInfo } from '@hexnome/rules/gameSettings'
import { playerName, suggestNames } from '@/composables/playerName'
import { useSavedGames } from '@/composables/useSavedGames'

const route = useRoute()
const router = useRouter()
const savedGames = useSavedGames()

const gameId = computed(() => {
  const id = route.query.id
  return typeof id === 'string' ? id : ''
})

const settings = computed(() => savedGames.get(gameId.value))

const kindLabel = computed(() =>
  GAME_KINDS.find(entry => entry.id === settings.value?.kind)?.label ?? '')

const modeLabel = computed(() => {
  const s = settings.value
  return s ? modeInfo(s.mode)?.label ?? s.mode : ''
})

/** One box per seat, in seating order. Seat 0 is whoever made the game. */
const names = ref<string[]>([])

/**
 * Fill every seat that has no name yet.
 *
 * Seat 0 is you — the name from the menu, or the one this browser arrived under. The rest are dealt
 * suggestions in one go, so no two of them collide, and nothing already typed is overwritten.
 */
function seatEveryone(): void {
  const s = settings.value
  if (!s) return

  const seated = Array.from({ length: s.players }, (_, seat) => s.playerNames[seat] ?? '')
  if (!seated[0]) seated[0] = playerName()

  const empty = seated.reduce<number[]>((at, name, seat) => (name ? at : [...at, seat]), [])
  const dealt = suggestNames(empty.length, seated.filter(Boolean))
  empty.forEach((seat, index) => {
    const name = dealt[index]
    if (name) seated[seat] = name
  })

  names.value = seated
}

onMounted(() => {
  // No id, or one we cannot read: there is no game here, so send them somewhere that works.
  if (!settings.value) {
    void router.replace('/')
    return
  }
  seatEveryone()
  remember()
})

function remember(): void {
  savedGames.update(gameId.value, { playerNames: names.value.map(name => name.trim()) })
}

/*
 * Stored as they are typed rather than on blur. A lobby is a form nobody presses Save on — the next
 * thing to happen is Start, and a half-typed name reaching the board is better than a lost one.
 */
watch(names, remember, { deep: true })

function start(): void {
  void router.push({ path: '/game', query: { id: gameId.value } })
}
</script>

<template>
  <main
    v-if="settings"
    class="lobby"
  >
    <div class="lockup">
      <h1>hexnome</h1>
      <ol class="trail">
        <li>
          <span class="trail-label">Game</span>
          <span class="trail-value">{{ kindLabel }}</span>
        </li>
        <li>
          <span class="trail-label">Mode</span>
          <span class="trail-value">{{ modeLabel }}</span>
        </li>
        <li>
          <span class="trail-label">Players</span>
          <span class="trail-value">{{ settings.players }}</span>
        </li>
      </ol>
    </div>

    <section
      class="panel"
      aria-label="Players"
    >
      <fieldset class="group">
        <legend>At the table</legend>
        <label
          v-for="(_, seat) in names"
          :key="seat"
          class="seat"
        >
          <span class="seat-number">{{ seat + 1 }}</span>
          <input
            v-model="names[seat]"
            type="text"
            :maxlength="MAX_NAME_LENGTH"
            :placeholder="`Player ${seat + 1}`"
            :aria-label="`Name for player ${seat + 1}`"
          >
        </label>
      </fieldset>

      <!--
        Said out loud because the screen implies otherwise. The board still deals one seat and plays
        as a solo game; this screen is the part that exists so far.
      -->
      <p class="description">
        The board is still single-seat — starting from here plays a solo game. This screen is
        groundwork, and the real lobby comes back with the server behind it.
      </p>

      <button
        type="button"
        class="option start"
        @click="start"
      >
        <span class="option-label">Start game</span>
      </button>

      <RouterLink
        to="/"
        class="back"
      >
        Back
      </RouterLink>
    </section>
  </main>
</template>

<style scoped>
/*
 * The menu's two-column lockup, deliberately: this is the same act continued, not a new place. Its
 * rules are copied rather than shared because the menu's are scoped to it — worth extracting once a
 * third screen wants them, and not before.
 */
.lobby {
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
  .lobby {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    align-content: center;
  }
}

h1 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  font-size: clamp(34px, 6vw, 52px);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.trail {
  margin: 34px 0 0;
  padding: 0 0 0 18px;
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

legend {
  padding: 0 0 8px;
  color: #6b7382;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.seat {
  display: flex;
  gap: 10px;
  align-items: center;
}

.seat + .seat {
  margin-top: 8px;
}

/* The seat's number, not the player's — it is where they sit, and turn order follows it. */
.seat-number {
  width: 22px;
  color: #6b7382;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.seat input {
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

.seat input::placeholder {
  color: #575d68;
}

.seat input:focus-visible {
  border-color: #7d6a41;
  outline: none;
}

.description {
  margin: 14px 0 0;
  color: #79808f;
  font-size: 12px;
  line-height: 1.5;
}

.option {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: center;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #cfd4de;
  font: inherit;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, color 140ms;
}

.option-label {
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.option.start {
  margin-top: 14px;
  border-color: #7d6a41;
  color: #e8c878;
}

.option.start:hover {
  background: rgb(232 200 120 / 14%);
}

.back {
  align-self: flex-start;
  margin-top: 6px;
  padding: 6px 0;
  color: #6b7382;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.back:hover {
  color: #e8c878;
}

:is(.option, .back):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}
</style>
