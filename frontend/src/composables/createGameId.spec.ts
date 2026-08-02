import { describe, expect, it } from 'vitest'
import { createGameId } from './createGameId'

describe('game ids', () => {
  it('look like uuids and do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createGameId()))
    expect(ids.size).toBe(500)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })
})
