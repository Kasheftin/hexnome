import { useTresContext } from '@tresjs/core'
import { computed, type ComputedRef } from 'vue'
import { createDrawerLayout, type DrawerLayout, type DrawerShape } from './drawerLayout'

/**
 * The drawer's screen-space layout, recomputed when the canvas resizes.
 *
 * Shared by everything that draws or hit-tests the drawer, so the visible slots and the
 * drop targets are guaranteed to be the same rectangles.
 */
export function useDrawerLayout(shape: () => DrawerShape): ComputedRef<DrawerLayout> {
  const { sizes } = useTresContext()
  return computed(() => createDrawerLayout(sizes.width.value, sizes.height.value, shape()))
}
