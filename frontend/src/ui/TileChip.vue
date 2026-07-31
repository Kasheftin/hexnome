<script setup lang="ts">
/**
 * A tile at label size: a small pointy-top hexagon carrying a symbol, for use in prose and lists.
 *
 * **Sized by the same rules the 3D tile is** — the per-value `SYMBOL_SCALE` and `SYMBOL_OFFSET_UP` the
 * art is tuned against. That is the whole reason this is a component rather than a few lines of CSS
 * repeated where needed: the sizing has already drifted once, when the action bar drew every symbol at
 * a flat 13px while the board used the tuned scales, so the same tile read differently depending on
 * where you looked at it. A third copy is where it drifts again.
 *
 * Colour and value are **independent and both optional**, because not everything a chip stands for is
 * a whole tile. A scoring target is a colour *or* a value, never both:
 *
 * - both — an ordinary tile;
 * - colour only — a plain swatch in the shape of a tile;
 * - value only — the symbol on neutral slate, for "any tile of this value".
 *
 * The one thing that cannot be mirrored exactly is the fit. `createSymbolPlane` fits by the image's
 * bounding-box **diagonal**; CSS `object-fit: contain` fits by its longer side. So the box below is the
 * square whose diagonal matches the 3D fit radius — right for a square image, a hair generous for a
 * tall one. At 20px that is sub-pixel; what matters is that both follow the same tuning.
 */
import { computed } from 'vue'
import {
  HEX_SIZE,
  STEM_SYMBOL_OFFSET_UP,
  STEM_SYMBOL_SCALE,
  STEM_TEXTURE_URL,
  SYMBOL_FIT,
  SYMBOL_TEXTURE_URLS,
  TILE_COLORS,
  TILE_SIZE,
  symbolOffsetUpFor,
  symbolScaleFor,
} from '@/scene/constants'

const props = defineProps<{
  /** Palette index. Omit for a chip that stands for a value whatever its colour. */
  color?: number
  /** 1–6. Omit for a chip that stands for a colour whatever its value. */
  value?: number
  /** Ring it, the way the bar marks a plate: it costs a bay rather than a tile slot. */
  plate?: boolean
  /** A stem instead of a tile — round, carrying the coin's own emblem. */
  stem?: boolean
}>()

/** Matches `.chip` below. Pointy-top, so the height is the 2/√3 taller one. */
const CHIP_WIDTH_PX = 20
const CHIP_HEIGHT_PX = 23

/** The chip is one tile wide, and a pointy-top hex's width is twice its apothem. */
const CHIP_APOTHEM_PX = CHIP_WIDTH_PX / 2
/** What one world unit of `HEX_SIZE` is worth in chip pixels, for the vertical nudge. */
const PX_PER_HEX_SIZE = CHIP_HEIGHT_PX / (2 * (TILE_SIZE / HEX_SIZE))

function boxFor(fitRadiusPx: number): string {
  return `${((fitRadiusPx * 2) / Math.SQRT2).toFixed(2)}px`
}

function liftPx(px: number): string {
  return px === 0 ? 'none' : `translateY(${(-px).toFixed(2)}px)`
}

/**
 * A stem is **sized to the row, not to `STEM_RADIUS`.**
 *
 * On the table a coin is deliberately smaller than the tile it displaces, but a chip is a label in a
 * line of labels: matching the tile chip's height puts them on one baseline and gives them equal
 * weight. Scaled down it just looked like the lesser item, which is not what it is.
 */
const STEM_CHIP_PX = CHIP_HEIGHT_PX

const source = computed(() => {
  if (props.stem) return STEM_TEXTURE_URL
  if (props.value === undefined) return ''
  const index = Math.min(SYMBOL_TEXTURE_URLS.length, Math.max(1, props.value)) - 1
  return SYMBOL_TEXTURE_URLS[index] ?? ''
})

/** Neutral slate when there is no colour: the chip then stands for a value, not for a tile. */
const shape = computed(() => {
  if (props.stem) {
    return { width: `${STEM_CHIP_PX.toFixed(2)}px`, height: `${STEM_CHIP_PX.toFixed(2)}px` }
  }
  return { background: props.color === undefined ? '#2f333c' : TILE_COLORS[props.color]?.hex ?? '#888' }
})

const symbol = computed(() => {
  if (props.stem) {
    const radius = STEM_CHIP_PX / 2
    const box = boxFor(radius * STEM_SYMBOL_SCALE)
    return { width: box, height: box, transform: liftPx(STEM_SYMBOL_OFFSET_UP * radius) }
  }
  const value = props.value ?? 1
  const box = boxFor(CHIP_APOTHEM_PX * SYMBOL_FIT * symbolScaleFor(value))
  // A tile's nudge is in fractions of HEX_SIZE, so it converts through the chip's own scale.
  return { width: box, height: box, transform: liftPx(symbolOffsetUpFor(value) * PX_PER_HEX_SIZE) }
})
</script>

<template>
  <span
    class="chip"
    :class="{ 'chip-plate': props.plate, 'chip-stem': props.stem }"
    :style="shape"
  >
    <img
      v-if="source"
      :src="source"
      :style="symbol"
      alt=""
    >
  </span>
</template>

<style scoped>
/* A hexagon, pointy-top, matching the tiles it stands for. */
.chip {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 23px;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

/* Size and vertical nudge are per value and come from the script. */
.chip img {
  object-fit: contain;
}

/*
 * A plate is drafted as its token, so its chip shows the same hexagon — ringed, because taking a plate
 * costs a bay rather than a tile slot and the player needs to see that at a glance when space is tight.
 */
.chip-plate {
  outline: 2px solid #b99b58;
  outline-offset: 1px;
}

/*
 * A stem's chip is the coin: round among the hexagons, carrying the same emblem the 3D coin does.
 *
 * The metal stays a gradient rather than a flat fill, because the emblem art is masked to a circle and
 * the rim showing around it is what makes the chip read as a coin rather than a sticker.
 */
.chip-stem {
  clip-path: none;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d8b25e, #7a6a3c);
}
</style>
