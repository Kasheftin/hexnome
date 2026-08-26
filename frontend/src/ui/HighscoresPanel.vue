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
import { mdiPlayCircleOutline } from '@mdi/js'
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

/*
 * Four columns, and deliberately no "Table".
 *
 * A board is one seat count, so that column said the same thing on every row — and it was the width
 * that pushed the score off the side of a phone, which is the one number a leaderboard exists to
 * show. The toolbar above already says which table this is.
 */
const columns = [
  { title: '#', key: 'rank', sortable: false, width: 56 },
  { title: 'Player', key: 'who', sortable: false },
  { title: 'Finished', key: 'finished', sortable: false },
  { title: 'Score', key: 'score', sortable: false, align: 'end' as const },
  { title: '', key: 'watch', sortable: false, width: 56, align: 'end' as const },
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
    /*
     * A message the server sent is worth repeating; the transport's is not. `ApiError`'s unreachable
     * text is "Cannot reach the table" — right for the four calls it was written for, and wrong here,
     * where a table is a game and this is a scoreboard. So only that one is replaced.
     */
    problem.value = error instanceof ApiError && !error.isUnreachable
      ? error.message
      : 'Cannot reach the scores. Is the server running?'
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
      <!--
        One place for "there is nothing here", whichever reason it is. Keeping the failure above the
        table left an empty no-data row underneath it, so the panel said nothing twice.
      -->
      <!--
        A game on a board is a game you can watch. The link carries `replay=1`, which is all a replay
        is — the same route, read differently — so this is an anchor rather than anything cleverer,
        and it opens in place like every other link on the screen.
      -->
      <template #[`item.watch`]="{ item }">
        <v-btn
          :icon="mdiPlayCircleOutline"
          :to="{ path: '/game', query: { id: item.gameId, replay: '1' } }"
          :border="false"
          variant="text"
          density="comfortable"
          :aria-label="`Watch ${item.who}'s game`"
        />
      </template>

      <template #no-data>
        <p
          v-if="problem"
          class="hx-scores__problem"
        >
          {{ problem }}
        </p>
        <p
          v-else-if="empty"
          class="hx-scores__empty"
        >
          No finished games on this board yet. Play one.
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

  /*
   * Let the toggles wrap rather than scroll.
   *
   * `v-btn-group` sets `overflow-x: auto` so a long strip can be swiped, which on a 390px phone meant
   * "Long & precise" and "4 players" were simply cut off with a scrollbar under them — a filter you
   * cannot see is a filter you will not use. Wrapping costs a line of height and nothing else.
   */
  .hx-flyout__toolbar .v-btn-toggle {
    height: auto;
    flex-wrap: wrap;
    overflow: visible;
  }

  /*
   * Narrower cells on a phone, because the padding was the thing pushing the score off the edge.
   *
   * Four columns at 16px each side is 128px of air on a 296px table — measured, and it left the table
   * seven pixels too wide to fit, so the one figure the board exists to show sat behind a scrollbar.
   * Halving it buys 64px and the whole row fits with room to spare.
   */
  @media (max-width: 720px) {
    .hx-scores :is(td, th) {
      padding-inline: 8px;
    }
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
