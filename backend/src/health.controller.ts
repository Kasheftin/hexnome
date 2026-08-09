import { Controller, Get } from '@nestjs/common'
import { DISTINCT_TILES } from './rules/deck'
import { createDesk } from './rules/desk'

/**
 * Proof of life, and proof of *which rules are running*.
 *
 * The second half is the point. The frontend compiles the rules from source and hot-reloads them; the
 * server compiles its own copy and keeps it until restarted. A server left running across a rules
 * change therefore disagrees with the client silently, and the symptom — a refusal of something the
 * client just did — reads exactly like a logic bug. It cost a whole debugging session once
 * (docs/backend-attempt1.md).
 *
 * The symlink at `src/rules` closes most of that: `nest start --watch` now restarts on a rules edit,
 * because they are ordinary files under `src/` rather than a package behind node_modules. This is
 * what covers the rest — a server that was simply never restarted. It deals a fixed probe seed and
 * reports the first few codes; the client deals the same one and says so plainly if they differ.
 */
const PROBE_SEED = 'health-check'

export interface Health {
  readonly status: string
  readonly rules: {
    readonly distinctTiles: number
    /** The first codes a known seed deals. A fingerprint of the loaded rules, not a secret. */
    readonly fingerprint: readonly number[]
  }
}

@Controller()
export class HealthController {
  @Get('health')
  health(): Health {
    const desk = createDesk(PROBE_SEED, { copies: 1 })
    return {
      status: 'ok',
      rules: {
        distinctTiles: DISTINCT_TILES,
        fingerprint: desk.ok ? desk.value.desk.slice(0, 4) : [],
      },
    }
  }
}
