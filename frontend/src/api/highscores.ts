/**
 * One board, a page at a time.
 *
 * Its own module rather than a sixth call in `games.ts`, because a board is not a game — it is a
 * public list *about* games, with no seat, no token and no id in it. The two happen to share a
 * transport, which is why the transport is in `base.ts`.
 */
import type { HighscorePage } from '@hexnome/rules/wire'
import { request } from './base'

export interface BoardQuery {
  readonly preset: string
  readonly players: number
  readonly limit: number
  readonly offset: number
}

/**
 * The board for one preset at one seat count.
 *
 * Both filters always go: the server refuses a request without them, because a score at one table
 * size says nothing about a score at another and there is no board that mixes them.
 */
export function getHighscores({ preset, players, limit, offset }: BoardQuery): Promise<HighscorePage> {
  const query = new URLSearchParams({
    preset,
    players: String(players),
    limit: String(limit),
    offset: String(offset),
  })
  return request<HighscorePage>(`/highscores?${query.toString()}`)
}
