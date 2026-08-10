import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Three screens, and no guards.
 *
 * A route used to turn away a game it could not find, by reading localStorage before the component
 * loaded. Games are on the server now, so the answer is a request and a guard cannot wait for one
 * without holding the whole navigation open. The wait belongs where it can be shown: the store loads
 * the game and App.vue renders nothing about it until it has (stores/game.ts).
 *
 * **`/join` and `/game` are one game at two moments**, and which of them a client should be on is
 * the server's answer rather than the link's. Whoever opens a shared `/game?id=…` for a table still
 * filling up is *replaced* onto `/join`, and back again when it starts. That is why the lobby has a
 * route of its own rather than being a screen inside `/game`: when a game starts under a player, the
 * change of screen is a change of URL, which the back button and a refresh both already understand.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/join',
    name: 'join',
    component: () => import('@/views/LobbyView.vue'),
  },
  {
    path: '/game',
    name: 'game',
    component: () => import('@/views/GameView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    redirect: '/',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
