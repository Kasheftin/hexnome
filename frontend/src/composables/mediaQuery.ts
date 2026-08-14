import { onScopeDispose, shallowRef, type Ref } from 'vue'

/**
 * A CSS media query, as a reactive boolean.
 *
 * For the handful of decisions a stylesheet cannot make on its own. Hiding an element is CSS's job
 * and belongs in a `@media` block; deciding whether the element is *rendered at all* is not, and
 * that is what this is for — see `(hover: none)` in GameView, where the buttons in question have no
 * position to be hidden at until something says which bay they belong to.
 *
 * Live rather than read once at startup. A device's capabilities do change under you: an iPad gains
 * a pointer when a trackpad case is attached, and — the one that actually matters day to day —
 * toggling device emulation in devtools flips this without a reload, so what you see while checking
 * a phone layout is what a phone gets.
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const list = window.matchMedia(query)
  const matches = shallowRef(list.matches)

  const onChange = (event: MediaQueryListEvent): void => {
    matches.value = event.matches
  }
  list.addEventListener('change', onChange)

  // Scope rather than component: this then cleans up after itself wherever it is used, including
  // inside a composable that is torn down while its component lives on.
  onScopeDispose(() => list.removeEventListener('change', onChange))

  return matches
}
