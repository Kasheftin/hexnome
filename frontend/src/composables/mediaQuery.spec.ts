import { afterEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useMediaQuery } from './mediaQuery'

/**
 * jsdom's own `matchMedia` answers false to everything and never changes its mind, so a real one
 * would prove only that the call does not throw. This is a stub that can be made to change, which
 * is the whole behaviour worth having: a query read once at startup would be wrong on the device
 * that gains a pointer, and — more to the point — wrong in devtools until you reloaded.
 */
function fakeMatchMedia(): { flip: (matches: boolean) => void, listeners: number } {
  const lists = new Map<string, { matches: boolean, handlers: Set<(e: MediaQueryListEvent) => void> }>()

  window.matchMedia = ((query: string) => {
    const entry = lists.get(query) ?? { matches: false, handlers: new Set() }
    lists.set(query, entry)
    return {
      get matches() { return entry.matches },
      media: query,
      addEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        entry.handlers.add(handler)
      },
      removeEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        entry.handlers.delete(handler)
      },
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia

  return {
    flip(matches: boolean) {
      for (const entry of lists.values()) {
        entry.matches = matches
        for (const handler of entry.handlers) handler({ matches } as MediaQueryListEvent)
      }
    },
    get listeners() {
      return [...lists.values()].reduce((n, entry) => n + entry.handlers.size, 0)
    },
  }
}

const original = window.matchMedia
afterEach(() => { window.matchMedia = original })

describe('useMediaQuery', () => {
  it('starts at whatever the query already says', () => {
    const media = fakeMatchMedia()
    const scope = effectScope()

    const first = scope.run(() => useMediaQuery('(hover: none)'))!
    expect(first.value).toBe(false)

    media.flip(true)
    const second = scope.run(() => useMediaQuery('(hover: none)'))!
    expect(second.value).toBe(true)

    scope.stop()
  })

  /** The reason it is a ref at all. Without this, devtools emulation needs a reload to take. */
  it('follows the query when it changes', () => {
    const media = fakeMatchMedia()
    const scope = effectScope()
    const hoverless = scope.run(() => useMediaQuery('(hover: none)'))!

    expect(hoverless.value).toBe(false)
    media.flip(true)
    expect(hoverless.value).toBe(true)
    media.flip(false)
    expect(hoverless.value).toBe(false)

    scope.stop()
  })

  /**
   * A leaked listener holds the whole component graph the ref is wired into. GameView is mounted
   * and unmounted on every trip back to the menu, so this is a per-game leak, not a one-off.
   */
  it('lets go of the query when its scope ends', () => {
    const media = fakeMatchMedia()
    const scope = effectScope()
    const hoverless = scope.run(() => useMediaQuery('(hover: none)'))!

    expect(media.listeners).toBe(1)
    scope.stop()
    expect(media.listeners).toBe(0)

    media.flip(true)
    expect(hoverless.value).toBe(false)
  })
})
