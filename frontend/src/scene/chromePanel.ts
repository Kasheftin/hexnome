/**
 * The `.chrome-panel` look, for panels that live in the canvas instead of the DOM.
 *
 * The header and the help card are DOM, so they get their 1px border, 4px radius and translucent
 * slate straight from CSS. The drawer tray and the plate bays cannot: they sit *under* live 3D
 * tiles, so an opaque DOM panel would cover its own contents (see DrawerChrome.vue). They are
 * quads in the scene, and this is what makes them read as the same family of panel.
 *
 * ## Why a shader rather than four thin quads
 *
 * The border has to be **1 CSS pixel at every zoom level**, and the corners have to be rounded to
 * match. Border quads scaled per-frame would work for the edges but not the radius, and would need
 * their own zoom compensation.
 *
 * Instead the whole panel is one quad and the shader works in **pixel space**: `uSizePx` is the
 * panel's size in CSS pixels, so a rounded-rect distance field built from it is measured in CSS
 * pixels too. The mesh's world scale and `uSizePx` both come from the same layout, so zooming
 * changes the mesh's world size and leaves pixel space untouched — the border stays exactly 1 CSS
 * pixel with no uniform to update. This is the same trick as the grid lines, without even needing
 * `unitsPerPixel`.
 *
 * The distance field does fold (`abs(p)`), and `fwidth` across a fold is exactly what broke the
 * grid lines. It is safe here: the folds run down the panel's centre lines, where the field is far
 * inside and the smoothstep has long since saturated. Nothing is antialiased anywhere near them.
 */
import { Color, DoubleSide, ShaderMaterial, Vector2 } from 'three'
import { CHROME_PANEL, CHROME_PANEL_TONES, type ChromePanelTone } from './constants'

/*
 * Clipping is opt-in for a ShaderMaterial and does nothing without these chunks.
 *
 * Unlike the tone-mapping and colour-space *declarations*, which three injects into every
 * ShaderMaterial program, the clipping varying and uniform are not supplied — three only defines
 * `NUM_CLIPPING_PLANES` and expects the shader to have asked for the rest. So a panel with
 * `clippingPlanes` set but no chunks clips nothing at all, silently. The source column's bays scroll,
 * and that is what needs them; every other panel leaves `clipping` false and compiles these to nothing.
 *
 * `mvPosition` is named, not inlined, because `clipping_planes_vertex` reads exactly that variable.
 */
const vertexShader = /* glsl */ `
#include <clipping_planes_pars_vertex>

varying vec2 vPanelUv;

void main() {
  vPanelUv = uv;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`

const fragmentShader = /* glsl */ `
precision highp float;

// Tone-mapping and colour-space *declarations* are injected into every ShaderMaterial program by
// three itself. Re-declaring them here is a redefinition error that silently fails the whole
// shader — only the statement-level includes at the end of main() belong to us.

#include <clipping_planes_pars_fragment>

varying vec2 vPanelUv;

uniform vec2 uSizePx;
uniform float uRadiusPx;
uniform float uBorderPx;
uniform vec3 uFill;
uniform float uFillOpacity;
uniform vec3 uBorder;
uniform float uBorderOpacity;

/**
 * Signed distance to a rounded rectangle, in the same units as p and half.
 *
 * The min(max(q.x, q.y), 0.0) term is what makes it correct inside the shape as well as outside;
 * without it the interior distance is wrong near the edges and a 1px border comes out uneven
 * along the straights.
 *
 * (No backticks in here — this is a JS template literal, and one would end it.)
 */
// Not named "half": that is a reserved word in GLSL ES and will not compile.
float roundedRectDistance(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - (halfSize - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  // First in main(): this chunk discards, and there is no point shading a fragment that is cut away.
  #include <clipping_planes_fragment>

  vec2 halfSize = uSizePx * 0.5;
  vec2 p = (vPanelUv - 0.5) * uSizePx;

  // Never let the radius exceed what the box can hold, or the corners invert on a thin bay.
  float radius = min(uRadiusPx, min(halfSize.x, halfSize.y));
  float d = roundedRectDistance(p, halfSize, radius);

  // Analytic coverage, not smoothstep. d is in CSS pixels and fwidth(d) is how much of it one
  // device pixel spans, so this blends across exactly one device pixel — crisp along the
  // straights, smooth around the corners, and the total energy of a 1px border is preserved.
  //
  // smoothstep(-aa, aa, d) was wrong here: it blends over 2*aa, which smeared the border across
  // two rows at 40% of the intended brightness. Visible as a soft grey line next to the DOM
  // panels' hard one.
  float aa = max(fwidth(d), 0.0001);

  float outer = clamp(0.5 - d / aa, 0.0, 1.0);
  float inner = clamp(0.5 - (d + uBorderPx) / aa, 0.0, 1.0);
  float band = clamp(outer - inner, 0.0, 1.0);

  // Fill and border cover disjoint regions, so their alphas add rather than compositing.
  float fillAlpha = uFillOpacity * inner;
  float borderAlpha = uBorderOpacity * band;
  float alpha = fillAlpha + borderAlpha;
  if (alpha <= 0.0) discard;

  gl_FragColor = vec4((uFill * fillAlpha + uBorder * borderAlpha) / alpha, alpha);

  // colorspace_fragment but deliberately NOT tonemapping_fragment.
  //
  // Tone mapping exists to fit scene radiance into a display range, and the canvas is set to ACES.
  // Chrome is not scene radiance — it is UI that happens to be drawn in the canvas, and the DOM
  // panels it has to match are not tone-mapped at all. Running it through ACES crushed the fill to
  // RGB(5,6,9) against the DOM panel's (17,18,23) — the same nominal colour, three times darker.
  //
  // Skipping it means the colours here land exactly where CSS would put them, and alpha blends in
  // the sRGB framebuffer just as it does for a DOM element.
  #include <colorspace_fragment>
}
`

