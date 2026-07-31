import { Color, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import {
  ANCHOR_LIFT,
  ANCHOR_OFFSET_UP,
  ANCHOR_RATIO,
  ANCHOR_SCALE,
  ANCHOR_TEXTURE_URLS,
  HEX_SIZE,
  PLATE_CELL_MARK_R,
  PLATE_SOCKET_Y,
} from './constants'
import { createSymbolPlane } from './symbolPlane'

/**
 * The anchor in a plate's centre hole — the emblem that lights up when all six petals are filled.
 *
 * **Two planes, not one texture swap.** Both are built once and only their `visible` flags change, so
 * lighting an anchor costs nothing at the moment it happens: no texture upload, no material
 * recompilation, no chance of a frame showing the wrong art while the new map decodes. It also means
 * the transition is exactly reversible, which matters because enclosure *is* reversible — a
 * provisional placement lights the anchor and cancelling it puts the plate back in the dark.
 *
 * Only a **revealed** plate has an anchor at all. A face-down plate shows its reverse, and drawing an
 * emblem on the back of a card would say the front is visible when it is not.
 */

let loaded: { off: Texture, on: Texture } | null = null
/** Anchors built before the textures arrived, waiting to be filled in. */
const pending: AnchorVisual[] = []

export interface AnchorVisual {
  readonly holder: Group
  off: Mesh | null
  on: Mesh | null
  /** Remembered across a late texture load, so a plate enclosed early still lights up. */
  lit: boolean
  /**
   * Multiplied over the art, or null for the emblem as drawn.
   *
   * Held here rather than applied by the caller for the same reason `lit` is: the meshes do not exist
   * until the textures arrive, so anything set from outside beforehand lands on nothing. Tinting from
   * inside `build` means it happens whenever that is — immediately, or once the load returns.
   */
  readonly tint: Color | null
}

/** Fit radius for the emblem, in world units — the hole it sits in, scaled by the tuning constant. */
const FIT_RADIUS = HEX_SIZE * PLATE_CELL_MARK_R * ANCHOR_SCALE
const OFFSET_UP = HEX_SIZE * PLATE_CELL_MARK_R * ANCHOR_OFFSET_UP

function build(visual: AnchorVisual, textures: { off: Texture, on: Texture }): void {
  const options = {
    fitRadius: FIT_RADIUS,
    y: PLATE_SOCKET_Y + ANCHOR_LIFT,
    offsetUp: OFFSET_UP,
    widen: ANCHOR_RATIO,
  }
  visual.off = createSymbolPlane(textures.off, options)
  visual.on = createSymbolPlane(textures.on, options)
  visual.holder.add(visual.off, visual.on)
  if (visual.tint) {
    for (const mesh of [visual.off, visual.on]) {
      (mesh.material as MeshBasicMaterial).color.copy(visual.tint)
    }
  }
  apply(visual)
}

function apply(visual: AnchorVisual): void {
  if (visual.off) visual.off.visible = !visual.lit
  if (visual.on) visual.on.visible = visual.lit
}

/**
 * Give a plate its anchor. The plate group owns it, so it moves and scales with the plate for free.
 *
 * Textures load once, lazily, and anchors made before they land are filled in afterwards — plates are
 * dealt during setup, well before any image has arrived, and an anchor that missed the load would stay
 * blank for the rest of the game with nothing to explain it. The same shape as the stem coin's loader,
 * for the same reason.
 */
export function attachAnchorVisual(plate: Group, options: { tint?: string } = {}): AnchorVisual {
  const holder = new Group()
  plate.add(holder)
  const visual: AnchorVisual = {
    holder,
    off: null,
    on: null,
    lit: false,
    tint: options.tint === undefined ? null : new Color(options.tint),
  }

  if (loaded) {
    build(visual, loaded)
    return visual
  }

  pending.push(visual)
  if (pending.length === 1) {
    const loader = new TextureLoader()
    void Promise.all([
      new Promise<Texture>((resolve, reject) => {
        loader.load(ANCHOR_TEXTURE_URLS.off, resolve, undefined, reject)
      }),
      new Promise<Texture>((resolve, reject) => {
        loader.load(ANCHOR_TEXTURE_URLS.on, resolve, undefined, reject)
      }),
    ]).then(([off, on]) => {
      for (const texture of [off, on]) {
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 8
      }
      loaded = { off, on }
      for (const waiting of pending) build(waiting, loaded)
      pending.length = 0
    })
  }
  return visual
}

/** Light the anchor, or put it out. Safe to call before the textures have arrived. */
export function showAnchor(visual: AnchorVisual, lit: boolean): void {
  visual.lit = lit
  apply(visual)
}

export function disposeAnchorVisual(visual: AnchorVisual): void {
  const index = pending.indexOf(visual)
  if (index >= 0) pending.splice(index, 1)
  for (const mesh of [visual.off, visual.on]) {
    if (!mesh) continue
    mesh.geometry.dispose()
    ;(mesh.material as { dispose(): void }).dispose()
  }
  visual.holder.parent?.remove(visual.holder)
}

/** Shared textures — call once, when no plates remain. */
export function disposeAnchorAssets(): void {
  loaded?.off.dispose()
  loaded?.on.dispose()
  loaded = null
  pending.length = 0
}
