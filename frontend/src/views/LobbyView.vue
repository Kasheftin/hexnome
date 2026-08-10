<script setup lang="ts">
/**
 * The table, before it starts: who is here, and the link that brings the rest.
 *
 * **A game at a different moment, not a different place.** `/join` and `/game` are two screens for
 * one id, and which of them a client belongs on is the server's answer rather than the link's — see
 * `stores/game.ts`. So the link this screen hands out is the *game* link: whoever opens it lands here
 * while the table is filling and on the board once it has, and the host never sends a second one.
 *
 * Everything on it comes from the store, which reloads whenever the server says the game moved. A
 * chair taken in another browser appears here within a socket message, and within two seconds even if
 * the socket never connected.
 *
 * **There is no Start button, and that is the rule rather than an omission.** A game starts when its
 * last chair is taken (backend/src/games/games.service.ts). Nobody decides it, so nobody can press it.
 */
import { computed, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { MAX_NAME_LENGTH } from '@hexnome/rules/gameSettings'
import { ApiError } from '@/api/games'
import { playerName, rememberName } from '@/composables/playerName'
import PresenceMark from '@/ui/PresenceMark.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()

/** What to arrive under. The person's name, not the game's — filled in from the last visit. */
const name = ref(playerName())

const joining = shallowRef(false)
const problem = shallowRef('')

const seats = computed(() => store.game?.seats ?? [])
const waitingFor = computed(() => seats.value.filter(seat => !seat.joined).length)

/** There is a chair to take, and nobody in this browser has taken one. */
const canJoin = computed(() => store.mySeat === null && waitingFor.value > 0)

/**
 * The link to hand out — the **game**, not this screen.
 *
 * Absolute, because it is going into a message to somebody else. Built from the page's own origin, so
 * it is right in development, behind a proxy, and wherever this ends up hosted.
 */
const shareLink = computed(() =>
  `${globalThis.location.origin}/game?id=${encodeURIComponent(store.id)}`)

const copied = shallowRef(false)

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch {
    // No permission, or an insecure origin. The field selects itself on focus, which is the fallback.
  }
}

/**
 * Take a chair.
 *
 * A 409 means somebody took the last one between this screen rendering and the button being pressed
 * — which is exactly what the conditional claim on the server is for, and is a thing to say rather
 * than a thing to retry.
 */
async function join(): Promise<void> {
  if (joining.value) return
  joining.value = true
  problem.value = ''
  rememberName(name.value)

  try {
    await store.join(name.value.trim())
  } catch (error) {
    problem.value = error instanceof ApiError && error.status === 409
      ? 'Somebody took the last chair. This game is full.'
      : error instanceof ApiError ? error.message : 'Cannot reach the table.'
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <main class="lobby">
    <div class="lockup">
      <h1>hexnome</h1>
      <p class="tagline">
        Build · Adapt · Evolve
      </p>
    </div>

    <section
      class="panel"
      aria-label="Players"
    >
      <h2 class="legend">
        At the table
      </h2>
      <ol class="seats">
        <li
          v-for="seat in seats"
          :key="seat.seat"
          class="seat"
          :class="{ empty: !seat.joined, mine: seat.seat === store.mySeat }"
        >
          <span class="seat-number">{{ seat.seat + 1 }}</span>
          <!--
            Only for a chair somebody holds. An empty one already says so in words, and a red mark
            beside "Empty chair" would read as a fault rather than as a vacancy.
          -->
          <PresenceMark
            v-if="seat.joined"
            :online="seat.online"
            :name="seat.name || `Player ${seat.seat + 1}`"
          />
          <span class="seat-name">
            {{ seat.joined ? (seat.name || `Player ${seat.seat + 1}`) : 'Empty chair' }}
          </span>
          <span
            v-if="seat.seat === store.mySeat"
            class="seat-tag"
          >you</span>
        </li>
      </ol>

      <!-- Yours to take. Gone once you have a chair — there is nothing left to press. -->
      <div
        v-if="canJoin"
        class="claim"
      >
        <label class="field">
          <span class="field-label">Your name</span>
          <input
            v-model="name"
            type="text"
            :maxlength="MAX_NAME_LENGTH"
            placeholder="Player"
            @keyup.enter="join"
          >
        </label>
        <button
          type="button"
          class="option start"
          :disabled="joining"
          @click="join"
        >
          <span class="option-label">{{ joining ? 'Sitting…' : 'Join' }}</span>
        </button>
      </div>

      <p
        v-else-if="store.mySeat !== null"
        class="description"
      >
        You are seated.
        {{ waitingFor === 1 ? 'One more player' : `${waitingFor} more players` }}
        and the game starts on its own.
      </p>

      <p
        v-if="problem"
        class="problem"
        role="alert"
      >
        {{ problem }}
      </p>

      <div class="share">
        <span class="field-label">Share this link</span>
        <div class="share-row">
          <input
            class="link"
            type="text"
            readonly
            :value="shareLink"
            aria-label="Link to this game"
            @focus="(event) => (event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="copy"
            @click="copyLink"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
      </div>

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
 * The menu's two-column lockup, deliberately, down to the tagline: this is the same act continued,
 * not a new place. Its rules are copied rather than shared because the menu's are scoped to it —
 * worth extracting once a third screen wants them, and not before.
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

.tagline {
  margin: 6px 0 0;
  color: #6b7382;
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
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

.legend,
.field-label {
  margin: 0;
  color: #6b7382;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.seats {
  margin: 0;
  padding: 0;
  list-style: none;
}

.seat {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 9px 10px;
  border: 1px solid #2a2e35;
  border-radius: 3px;
  color: #cfd4de;
  font-size: 13px;
}

.seat + .seat {
  margin-top: 6px;
}

/* An empty chair is drawn as the outline of one: present, and plainly not filled. */
.seat.empty {
  border-style: dashed;
  color: #575d68;
}

.seat.mine {
  border-color: #7d6a41;
}

/* The seat's number, not the player's — it is where they sit, and turn order follows it. */
.seat-number {
  width: 18px;
  color: #6b7382;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.seat-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-tag {
  color: #e8c878;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.claim {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  margin-top: 12px;
}

.field {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: #1b1e24;
  color: #cfd4de;
  font: inherit;
  font-size: 13px;
}

input::placeholder {
  color: #575d68;
}

input:focus-visible {
  border-color: #7d6a41;
  outline: none;
}

.description {
  margin: 12px 0 0;
  color: #79808f;
  font-size: 12px;
  line-height: 1.5;
}

.problem {
  margin: 4px 0 0;
  color: #d98b74;
  font-size: 12px;
  line-height: 1.5;
}

.share {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #2a2e35;
}

.share-row {
  display: flex;
  gap: 8px;
}

/* Monospaced, because it is a thing to read character by character before sending it on. */
.link {
  color: #9aa2b1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.copy {
  flex: none;
  padding: 8px 12px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #cfd4de;
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.copy:hover {
  border-color: #7d6a41;
  color: #e8c878;
}

.option {
  flex: none;
  padding: 8px 16px;
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
  border-color: #7d6a41;
  color: #e8c878;
}

.option.start:hover:not(:disabled) {
  background: rgb(232 200 120 / 14%);
}

.option:disabled {
  opacity: 0.6;
  cursor: default;
}

.back {
  align-self: flex-start;
  margin-top: 10px;
  padding: 6px 0;
  color: #6b7382;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.back:hover {
  color: #e8c878;
}

:is(.option, .copy, .back):focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}
</style>
