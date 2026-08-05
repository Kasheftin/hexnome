import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/game',
    name: 'game',
    component: () => import('@/views/GameView.vue'),
    /**
     * Only the obviously-missing id is turned away here.
     *
     * There used to be a real check: a localStorage read that bounced an unknown game before
     * three.js — around 870 kB — was fetched to bounce it. Whether a game exists is now the
     * server's answer, and asking a guard to wait on the network would stall the navigation
     * itself. `GameView` is a small chunk that loads the game and only then pulls in the board,
     * so an unknown id costs a request rather than a megabyte.
     */
    beforeEnter: to => (typeof to.query.id === 'string' && to.query.id ? true : { path: '/' }),
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
