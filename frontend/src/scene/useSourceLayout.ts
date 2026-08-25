import { useTresContext } from '@tresjs/core'
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { DrawerShape } from './drawerLayout'
import { SOURCE_HEADER_GAP_PX } from './constants'
import { headerBottom } from './headerBox'
import { createSourceLayout, type SourceLayout } from './sourceLayout'
import { scrollTop } from './sourceScroll'

/**
 * The shared source's screen-space layout, recomputed when the canvas resizes, the column scrolls, or
 * **the header changes height** — which it does whenever it wraps, and whenever the scoring strip
 * moves in or out of it.
 *
 * Shared by everything that draws or hit-tests the column, so the visible lots and the drop targets
 * are guaranteed to be the same rectangles.
 */
export function useSourceLayout(
  lots: MaybeRefOrGetter<number>,
  drawer: () => DrawerShape,
  /** How many lots hold anything. Defaults to the capacity, which is every lot. */
  rows: MaybeRefOrGetter<number> = lots,
): ComputedRef<SourceLayout> {
  const { sizes } = useTresContext()
  return computed(() => createSourceLayout(
    sizes.width.value,
    sizes.height.value,
    toValue(lots),
    drawer(),
    scrollTop.value,
    headerBottom.value + SOURCE_HEADER_GAP_PX,
    toValue(rows),
  ))
}
