<script setup lang="ts">
/**
 * The route for `/game?id=…`: fetch the game, then hand it to the board.
 *
 * **Why the split.** `GameBoard` builds its tableau, its agenda and its whole turn machinery in
 * `<script setup>`, synchronously, and everything downstream holds the objects it makes. Loading
 * from the server before any of that exists would mean making all of it conditional and reactive —
 * a large change to a large component, for no gain. Instead this shell does the waiting and mounts
 * the board only once there is a game to play, so the board's setup stays exactly as simple as it
 * was and merely takes its opening position as a prop instead of dealing it.
 *
 * **The key is the recovery mechanism.** When the client and the server disagree there is no attempt
 * to reconcile move by move: `generation` is bumped, the board is torn down and rebuilt from the
 * server's log. An optimistic client that ends up *nearly* right about the truth is worse than one
 * that starts again — and this way the rebuild path is the same code as the ordinary load path, so
 * it cannot rot unnoticed.
 */
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameSync, type LoadedGame } from '@/composables/useGameSync'
import GameBoard from './GameBoard.vue'

const route = useRoute()
const router = useRouter()
const sync = useGameSync()

const gameId = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const loaded = shallowRef<LoadedGame | null>(null)

/** Bumped to rebuild the board from scratch. See the note above. */
const generation = shallowRef(0)

async function open(): Promise<void> {
  loaded.value = null
  if (!gameId.value) {
    void router.replace('/')
    return
  }
  const game = await sync.load(gameId.value)
  if (game) {
    loaded.value = game
    generation.value++
  }
}

watch(gameId, open, { immediate: true })

/*
 * The board tells us it can no longer trust itself. Reload from the server and rebuild — the key
 * change unmounts the old board, so nothing of the diverged state survives into the new one.
 */
function onDiverged(): void {
  void open()
}

const status = computed(() => sync.status())
const problem = computed(() => sync.problem())
</script>

<template>
  <GameBoard
    v-if="loaded"
    :key="generation"
    :game="loaded.game"
    :commands="loaded.commands"
    :sync="sync"
    @diverged="onDiverged"
  />

  <div
    v-else
    class="curtain"
  >
    <p
      v-if="status === 'loading'"
      class="waiting"
    >
      Dealing…
    </p>

    <template v-else>
      <h1>{{ status === 'missing' ? 'No such game' : 'Cannot reach the table' }}</h1>
      <p class="why">
        {{ problem }}
      </p>
      <div class="ways-out">
        <button
          v-if="status !== 'missing'"
          type="button"
          @click="open"
        >
          Try again
        </button>
        <button
          type="button"
          class="quiet"
          @click="router.replace('/')"
        >
          Back to menu
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.curtain {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #15171c;
  color: #79808f;
  text-align: center;
}

h1 {
  margin: 0;
  color: #e8c878;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.why {
  margin: 0;
  font-size: 13px;
}

/* No spinner: the wait is a fraction of a second, and a spinner that flashes reads as a fault. */
.waiting {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  animation: breathe 1.6s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}

.ways-out {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

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

button:hover {
  background: rgb(232 200 120 / 12%);
}

button.quiet {
  border-color: #33383f;
  color: #79808f;
}

button.quiet:hover {
  background: rgb(121 128 143 / 10%);
}

button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .waiting { animation: none; }
}
</style>
