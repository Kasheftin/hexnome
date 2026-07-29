import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three'

/**
 * A dark studio for the tiles to reflect: mostly black, with a few bright emissive
 * panels placed deliberately off-axis.
 *
 * This replaces three's `RoomEnvironment`, and the reason is geometric rather than
 * aesthetic. The board camera is orthographic and looks straight down, and a tile's
 * top face is flat — so every point on that face has the same normal *and* the same
 * view direction, which means the environment reflection across it is necessarily
 * **uniform**. No environment map can paint a streak on it.
 *
 * `RoomEnvironment` is a bright white room whose ceiling sits directly overhead,
 * which is precisely the direction a flat top face mirrors into the camera. The
 * result was a flat white sheet over the whole tile: measured RGB (248,248,247) on
 * what should have been green. Dimming it only traded a white tile for a washed-out
 * one, because the reflection stayed uniform.
 *
 * So: keep the region **directly above** the board dark, and put the bright panels
 * out at 45–70° from vertical. The flat top face then reflects darkness and keeps
 * its own colour, while the bevel and rounded corners — whose normals do vary — pick
 * up the panels as highlights. That is where the gloss should live anyway; it is
 * what makes an edge read as rounded.
 */
export function createStudioEnvironment(): Scene {
  const scene = new Scene()
  // Not pure black: a little floor to the reflections keeps the shaded sides of a
  // tile from crushing to nothing.
  scene.background = new Color('#0a0d12')

  const panels: {
    size: [number, number]
    position: [number, number, number]
    color: string
    /** Emissive multiplier. Values above 1 make this an HDR source. */
    intensity: number
  }[] = [
    // Key: broad and soft, upper left, ~60° off vertical. Matches the light
    // direction the tile and plate art both assume.
    { size: [9, 9], position: [-9, 7, -5], color: '#fff3e0', intensity: 5 },
    // Rim: a narrow bright strip for a crisp glint along one bevel edge. Narrow on
    // purpose — a big panel here would wash the whole edge instead of streaking it.
    { size: [1.4, 11], position: [8, 5, 4], color: '#ffffff', intensity: 13 },
    // Cool fill from the opposite side so shadowed bevels are not dead.
    { size: [8, 8], position: [6, 3, -7], color: '#9dbcff', intensity: 1.4 },
  ]

  const origin = new Vector3(0, 0, 0)
  for (const panel of panels) {
    const mesh = new Mesh(
      new PlaneGeometry(panel.size[0], panel.size[1]),
      new MeshBasicMaterial({
        // Above 1 per channel, so the panel is a genuine HDR highlight source.
        color: new Color(panel.color).multiplyScalar(panel.intensity),
        side: DoubleSide,
      }),
    )
    mesh.position.set(...panel.position)
    mesh.lookAt(origin)
    scene.add(mesh)
  }

  return scene
}

/** Free the geometries and materials after the cubemap has been baked. */
export function disposeStudioEnvironment(scene: Scene): void {
  scene.traverse(object => {
    const mesh = object as { geometry?: { dispose(): void }, material?: { dispose(): void } }
    mesh.geometry?.dispose()
    mesh.material?.dispose()
  })
}
