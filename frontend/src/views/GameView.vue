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
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { joinGame, ApiError } from '@/api/games'
import { watchHead, type HeadWatch } from '@/composables/useHeadWatch'
import { useGameSync, type LoadedGame } from '@/composables/useGameSync'
import { playerName, rememberName, rememberSeat } from '@/composables/useSeat'
import LobbyPanel from '@/ui/LobbyPanel.vue'
import GameBoard from './GameBoard.vue'

const route = useRoute()
const router = useRouter()
const sync = useGameSync()

const gameId = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const loaded = shallowRef<LoadedGame | null>(null)

/** Bumped to rebuild the board from scratch. See the note above. */
const generation = shallowRef(0)

/**
 * The seat this browser holds, from the token kept when it joined — or null.
 *
 * Null is a spectator, and deliberately not an error: anyone with the link may watch. It is never
 * their turn, because their seat matches nobody's, so every gate downstream refuses them without
 * needing to know that spectators exist.
 */
const mySeat = shallowRef<number | null>(null)

const name = shallowRef(playerName())
const joining = shallowRef(false)
const joinProblem = shallowRef('')
let watcher: HeadWatch | null = null

/**
 * Whose board is on screen.
 *
 * Separate from `mySeat`, which is the whole point: watching another player is this changing and
 * nothing else. It seeds from your own seat, and falls back to the first — the natural thing to show
 * somebody who has only been sent a link.
 */
const viewedSeat = shallowRef(0)

/**
 * A board the player deliberately chose to watch, or null while they are simply watching their own.
 *
 * Without this there is nothing to tell "the view happens to be seat 0" from "I asked for seat 0", so
 * the view either never follows the seat you are given or overrides a choice you made. It follows
 * until you choose; after that it is yours.
 */
const chosenSeat = shallowRef<number | null>(null)

/**
 * Load the game from scratch: the curtain, then the board.
 *
 * Only for arriving, or for starting again after a divergence. Everything that merely *updates* goes
 * through `refresh`, which is the difference between a screen that changes and a screen that blinks.
 */
async function open(): Promise<void> {
  loaded.value = null
  stopWatching()
  if (!gameId.value) {
    void router.replace('/')
    return
  }
  if (await refresh()) generation.value++
}

/**
 * Fetch the game again and update in place.
 *
 * **Nothing is cleared first**, and that is the whole point. Clearing `loaded` unmounts whatever is on
 * screen and shows the curtain for as long as the request takes, so a waiting room that polled once a
 * second flashed once a second. The panel is a live view of a value; replacing the value re-renders
 * the parts that differ and leaves the rest alone.
 *
 * `generation` is deliberately not touched either: bumping it re-keys the board and throws away a
 * running scene, which is not what "somebody else joined" should cost.
 */
async function refresh(): Promise<boolean> {
  const game = await sync.load(gameId.value)
  if (!game) return false

  /*
   * Which seat is mine comes from the server, worked out from the token we sent — not from the seat
   * number stored beside it. The token is the truth; a copy of the seat kept locally is a second
   * answer that can go stale, and a client trusting it could draw one board while playing another.
   */
  mySeat.value = game.game.you
  /*
   * Watch your own board unless you said otherwise — including the moment you *acquire* a seat, which
   * is what this used to miss: joining from the waiting room left the view on the board it had been
   * showing before there was a seat to show, so a player who had just sat down was watching somebody
   * else's game.
   */
  if (chosenSeat.value === null) viewedSeat.value = game.game.you ?? 0
  loaded.value = game

  if (game.game.status === 'lobby') watchTable()
  else stopWatching()
  return true
}

/**
 * Watch a lobby until it fills.
 *
 * The same notifier the board uses, so a seat being taken travels the way a turn does — the server
 * says the game moved and this goes and looks. A poll underneath means a socket that never connects
 * only costs a second or two.
 */
function watchTable(): void {
  if (watcher !== null) return
  watcher = watchHead(gameId.value, () => { void refresh() })
}

/**
 * Look at somebody's board.
 *
 * **Fetches before switching**, and that is the fix rather than the flourish: changing the seat
 * remounts the board, and a remount rebuilds it from the commands this component is holding — which
 * only grow when it fetches. The board absorbs other players' turns into its *own* tableau as they
 * arrive, so what is held here goes stale the moment anybody else moves. Switching seats then rebuilt
 * from that stale copy, and the game reappeared as it had been several turns ago.
 */
async function watchSeat(seat: number): Promise<void> {
  await refresh()
  chosenSeat.value = seat
  viewedSeat.value = seat
}

function stopWatching(): void {
  watcher?.stop()
  watcher = null
}

onBeforeUnmount(stopWatching)

/** Sit down, and remember the seat well enough to come back to it after a refresh. */
async function takeSeat(): Promise<void> {
  if (joining.value) return
  joining.value = true
  joinProblem.value = ''
  rememberName(name.value)

  try {
    const claim = await joinGame(gameId.value, name.value)
    rememberSeat(gameId.value, { seat: claim.seat, token: claim.token })
    await refresh()
  }
  catch (error) {
    joinProblem.value = error instanceof ApiError && error.status === 409
      ? 'Somebody took the last seat first. You can still watch.'
      : 'Could not reach the table. Try again.'
    // Whatever happened, the truth about the table has moved on — go and look.
    await refresh()
  }
  finally {
    joining.value = false
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
  <!-- A table still filling up. Nobody plays until every seat is taken. -->
  <LobbyPanel
    v-if="loaded && loaded.game.status === 'lobby'"
    v-model:name="name"
    :game="loaded.game"
    :joining="joining"
    :problem="joinProblem"
    @join="takeSeat"
  />

  <GameBoard
    v-else-if="loaded"
    :key="`${generation}:${viewedSeat}`"
    :game="loaded.game"
    :commands="loaded.commands"
    :my-seat="mySeat"
    :viewed-seat="viewedSeat"
    :sync="sync"
    @diverged="onDiverged"
  />

  <!--
    Whose board to look at. Outside the board rather than inside it, because changing it remounts the
    board — the key includes it — and a control cannot survive unmounting itself.
  -->
  <nav
    v-if="loaded && loaded.game.status !== 'lobby' && loaded.game.seats.length > 1"
    class="seats"
    aria-label="Whose board to watch"
  >
    <button
      v-for="seat in loaded.game.seats"
      :key="seat.seat"
      type="button"
      :class="{ watching: seat.seat === viewedSeat }"
      :aria-pressed="seat.seat === viewedSeat"
      @click="watchSeat(seat.seat)"
    >
      {{ seat.name || `Player ${seat.seat + 1}` }}<span
        v-if="seat.seat === mySeat"
        class="you"
      >you</span>
    </button>
  </nav>

  <div
    v-if="!loaded"
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
/*
 * Top right, where the scoring panel sits, so the two read as one column about the table rather than
 * as chrome scattered around the board.
 */
.seats {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.seats button {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  padding: 7px 12px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: rgb(21 23 28 / 92%);
  color: #79808f;
  font: inherit;
  font-size: 12px;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: border-color 140ms, color 140ms;
}

.seats button:hover,
.seats button.watching {
  border-color: #7d6a41;
  color: #e8c878;
}

.you {
  color: #8fe6c0;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.seats button:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

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
