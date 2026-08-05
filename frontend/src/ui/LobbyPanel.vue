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

const props = defineProps<{
  game: GameView
  /** True while a join is in flight, so the button cannot be pressed twice. */
  joining: boolean
  problem: string
}>()

const emit = defineEmits<{ join: [name: string] }>()

const name = defineModel<string>('name', { required: true })

const free = computed(() => props.game.seats.filter(seat => !seat.joined).length)
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
    <h1>{{ seated ? 'Waiting for the others' : 'Join this game' }}</h1>

    <ol class="seats">
      <li
        v-for="seat in game.seats"
        :key="seat.seat"
        :class="{ empty: !seat.joined, mine: seat.seat === game.you }"
      >
        <span class="who">{{ seat.name || `Player ${seat.seat + 1}` }}</span>
        <span class="state">{{ seat.joined ? (seat.seat === game.you ? 'you' : 'here') : 'empty' }}</span>
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
        {{ joining ? 'Sitting down…' : 'Take a seat' }}
      </button>
    </template>

    <!--
      Full, and not yours. Not an error: anyone with the link may watch, and the game will simply
      appear when it starts.
    -->
    <p
      v-else-if="!seated"
      class="note"
    >
      Every seat is taken. You can watch.
    </p>

    <template v-else>
      <p class="note">
        {{ free === 1 ? 'One more player' : `${free} more players` }} and the game begins.
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
  </div>
</template>

<style scoped>
.lobby {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #15171c;
  color: #79808f;
}

h1 {
  margin: 0;
  color: #e8c878;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.seats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: min(340px, 100%);
  margin: 0;
  padding: 0;
  list-style: none;
}

.seats li {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 9px 13px;
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
  width: min(340px, 100%);
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
  width: min(340px, 100%);
}

.invite input { font-size: 11px; }

button {
  padding: 9px 18px;
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

.go { width: min(340px, 100%); }

.note {
  margin: 0;
  font-size: 13px;
}

.problem {
  margin: 0;
  color: #d98c72;
  font-size: 12px;
}

button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}
</style>
