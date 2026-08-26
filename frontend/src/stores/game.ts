import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { GameView } from '@hexnome/rules/wire'
import { ApiError } from '@/api/base'
import { getGame, joinGame } from '@/api/games'
import { rememberSeat, seatToken } from '@/composables/useSeat'
import { watchHead, type HeadWatch } from '@/composables/watchHead'
import { router } from '@/router'

/**
 * The game the page is on: which one, what the server says about it, and whether it is reachable.
 *
 * ## The id comes from the route, and the route is the only way to set it
 *
 * A game is identified by `?id=…`, so that is where this reads it from — watching
 * `router.currentRoute` rather than being told by each view. Anything else means two places that
 * know which game is open, and the second one is wrong the first time somebody uses the back button.
 *
 * Watching the router directly rather than through a `beforeEach` guard, because a guard runs *before*
 * the navigation and would have to decide the outcome of a fetch it has not made yet. A watcher runs
 * after, which is when there is something to react to.
 *
 * ## The status decides the screen, and the screen is a route
 *
 * `/game` for a game being played and `/join` for one still filling up. A client that lands on the
 * wrong one is *replaced* onto the right one — not pushed, so the back button does not walk into the
 * screen the server just said was the wrong one. That is what makes a share link work: a host sends
 * `/game?id=…` and whoever opens it arrives wherever the game actually is.
 *
 * ## Everything else is a nudge to reload
 *
 * The socket carries `{ gameId, seq }` and no game data (backend/src/games/heads.gateway.ts). This
 * compares the seq with the one it holds and refetches if they differ, which means a duplicate or a
 * stale notification costs nothing and cannot mislead. There is exactly one path by which a game
 * enters this store, and it is `loadGame`.
 */
export const useGameStore = defineStore('game', () => {
  /** Which game, from `?id=…`. Empty everywhere that is not about a game. */
  const id = ref('')

  /** What the server last said. Null before the first answer, and cleared when the id goes. */
  const game = shallowRef<GameView | null>(null)

  /**
   * Why the game could not be loaded, as a sentence to show.
   *
   * Held separately from `game` rather than as a state union, because the two are not exclusive: a
   * game already on screen that then fails to reload should keep showing what it has. The gate in
   * App.vue reads them in that order.
   */
  const loadingError = ref<string | null>(null)

  /** True while the first load of a game is outstanding — the only load with nothing to show. */
  const loading = ref(false)

  /**
   * Told whenever the server says this game moved.
   *
   * The board subscribes so it can go and fetch the turns. It lives here rather than in the board
   * because the socket is per game and the board is per mount — a seat change or a reload should not
   * cost a reconnection, and two subscriptions to one game would fetch everything twice.
   */
  const listeners = new Set<() => void>()

  /** Listen for "this game moved". Returns the way to stop. */
  function onMoved(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Which seat is ours, as the server works it out from the token we sent. */
  const mySeat = computed(() => game.value?.you ?? null)

  let watcher: HeadWatch | null = null
  /** Rising, so an answer that arrives after a newer request has overtaken it can be dropped. */
  let request = 0

  /**
   * Fetch the game and put it in the store.
   *
   * The **only** way `game` changes. Late answers are discarded by token rather than by cancelling
   * the request: two loads can be in flight when a socket message lands during a poll, and the
   * older one finishing second would otherwise put a stale game on screen.
   */
  async function loadGame(gameId = id.value): Promise<void> {
    if (!gameId) return
    const mine = ++request
    if (!game.value) loading.value = true

    try {
      const loaded = await getGame(gameId, seatToken(gameId))
      if (mine !== request) return
      game.value = loaded
      loadingError.value = null
      routeForStatus(loaded)
    } catch (error) {
      if (mine !== request) return
      loadingError.value = error instanceof ApiError ? error.message : 'Cannot reach the table.'
    } finally {
      if (mine === request) loading.value = false
    }
  }

  /**
   * Take a seat, and remember the token that proves it.
   *
   * The store reloads rather than trusting the claim's own copy of the game: the seat is stored
   * first, so the reload is the first request that carries the token and therefore the first answer
   * that knows which seat is ours.
   */
  async function join(name: string): Promise<void> {
    const gameId = id.value
    if (!gameId) return
    const claim = await joinGame(gameId, name)
    rememberSeat(gameId, { seat: claim.seat, token: claim.token })
    await loadGame(gameId)
  }

  /** Send a client to the screen its game is actually on. */
  function routeForStatus(loaded: GameView): void {
    const path = router.currentRoute.value.path
    const wanted = loaded.status === 'waiting' ? '/join' : '/game'
    if (path !== '/join' && path !== '/game') return
    if (path === wanted) return
    void router.replace({ path: wanted, query: { id: loaded.id } })
  }

  function stopWatching(): void {
    watcher?.stop()
    watcher = null
  }

  function clear(): void {
    request++
    stopWatching()
    game.value = null
    loadingError.value = null
    loading.value = false
  }

  /**
   * Follow the route.
   *
   * `immediate`, because arriving at `/game?id=…` directly — a share link, a refresh — is the
   * ordinary case rather than the exception, and there is no navigation after it to react to.
   */
  watch(
    () => {
      const query = router.currentRoute.value.query.id
      return typeof query === 'string' ? query : ''
    },
    (next) => { id.value = next },
    { immediate: true },
  )

  watch(id, (gameId) => {
    clear()
    if (!gameId) return
    void loadGame(gameId)
    /*
     * Compare rather than trust. The socket says how far the game has moved; if that is no further
     * than what is already here — a duplicate, or our own write coming back to us — there is nothing
     * to fetch. A poll tick carries no number and always looks, which is the backstop's whole job:
     * a socket that is open but silently broken looks exactly like a quiet game.
     */
    watcher = watchHead(gameId, (seq) => {
      /*
       * The listeners are told **whatever the number says**, and the game is reloaded only when the
       * number is new. They are two different questions: the game row's `seq` moves on every write,
       * including a turn — but a turn is fetched from the log rather than from the game, and a client
       * that already saw the row would otherwise never go and look for the commands behind it.
       */
      for (const listener of listeners) listener()
      if (seq !== null && game.value && seq <= game.value.seq) return
      void loadGame(gameId)
    })
  }, { immediate: true })

  return { id, game, loadingError, loading, mySeat, loadGame, join, clear, onMoved }
})
