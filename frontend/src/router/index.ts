import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { readSavedGame } from '@/composables/useSavedGames'

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
     * Turn away an unknown game before its chunk loads.
     *
     * GameView pulls in three.js — around 870 kB — so guarding inside the component means
     * downloading and parsing all of it just to bounce straight back to the menu, which took
     * over two seconds. Deciding here costs one localStorage read and fetches nothing.
     */
    beforeEnter: to => {
      const id = typeof to.query.id === 'string' ? to.query.id : ''
      return readSavedGame(id) ? true : { path: '/' }
    },
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
