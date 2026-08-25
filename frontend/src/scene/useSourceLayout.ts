import { useTresContext } from '@tresjs/core'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { DrawerShape } from './drawerLayout'
import { createSourceLayout, type SourceLayout } from './sourceLayout'
import { scrollTop } from './sourceScroll'

/**
 * The shared source's screen-space layout, recomputed when the canvas resizes or the column scrolls.
 *
 * Shared by everything that draws or hit-tests the column, so the visible lots and the drop targets
 * are guaranteed to be the same rectangles.
 */
export function useSourceLayout(
  lots: MaybeRefOrGetter<number>,
  drawer: () => DrawerShape,
): ComputedRef<SourceLayout> {
  const { sizes } = useTresContext()
  return computed(() => createSourceLayout(
    sizes.width.value,
    sizes.height.value,
    toValue(lots),
    drawer(),
    scrollTop.value,
  ))
}
