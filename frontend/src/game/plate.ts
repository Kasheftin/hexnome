/**
 * The plate: a seven-cell flower — one centre hole plus six petals around it.
 *
 * Pure data and functions. No `vue`, no `three`.
 *
 * A plate arrives with one petal already filled and the other five empty. The hole is
 * never fillable. Tiles may only ever go into a petal of a placed plate, which means no
 * tile ever sits on a bare board cell — so tiles are addressed as (plate, petal) rather
 * than by cell, and a plate therefore carries its tiles with it when it moves.
 */
import { NEIGHBOR_DIRS, axialAdd, axialEquals, type Axial } from './hex'

export const PETAL_COUNT = 6

/** Petal offsets from the hole, counter-clockwise from east. */
export const PETAL_DIRS: readonly Axial[] = NEIGHBOR_DIRS

/** The cell a petal occupies, given the plate's hole. */
export function petalCell(hole: Axial, petal: number): Axial {
  const dir = PETAL_DIRS[((petal % PETAL_COUNT) + PETAL_COUNT) % PETAL_COUNT] as Axial
  return axialAdd(hole, dir)
}

/** All seven cells a plate covers: the hole first, then the six petals in order. */
export function plateCells(hole: Axial): Axial[] {
  return [hole, ...PETAL_DIRS.map(dir => axialAdd(hole, dir))]
}

/**
 * Which petal of this plate a cell is, or null if it is the hole or outside the plate.
 */
export function petalIndexOf(hole: Axial, cell: Axial): number | null {
  for (let petal = 0; petal < PETAL_COUNT; petal++) {
    if (axialEquals(petalCell(hole, petal), cell)) return petal
  }
  return null
}

export function isPetal(petal: number): boolean {
  return Number.isInteger(petal) && petal >= 0 && petal < PETAL_COUNT
}
