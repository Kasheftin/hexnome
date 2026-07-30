import { Color, MeshStandardMaterial } from 'three'
import { TILE_COLOR_COUNT } from '@/game/deck'

/**
 * The six tile colours, and the material they share.
 *
 * Colour lives here, not in `src/game/**`. The rules know a tile's colour as an enum
 * member; only the renderer knows what green looks like.
 */

export const TILE_COLORS = [
  { name: 'helix green', hex: '#2F7D52' },
  { name: 'chromosome blue', hex: '#3D6AA8' },
  { name: 'base lilac', hex: '#8B63B5' },
  { name: 'amber', hex: '#D9A32B' },
  { name: 'coral', hex: '#C2543E' },
  { name: 'teal', hex: '#2C8C86' },
] as const

export type TileColorIndex = 0 | 1 | 2 | 3 | 4 | 5

/**
 * The palette must be exactly as long as the rules believe.
 *
 * `game/deck.ts` builds the bags from `TILE_COLOR_COUNT`, so it deals indices 0…5 without ever
 * consulting this list. Shortening the palette would deal tiles with no paint — and
 * `createTileMaterial` falls back to the first colour, so they would silently come out the wrong
 * colour rather than fail. This makes that a typecheck error instead.
 */
const paletteLengthMatchesRules: typeof TILE_COLOR_COUNT = TILE_COLORS.length
void paletteLengthMatchesRules

/**
 * Solid moulded plastic, not glass.
 *
 * `MeshStandardMaterial` with no clearcoat, matching the Azul pieces in
 * `external assets/azul.png`: a saturated solid colour with a soft sheen where the
 * rounded top rim turns toward the light, and no mirror reflection anywhere.
 *
 * An earlier version used `MeshPhysicalMaterial` with `clearcoat: 1`. Under a
 * top-down orthographic camera that put a uniform white specular sheet across the
 * whole flat top face — a green tile measured RGB (248, 248, 247) — because a flat
 * face has one normal and one view direction, so its reflection cannot vary. Dropping
 * clearcoat removes that additive white term entirely and lets the colour read.
 */
export function createTileMaterial(colorIndex: TileColorIndex): MeshStandardMaterial {
  const entry = TILE_COLORS[colorIndex] ?? TILE_COLORS[0]
  return new MeshStandardMaterial({
    color: new Color(entry.hex),
    // Matte enough to stay solid-looking, glossy enough that the rim picks up the
    // studio panels as a soft sheen.
    roughness: 0.45,
    metalness: 0,
  })
}