export interface ChromePanelOptions {
  /** Corner radius in CSS pixels. Defaults to the CSS panel's 4px. */
  radiusPx?: number
  /**
   * Let this panel be cut by `clippingPlanes`. Off unless asked for, because it costs a shader
   * branch and only the source column's scrolling bays need it.
   */
  clipping?: boolean
  /** Fill colour and opacity. Defaults to the CSS panel's translucent slate. */
  fill?: string
  fillOpacity?: number
}

/**
 * A material for one screen-space panel.
 *
 * One material per panel rather than one shared: `uSizePx` differs between the tray and the bays,
 * and the bays differ from each other only by position, so they can share. Call
 * {@link setChromePanelSize} each frame with the panel's pixel size.
 */
export function createChromePanelMaterial(options: ChromePanelOptions = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    side: DoubleSide,
    clipping: options.clipping ?? false,
    uniforms: {
      // Replaced on the first frame; a non-zero placeholder keeps the radius clamp sane if a
      // frame ever renders before the layout is measured.
      uSizePx: { value: new Vector2(1, 1) },
      uRadiusPx: { value: options.radiusPx ?? CHROME_PANEL.radiusPx },
      uBorderPx: { value: CHROME_PANEL.borderPx },
      uFill: { value: new Color(options.fill ?? CHROME_PANEL.fill) },
      uFillOpacity: { value: options.fillOpacity ?? CHROME_PANEL.fillOpacity },
      uBorder: { value: new Color(CHROME_PANEL.border) },
      uBorderOpacity: { value: CHROME_PANEL.borderOpacity },
    },
  })
}

export interface PanelRect {
  /** Centre in screen pixels. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Snap a panel's screen rectangle to whole pixels.
 *
 * Without this the border is *correct but soft*: a 1px line whose edge falls at y = 517.6 splits
 * across rows 517 and 518 at partial coverage, which reads as a 2px grey smudge beside the DOM
 * panels' hard 1px line. CSS never has this problem because it lays panels out on integer pixels
 * and snaps borders itself.
 *
 * Rounding the left/top edge rather than the centre is what matters: with an integer origin and an
 * integer size, both edges land on the pixel grid whether the size is odd or even.
 */
export function snapPanelRect(centreX: number, centreY: number, widthPx: number, heightPx: number): PanelRect {
  const width = Math.max(1, Math.round(widthPx))
  const height = Math.max(1, Math.round(heightPx))
  const left = Math.round(centreX - width / 2)
  const top = Math.round(centreY - height / 2)
  return { x: left + width / 2, y: top + height / 2, width, height }
}

/** Tell a panel material how large it is on screen, in CSS pixels. */
export function setChromePanelSize(material: ShaderMaterial, widthPx: number, heightPx: number): void {
  const size = material.uniforms.uSizePx?.value as Vector2 | undefined
  size?.set(widthPx, heightPx)
}

/**
 * Dim a panel, rest it, or light it up — see {@link CHROME_PANEL_TONES}.
 *
 * A uniform swap rather than a material swap, so a panel changes state without rebuilding its
 * program or losing the pixel size it was told last frame. Cheap enough to call from a watcher on
 * every phase change; it does not need to be in the render loop, and should not be, since nothing
 * about the tone depends on the camera.
 */
export function setChromePanelTone(material: ShaderMaterial, tone: ChromePanelTone): void {
  const values = CHROME_PANEL_TONES[tone]
  ;(material.uniforms.uBorder?.value as Color | undefined)?.set(values.border)
  if (material.uniforms.uBorderOpacity) material.uniforms.uBorderOpacity.value = values.borderOpacity
  if (material.uniforms.uFillOpacity) material.uniforms.uFillOpacity.value = values.fillOpacity
}
