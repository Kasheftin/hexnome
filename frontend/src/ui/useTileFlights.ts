/**
 * Tiles flying from a board diagram into a scoresheet row.
 *
 * Shared by the round reveal and the final scoresheet, which differ in *what* they count — single
 * tiles against whole connected groups — but not at all in how a copy of a tile crosses the screen.
 *
 * **A copy flies; the board keeps its tile.** A tile is paid for by more than one row, so one that
 * left and came back would read as a bug rather than as the rule.
 *
 * The layer itself is rendered by `TileFlights.vue`, which teleports it to `body`. That is not
 * cosmetic: `.chrome-panel` has a `backdrop-filter`, making it a containing block for fixed
 * positioning, and the rows list scrolls — either would clip a tile in mid-air.
 */
import { shallowRef, type ShallowRef } from 'vue'

/** How long a tile takes to cross, and how far apart the members of one group set off. */
export const FLIGHT_MS = 300
export const GROUP_STAGGER_MS = 70

export interface Flyer {
  readonly id: number
  /** Identifies the slot being flown to, so the caller can reveal it on arrival. */
  readonly key: string
  readonly color: number
  readonly value: number
  readonly from: DOMRect
  readonly to: DOMRect
  readonly delay: number
  /** A little larger on take-off — used when this tile has already scored somewhere else. */
  readonly emphasise: boolean
}

export interface FlightRequest {
  readonly key: string
  readonly color: number
  readonly value: number
  readonly from: DOMRect
  readonly to: DOMRect
  readonly delay?: number
  readonly emphasise?: boolean
}

export interface TileFlights {
  readonly flyers: ShallowRef<readonly Flyer[]>
  /** Slots with something still in the air, so a caller can hold their chips invisible. */
  readonly pending: ShallowRef<ReadonlySet<string>>
  send(request: FlightRequest): void
  /** Called by the template ref once Vue has put a flyer in the document. */
  launch(el: Element | null, flyer: Flyer): void
  /** Cancel everything in the air. Safe to call twice, and required on unmount and on skip. */
  clear(): void
}

/**
 * @param onLand fired once per flight, with the slot's key. The caller owns what that means — a chip
 * becoming visible, a counter moving — because the two reveals count different things.
 */
export function useTileFlights(onLand: (key: string) => void): TileFlights {
  const flyers = shallowRef<readonly Flyer[]>([])
  const pending = shallowRef<ReadonlySet<string>>(new Set())
  const launched = new Set<number>()
  const animations = new Set<Animation>()
  let nextId = 0

  function send(request: FlightRequest): void {
    const next = new Set(pending.value)
    next.add(request.key)
    pending.value = next
    flyers.value = [...flyers.value, {
      id: nextId++,
      key: request.key,
      color: request.color,
      value: request.value,
      from: request.from,
      to: request.to,
      delay: request.delay ?? 0,
      emphasise: request.emphasise ?? false,
    }]
  }

  function land(flyer: Flyer): void {
    const next = new Set(pending.value)
    next.delete(flyer.key)
    pending.value = next
    onLand(flyer.key)
    flyers.value = flyers.value.filter(other => other.id !== flyer.id)
  }

  function launch(el: Element | null, flyer: Flyer): void {
    if (!(el instanceof HTMLElement) || launched.has(flyer.id)) return
    launched.add(flyer.id)

    /*
     * FLIP, applied to the copy rather than to the chip: the flyer is created *at its destination* and
     * animated from an inverted transform. The landing is then pixel-exact and only the take-off
     * approximates, which is the right way round — nobody studies a tile in motion.
     */
    const dx = flyer.from.left - flyer.to.left
    const dy = flyer.from.top - flyer.to.top
    const ratio = flyer.to.width > 0 ? flyer.from.width / flyer.to.width : 1
    const scale = ratio * (flyer.emphasise ? 1.15 : 1)

    const animation = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.9 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: FLIGHT_MS, delay: flyer.delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'backwards' },
    )
    animations.add(animation)

    // `finished` rejects with AbortError when cancelled — which skip does, to every flight at once.
    animation.finished
      .then(() => {
        animations.delete(animation)
        land(flyer)
      })
      .catch(() => {})
  }

  function clear(): void {
    for (const animation of animations) animation.cancel()
    animations.clear()
    flyers.value = []
    pending.value = new Set()
  }

  return { flyers, pending, send, launch, clear }
}
