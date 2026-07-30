<script setup lang="ts">
/**
 * The board backdrop: dark slate with a faint honeycomb, drawn procedurally in a
 * fragment shader on one large plane.
 *
 * A shader rather than geometry because the grid has to hold a constant on-screen
 * line width across the whole zoom range. `fwidth` gives the world-space size of
 * one pixel at this fragment, so the line width is expressed in pixels and stays
 * crisp when zoomed out — which neither thousands of outline meshes nor a tiling
 * texture can manage (the texture goes soft in its mips).
 *
 * The hex maths here mirrors src/game/hex.ts. GLSL cannot import it, so the
 * duplication is unavoidable: change one, change the other. The TypeScript side
 * is the one with tests.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  Color,
  DoubleSide,
  Euler,
  Vector2,
  Vector3,
  type OrthographicCamera,
  type ShaderMaterial,
} from 'three'
import { shallowRef } from 'vue'
import { boardShadow } from './boardShadow'
import { COLORS, HEX_SIZE } from './constants'
import { unitsPerPixel } from './screenProjection'

const PLANE_SIZE = 400

/** Lay the plane flat in XZ. TresJS v5 prop types want three instances, not arrays. */
const FLOOR_ROTATION = new Euler(-Math.PI / 2, 0, 0)
const FLOOR_POSITION = new Vector3(0, 0, 0)

const materialRef = shallowRef<ShaderMaterial | null>(null)

const uniforms = {
  uHexSize: { value: HEX_SIZE },
  uBgColor: { value: new Color(COLORS.boardBackground) },
  uLineColor: { value: new Color(COLORS.gridLine) },
  /** Grid line width in screen pixels. Floored at 2 by the shader's solid-core clamp. */
  uLinePx: { value: 2.5 },
  /**
   * World size of one screen pixel, supplied exactly rather than estimated in the shader.
   * See the note on `aa` in the fragment shader — this is what stops lines dropping out.
   */
  uUnitsPerPixel: { value: 0.017 },
  /**
   * World radius over which the grid fades out. Comfortably beyond the plated board
   * (~46 world units to a corner) so no fade ring can appear inside the playfield.
   */
  uFadeRadius: { value: 120 },
  uShadowCenter: { value: new Vector2() },
  uShadowRadius: { value: boardShadow.radius },
  uShadowStrength: { value: boardShadow.strength },
}

const vertexShader = /* glsl */ `
varying vec3 vWorld;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorld = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const fragmentShader = /* glsl */ `
precision highp float;

// The tone-mapping and colour-space *declarations* are injected into every
// ShaderMaterial program by three itself — including them here too is a redefinition
// error that silently fails the whole fragment shader. Only the statement-level
// includes at the end of main() belong to us.

varying vec3 vWorld;

uniform float uHexSize;
uniform vec3 uBgColor;
uniform vec3 uLineColor;
uniform float uLinePx;
uniform float uUnitsPerPixel;
uniform float uFadeRadius;
uniform vec2 uShadowCenter;
uniform float uShadowRadius;
uniform float uShadowStrength;

const float SQRT3 = 1.7320508075688772;

// Mirrors axialRound() in src/game/hex.ts: round in cube space and discard the
// component that moved furthest. Rounding q and r independently gives a rhombus,
// not a hexagon, and the seams are visible.
vec2 axialRound(vec2 f) {
  float x = f.x;
  float z = f.y;
  float y = -x - z;

  float rx = floor(x + 0.5);
  float ry = floor(y + 0.5);
  float rz = floor(z + 0.5);

  float dx = abs(rx - x);
  float dy = abs(ry - y);
  float dz = abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return vec2(rx, rz);
}

vec2 axialToWorld(vec2 h) {
  return vec2(uHexSize * SQRT3 * (h.x + h.y * 0.5), uHexSize * 1.5 * h.y);
}

void main() {
  vec2 p = vWorld.xz;

  vec2 frac = vec2(
    (SQRT3 * p.x - p.y) / (3.0 * uHexSize),
    (2.0 * p.y) / (3.0 * uHexSize)
  );
  vec2 centre = axialToWorld(axialRound(frac));
  vec2 v = p - centre;

  // Distance to the cell boundary. A pointy-top hex has edge normals pointing at
  // its neighbours: 0, +60 and -60 degrees.
  float m = abs(v.x);
  m = max(m, abs(v.x * 0.5 + v.y * (SQRT3 * 0.5)));
  m = max(m, abs(v.x * 0.5 - v.y * (SQRT3 * 0.5)));
  float d = uHexSize * SQRT3 * 0.5 - m;

  // One pixel in world units.
  //
  // Passed in as a uniform, NOT taken as fwidth(d) — and that is the fix for lines dropping
  // out at particular zooms. d is the distance to the *current* cell's boundary, and
  // axialRound makes it fold there: across a boundary the values run ...0.05, 0 | 0.05...
  // For a 2x2 quad straddling a boundary the two sides are near-equal, so dFdx(d) collapses to
  // about zero, fwidth with it, and the half-width along with it — leaving smoothstep with a
  // zero-width range that returns 1 and erases the line completely. Whether a quad straddles
  // that way depends on sub-pixel phase, which is why whole families of lines vanished at some
  // zoom levels and not others.
  //
  // There is no need to estimate it at all here: the board camera is orthographic and
  // axis-aligned, so one pixel is the same world distance everywhere on the plane.
  float aa = uUnitsPerPixel;

  // Half-width in world units, floored at one pixel so the line always has a fully covered
  // core. Without that floor the falloff starts at d = 0, so a line is full strength only
  // exactly on the boundary and fades to nothing within uLinePx of it.
  float halfWidth = max(uLinePx * 0.5, 1.0) * aa;
  float line = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d);

  float fade = 1.0 - smoothstep(uFadeRadius * 0.4, uFadeRadius, length(p));

  vec3 col = mix(uBgColor, uLineColor, line * fade);

  float shadow = 1.0 - smoothstep(0.0, uShadowRadius, length(p - uShadowCenter));
  col *= 1.0 - shadow * uShadowStrength;

  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const { camera, sizes } = useTresContext()
const { onBeforeRender } = useLoop()

onBeforeRender(() => {
  const material = materialRef.value
  if (!material) return
  const u = material.uniforms
  u.uShadowCenter?.value.copy(boardShadow.center)
  if (u.uShadowRadius) u.uShadowRadius.value = boardShadow.radius
  if (u.uShadowStrength) u.uShadowStrength.value = boardShadow.strength

  const cam = camera.activeCamera.value as OrthographicCamera | undefined
  if (cam?.isOrthographicCamera && u.uUnitsPerPixel) {
    u.uUnitsPerPixel.value = unitsPerPixel(cam, sizes.height.value)
  }
})
</script>

<template>
  <TresMesh
    :rotation="FLOOR_ROTATION"
    :position="FLOOR_POSITION"
  >
    <TresPlaneGeometry :args="[PLANE_SIZE, PLANE_SIZE]" />
    <TresShaderMaterial
      ref="materialRef"
      :vertex-shader="vertexShader"
      :fragment-shader="fragmentShader"
      :uniforms="uniforms"
      :side="DoubleSide"
    />
  </TresMesh>
</template>
