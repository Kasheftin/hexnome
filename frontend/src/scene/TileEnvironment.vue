<script setup lang="ts">
/**
 * Bakes the studio environment into a cubemap and hands it to the scene.
 *
 * Without an environment, `clearcoat` has nothing to reflect and the tiles render
 * flat and plastic — the material is not the problem, the empty environment is.
 *
 * Why a hand-built studio rather than three's `RoomEnvironment`: see
 * scene/studioEnvironment.ts. Short version — a flat top face under an orthographic
 * top-down camera reflects whatever sits directly overhead, uniformly, so a bright
 * ceiling turns every tile white regardless of its colour.
 *
 * `scene.environment` only affects PBR materials, so the unlit board plates and the
 * raw-shader backdrop are untouched.
 */
import { useTresContext } from '@tresjs/core'
import { PMREMGenerator, type Texture, type WebGLRenderer } from 'three'
import { onBeforeUnmount, onMounted } from 'vue'
import { TILE_ENV_INTENSITY } from './constants'
import { createStudioEnvironment, disposeStudioEnvironment } from './studioEnvironment'

const { scene, renderer } = useTresContext()

let envMap: Texture | null = null

onMounted(() => {
  // TresJS types `instance` as the union of WebGL and WebGPU renderers; PMREM needs
  // the WebGL one, which is what <TresCanvas> creates unless told otherwise.
  const gl = renderer.instance as WebGLRenderer | undefined
  if (!gl) return

  const pmrem = new PMREMGenerator(gl)
  const studio = createStudioEnvironment()
  // A little blur so the panels read as soft light rather than legible rectangles.
  envMap = pmrem.fromScene(studio, 0.03).texture

  scene.value.environment = envMap
  scene.value.environmentIntensity = TILE_ENV_INTENSITY

  disposeStudioEnvironment(studio)
  pmrem.dispose()
})

onBeforeUnmount(() => {
  if (scene.value?.environment === envMap) scene.value.environment = null
  envMap?.dispose()
  envMap = null
})
</script>

<template>
  <TresGroup />
</template>
