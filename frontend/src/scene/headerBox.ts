import { ref, type Ref } from 'vue'
import { SOURCE_HEADER_GAP_PX, SOURCE_TOP_PX } from './constants'

/**
 * Where the game header ends, measured rather than assumed.
 *
 * The source column starts below the header, and for a long time that was a constant — fine until the
 * header changes height, which it does constantly: it wraps to two rows on a narrow screen, and to
 * three when the scoring panel is closed and its strip moves up into it. Every value chosen for one of
 * those states was wrong in another, and the overlap grew each time the header gained anything: 18px,
 * then 54px after the type scale, then 70px when its icons went from 24 to 40.
 *
 * **The bottom edge, not the height.** The two differ by the header's own `top: 16px`, and reading the
 * edge means the column never has to know that number — move the header and the column follows with
 * no edit here.
 *
 * A module-level ref rather than a prop, for the same reason as `sourceScroll.ts`: the header is DOM
 * and the column is drawn inside `<TresCanvas>`, so the two cannot pass values down a tree they do not
 * share.
 */

/**
 * Seeded so the first frame has a sane answer.
 *
 * `ResizeObserver` fires almost immediately, but "almost" is still a frame in which the column would
 * otherwise be laid out against zero and start at the very top of the screen.
 */
export const headerBottom: Ref<number> = ref(SOURCE_TOP_PX - SOURCE_HEADER_GAP_PX)

/**
 * Watch an element as the header. Returns the function to stop watching.
 *
 * `ResizeObserver` rather than a `watch` on anything: the header's height is decided by **wrapping**,
 * which depends on its own content, the font and the viewport all at once. There is no single reactive
 * value to observe, so measuring is the only honest answer.
 *
 * The callback reads `getBoundingClientRect()` rather than the observer's `contentRect`, because that
 * reports a size in the element's own box while what the column needs is where the element *ends* on
 * the page.
 */
export function measureHeader(element: HTMLElement): () => void {
  const read = (): void => {
    headerBottom.value = element.getBoundingClientRect().bottom
  }
  const observer = new ResizeObserver(read)
  observer.observe(element)
  read()
  return () => {
    observer.disconnect()
  }
}

/** Forget the measurement, on leaving the game, so the next one starts from the seed. */
export function resetHeaderBox(): void {
  headerBottom.value = SOURCE_TOP_PX - SOURCE_HEADER_GAP_PX
}
