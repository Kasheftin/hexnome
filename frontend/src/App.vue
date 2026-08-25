<script setup lang="ts">
/**
 * The gate in front of every screen that is about a game.
 *
 * A view that is handed `?id=…` needs the game before it can render anything honest — `GameView`
 * builds its whole state from the settings at setup, and a join screen with no seats is a blank
 * list rather than an empty table. So the store loads it first and nothing mounts until it has.
 *
 * That is why this is a gate rather than a curtain inside each view: written per view, the check
 * would be three copies of the same `v-if`, and the third one would be the one somebody forgot.
 *
 * Screens with no id in the route — the menu — render straight through. They are not about a game
 * and have nothing to wait for.
 */
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import ErrorPage from '@/ui/ErrorPage.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()

/** A server that said nothing may be worth asking again; one that said "no such game" is not. */
const retryable = computed(() => store.loadingError !== null
  && !/no game/i.test(store.loadingError))
</script>

<template>
  <RouterView v-if="!store.id || store.game" />

  <ErrorPage
    v-else-if="store.loadingError"
    :message="store.loadingError"
    :retryable="retryable"
    @retry="store.loadGame()"
  />

  <!--
    The wait. Deliberately almost nothing: the first load is one request against a local server, and
    a spinner that appears for 40ms reads as a flicker rather than as progress.
  -->
  <main
    v-else
    class="waiting"
    aria-busy="true"
  >
    <p>Opening the table…</p>
  </main>
</template>

<style scoped>
.waiting {
  display: grid;
  place-items: center;
  height: 100%;
  color: #6b7382;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
}
</style>
