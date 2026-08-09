#!/usr/bin/env python3
"""Turn the painted value symbols into game textures.

    python3 scripts/prepare-symbols.py "external assets/tiles2"

Reads `1.png` .. `6.png` from the given directory and writes them over
`frontend/public/textures/symbols/`. Requires Pillow, numpy and scipy.

The canvas is passed through unchanged — same size, same framing — because
`SYMBOL_FIT` and `SYMBOL_SCALE` in scene/constants.ts are tuned against these
frames. Only the alpha channel is rewritten, for two faults the paintings share:

**The outline is opaque black.** It is drawn as a shadow and it should read as
one, but at full alpha it sits on the tile like a sticker: a shadow is something
you see the surface *through*. Dropping the outer band to `SHADOW_ALPHA` lets the
tile colour come through it, so the same texture reads as a magenta shadow on a
magenta tile and an indigo one on indigo.

Which pixels are shadow: **neutral and dark** (the outline is a true grey, around
`(8,8,8)`, while the ornament's own dark parts are warm — a dark brown around
`(49,24,10)` — so chroma separates them cleanly), and **near the silhouette**. The
depth test is what protects the motif's inner linework, which is just as dark and
just as neutral but sits deep inside. It also does the right thing at a hole: the
band around the benzene ring's centre is shadow cast onto the tile you can see
through it, and it gets the same treatment as the outside.

**The alpha is 1-bit and haloed.** The paintings were matted against something
light and then cut with a hard alpha, which left every silhouette both jagged and
rimmed with an opaque near-white line. The rim is not art — what is under it is
the black outline — so it is repainted black, and the alpha then ramps across the
outermost `FADE_PX`, which antialiases the silhouette in the same pass.

Retuning: `SHADOW_ALPHA` is the one knob that matters. 1.0 restores the black
outline, 0.4 is about as faint as still reads as a shadow, 0.6 is the default.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

#: How much of the outline survives at its strongest. The rest is tile showing through.
SHADOW_ALPHA = 0.6
#: Silhouette antialiasing, in pixels of the source canvas.
FADE_PX = 2.5
#: The shadow holds full strength this deep, then returns to opaque by RECOVER_PX.
HOLD_PX = 5.0
RECOVER_PX = 10.0
#: A pixel counts as outline if it is this neutral and this dark.
CHROMA_MAX = 14
LUM_MAX = 90
#: The keying halo: bright, neutral, and within this far of the silhouette.
HALO_PX = 2.0
HALO_LUM_MIN = 85
HALO_CHROMA_MAX = 25

LUMA = np.array([0.2126, 0.7152, 0.0722])

REPO = Path(__file__).resolve().parent.parent
DESTINATION = REPO / "frontend/public/textures/symbols"


def smoothstep(lo: float, hi: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def prepare(source: Path, destination: Path) -> str:
    image = Image.open(source).convert("RGBA")
    pixels = np.array(image.getdata(), dtype=np.uint8)
    pixels = pixels.reshape(image.height, image.width, 4).astype(float)

    rgb = pixels[..., :3]
    lum = rgb @ LUMA
    chroma = rgb.max(axis=2) - rgb.min(axis=2)

    solid = pixels[..., 3] > 127
    # Distance to the nearest transparent pixel — the outside and any hole alike.
    depth = ndimage.distance_transform_edt(solid)

    halo = solid & (depth <= HALO_PX) & (lum > HALO_LUM_MIN) & (chroma < HALO_CHROMA_MAX)
    rgb[halo] = 0.0
    lum = np.where(halo, 0.0, lum)
    chroma = np.where(halo, 0.0, chroma)

    outline = solid & (chroma < CHROMA_MAX) & (lum < LUM_MAX)
    strength = 1.0 - smoothstep(HOLD_PX, RECOVER_PX, depth)
    shade = 1.0 - (1.0 - SHADOW_ALPHA) * np.where(outline, strength, 0.0)
    pixels[..., 3] = np.where(solid, 255.0 * smoothstep(0, FADE_PX, depth) * shade, 0.0)

    Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGBA").save(
        destination, optimize=True
    )
    softened = int((outline & (depth <= HOLD_PX)).sum())
    return (
        f"{source.name}: {image.width}x{image.height}"
        f"  halo {int(halo.sum())} px, shadow {softened} px"
        f"  ({destination.stat().st_size // 1024} KB)"
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <source directory>")
    source = Path(sys.argv[1])
    for value in range(1, 7):
        print(prepare(source / f"{value}.png", DESTINATION / f"{value}.png"))


if __name__ == "__main__":
    main()
