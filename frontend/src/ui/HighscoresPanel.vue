<script setup lang="ts">
/**
 * The high score board: one preset, one seat count, best first.
 *
 * ## Why the filters are here and not a route
 *
 * A board is a *pair* — a preset and a table size — because a score at four seats says nothing about
 * a score alone, and there is no board that mixes them. Opening this from a preset card therefore has
 * to arrive somewhere specific, and the two toggles are how you get from there to a neighbouring
 * board without going back to the menu.
 *
 * They open on what was pressed, which is the reason the panel takes them as props rather than
 * choosing its own: the card knows which game it is, and the screen behind it knows how many are
 * playing.
 *
 * ## Paging is the server's
 *
 * `v-data-table-server` rather than `v-data-table`, because the board is not a list this screen
 * holds — it is a slice the server ordered. Sorting is fixed at "best first" and the header is not
 * clickable: the total order the server uses is score, then the earlier game, and a table that
 * offered to sort by date would silently ask for a different one.
 */
import { computed, ref, watch } from 'vue'
import { GAME_PRESETS } from '@hexnome/rules/presets'
import { PLAYER_COUNT_CHOICES, SOLO } from '@hexnome/rules/gameSettings'
import { ApiError } from '@/api/base'
import { getHighscores } from '@/api/highscores'
import { boardRows, tableOf, type BoardRow } from './highscoreRows'
import SettingsFlyout from './SettingsFlyout.vue'

const props = defineProps<{
  open: boolean
  /** The board to open on — the card that was pressed, and the table the screen is set up for. */
  presetId: string
  players: number
}>()

const emit = defineEmits<{ close: [] }>()

/** Solo first: it is the table most of these boards will actually have rows for. */
const SEAT_CHOICES = [SOLO, ...PLAYER_COUNT_CHOICES]

const preset = ref(props.presetId)
const seats = ref(props.players)
const page = ref(1)
const perPage = ref(10)

const rows = ref<BoardRow[]>([])
const total = ref(0)
const loading = ref(false)
const problem = ref('')

/*
 * Reopening on a different card has to move the board, and a stale page number would ask the server
 * for page four of a board with one row.
 */
watch(() => [props.presetId, props.players, props.open] as const, ([id, count, open]) => {
  if (!open) return
  preset.value = id
  seats.value = count
  page.value = 1
})

/* Turning either toggle is a different board, so it starts at the top of it. */
watch([preset, seats], () => { page.value = 1 })

const columns = [
  { title: '#', key: 'rank', sortable: false, width: 56 },
  { title: 'Player', key: 'who', sortable: false },
  { title: 'Table', key: 'players', sortable: false },
  { title: 'Finished', key: 'finished', sortable: false },
  { title: 'Score', key: 'score', sortable: false, align: 'end' as const },
]

const title = computed(() => 'High scores')

/**
 * Fetch the slice the table is showing.
 *
 * Driven by a watcher over everything that decides *which* slice that is, and deliberately not by
 * `v-data-table-server`'s `@update:options`. That event fires for the table's own state — the page,
 * the sort — and knows nothing about the two toggles above it, so with it as the trigger, switching
 * from one board to another left the previous board's rows sitting under the new board's heading. It
 * was only visible because a board that should have been empty showed somebody else's game.
 */
async function load(): Promise<void> {
  loading.value = true
  problem.value = ''
  const offset = (page.value - 1) * perPage.value
  try {
    const board = await getHighscores({
      preset: preset.value,
      players: seats.value,
      limit: perPage.value,
      offset,
    })
    rows.value = boardRows(board.rows, board.offset)
    total.value = board.total
  } catch (error) {
    rows.value = []
    total.value = 0
    problem.value = error instanceof ApiError ? error.message : 'Cannot reach the scores.'
  } finally {
    loading.value = false
  }
}

/*
 * One trigger for the first load and every later one. `immediate` covers opening the panel; the guard
 * is what stops a board being fetched for a dialog nobody has opened, since this component is mounted
 * for the whole life of the menu.
 */
watch(
  () => [props.open, preset.value, seats.value, page.value] as const,
  ([open]) => { if (open) void load() },
  { immediate: true },
)

const empty = computed(() => !loading.value && !problem.value && rows.value.length === 0)
</script>

<template>
  <SettingsFlyout
    :open="props.open"
    :title="title"
    :width="720"
    @close="emit('close')"
  >
    <template #toolbar>
      <v-btn-toggle
        v-model="preset"
        color="success"
        base-color="on-surface"
        variant="text"
        mandatory
        density="comfortable"
        aria-label="Which game"
      >
        <v-btn
          v-for="entry in GAME_PRESETS"
          :key="entry.id"
          :value="entry.id"
        >
          {{ entry.label }}
        </v-btn>
      </v-btn-toggle>

      <v-btn-toggle
        v-model="seats"
        color="success"
        base-color="on-surface"
        variant="text"
        mandatory
        density="comfortable"
        aria-label="How many players"
      >
        <v-btn
          v-for="count in SEAT_CHOICES"
          :key="count"
          :value="count"
        >
          {{ tableOf(count) }}
        </v-btn>
      </v-btn-toggle>
    </template>

    <p
      v-if="problem"
      class="hx-scores__problem"
    >
      {{ problem }}
    </p>

    <!--
      `items-per-page-options` is a single value: the page size is not a decision worth handing a
      player on a board this shape, and the server bounds it anyway.
    -->
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="perPage"
      :headers="columns"
      :items="rows"
      :items-length="total"
      :loading="loading"
      :items-per-page-options="[{ value: 10, title: '10' }]"
      item-value="key"
      density="comfortable"
      class="hx-scores"
    >
      <template #no-data>
        <p class="hx-scores__empty">
          <template v-if="empty">
            No finished games on this board yet. Play one.
          </template>
        </p>
      </template>
    </v-data-table-server>
  </SettingsFlyout>
</template>

<style lang="scss">
/*
 * Not `scoped`: a scope attribute raises specificity, which is what the layers exist to make
 * irrelevant. See styles/layers.scss.
 */
@layer components {
  /*
   * The page size is not a decision worth offering: the server bounds it, and one board's page is the
   * same as another's. Vuetify renders the select regardless of how few options it is given, so the
   * control goes rather than the choice.
   */
  .hx-scores .v-data-table-footer__items-per-page {
    display: none;
  }

  .hx-scores__problem,
  .hx-scores__empty {
    margin: 0;
    padding: 24px 16px;
    color: rgb(var(--v-theme-muted));
    text-align: center;
  }

  /* The score is what the board is ordered by, so it reads as the figure rather than a cell. */
  .hx-scores td:last-child {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .hx-scores td:first-child {
    color: rgb(var(--v-theme-muted));
    font-variant-numeric: tabular-nums;
  }
}
</style>
