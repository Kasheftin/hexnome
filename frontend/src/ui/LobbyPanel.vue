<script setup lang="ts">
/**
 * The waiting room: who is here, who is missing, and the link that fetches them.
 *
 * Shown to everyone alike — the player who made the game and the ones arriving on their link see the
 * same panel, because at this point they are in the same position. There is no host console and
 * nothing for a host to press.
 *
 * **No "I'm ready".** The table is a fixed size, chosen when the game was made, so it wants exactly
 * as many players as it has seats and the last person to sit down *is* the last ready. A button
 * would only earn its place if a game could start short-handed.
 */
import { computed, shallowRef } from 'vue'
import type { GameView } from '@hexnome/rules/wire'
import { settingsRows } from '@/ui/settingsSummary'

const props = defineProps<{
  game: GameView
  /** True while a join is in flight, so the button cannot be pressed twice. */
  joining: boolean
  problem: string
}>()

const emit = defineEmits<{ join: [name: string] }>()

const name = defineModel<string>('name', { required: true })

const free = computed(() => props.game.seats.filter(seat => !seat.joined).length)

/**
 * The whole setup, read-only.
 *
 * Shown because nobody arriving on a link chose any of it, and a game that surprises you with its own
 * rules is worse than one that takes a moment to read. It is also why the button says *Ready* rather
 * than "Join": the point of the screen is that you have seen what you are agreeing to.
 */
const rules = computed(() => settingsRows(props.game.settings))
/*
 * A number, checked as one. `!== null` would call `undefined` a seat — and an absent field is
 * exactly what an older server, or a typo in a select, would send.
 */
const seated = computed(() => typeof props.game.you === 'number')

/** The whole of the invitation. The id in it is the capability — there is nothing else to send. */
const link = computed(() => globalThis.location?.href ?? '')
const copied = shallowRef(false)

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  }
  catch {
    // Clipboard refused — over plain HTTP, or without permission. The field is selectable anyway.
  }
}
</script>

<template>
  <div class="lobby">
    <!--
      An inner sheet with `margin: auto` rather than `justify-content: center` on the scroller: a
      centred flex column clips its own top once the content is taller than the window, and this
      screen grows with the number of settings.
    -->
    <div class="sheet">
      <header class="brand">
        <h1>hexnome</h1>
        <p class="tagline">{{ seated ? 'Waiting for the others' : 'You have been invited' }}</p>
      </header>

      <div class="columns">
        <!-- What the game is. Read-only: it was settled when the game was made. -->
        <section
          class="rules"
          aria-label="Game settings"
        >
          <h2>Settings</h2>
          <dl>
            <div
              v-for="row in rules"
              :key="row.label"
            >
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
        </section>

        <section
          class="table"
          aria-label="Players"
        >
          <h2>Players</h2>
          <ol class="seats">
            <li
              v-for="seat in game.seats"
              :key="seat.seat"
              :class="{ empty: !seat.joined, mine: seat.seat === game.you }"
            >
              <span class="who">{{ seat.name || `Player ${seat.seat + 1}` }}</span>
              <span class="state">{{ seat.joined ? (seat.seat === game.you ? 'you' : 'ready') : 'empty' }}</span>
            </li>
          </ol>

          <template v-if="!seated && free > 0">
            <label class="name">
              <span>Your name</span>
              <input
                v-model="name"
                type="text"
                maxlength="40"
                placeholder="Player"
                @keyup.enter="emit('join', name)"
              >
            </label>
            <button
              type="button"
              class="go"
              :disabled="joining"
              @click="emit('join', name)"
            >
              {{ joining ? 'Sitting down…' : 'Ready' }}
            </button>
          </template>

          <!--
            Full, and not yours. Not an error: anyone with the link may watch, and the board appears by
            itself when the last player arrives.
          -->
          <p
            v-else-if="!seated"
            class="note"
          >
            Every seat is taken. You can watch.
          </p>

          <template v-else>
            <p class="note">
              {{ free === 0 ? 'Starting…' : free === 1 ? 'One more player.' : `${free} more players.` }}
            </p>
            <p class="hint">
              Send this link to the others — it is the game.
            </p>
            <div class="invite">
              <input
                :value="link"
                readonly
                aria-label="Invite link"
                @focus="($event.target as HTMLInputElement).select()"
              >
              <button
                type="button"
                @click="copyLink"
              >
                {{ copied ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </template>

          <p
            v-if="problem"
            class="problem"
            role="alert"
          >
            {{ problem }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The menu's shape rather than a dialog's: this is a screen you read, not a box you dismiss. Two
 * columns, rules on the left and the table on the right — and they stack on a narrow window, where
 * the rules are the part you can scroll past.
 */
.lobby {
  position: fixed;
  inset: 0;
  display: flex;
  padding: 34px 24px;
  overflow-y: auto;
  background: #15171c;
  color: #79808f;
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 22px;
  align-items: center;
  /*
   * A width of its own, or it shrinks to its content and the two columns wrap: `.columns` asks for
   * 100% of its parent, and a parent sized by its children makes that a circular answer.
   */
  width: min(760px, 100%);
  /* Centred while it fits, top-aligned and scrollable once it does not. */
  margin: auto;
}

.brand {
  flex: none;
  text-align: center;
}

h1 {
  margin: 0;
  color: #e8c878;
  font-size: 26px;
  font-weight: 400;
  letter-spacing: 0.32em;
  text-transform: lowercase;
}

.tagline {
  margin: 6px 0 0;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.columns {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}

section {
  flex: 1 1 280px;
  min-width: 260px;
  padding: 16px 18px;
  border: 1px solid #2a2c33;
  border-radius: 4px;
  background: rgb(21 23 28 / 70%);
}

h2 {
  margin: 0 0 12px;
  color: #e8c878;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

dl {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}

dl > div {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
}

dt {
  font-size: 12px;
}

dd {
  margin: 0;
  color: #cfd4dd;
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}

.seats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.seats li {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 9px 12px;
  border: 1px solid #33383f;
  border-radius: 3px;
  font-size: 13px;
}

.seats li.mine {
  border-color: #7d6a41;
  color: #e8c878;
}

/* A seat nobody is in reads as an outline rather than a row: the shape of who is missing. */
.seats li.empty {
  border-style: dashed;
  color: #4d535e;
}

.state {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.seats li.mine .state { color: #8fe6c0; }

.name {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.name span { flex: none; }

input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: #1b1e24;
  color: #cfd4dd;
  font: inherit;
  font-size: 13px;
}

input:focus-visible {
  border-color: #7d6a41;
  outline: none;
}

.invite {
  display: flex;
  gap: 6px;
}

.invite input { font-size: 11px; }

button {
  flex: none;
  padding: 9px 16px;
  border: 1px solid #7d6a41;
  border-radius: 3px;
  background: transparent;
  color: #e8c878;
  font: inherit;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 140ms;
}

button:hover:not(:disabled) { background: rgb(232 200 120 / 12%); }
button:disabled { opacity: 0.55; cursor: default; }

.go { width: 100%; }

.note {
  margin: 0;
  font-size: 13px;
}

.hint {
  margin: 6px 0 8px;
  font-size: 11px;
  color: #5b616d;
}

.problem {
  margin: 10px 0 0;
  color: #d98c72;
  font-size: 12px;
}

button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}
</style>
