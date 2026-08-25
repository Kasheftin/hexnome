import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import 'vuetify/styles'

/**
 * Vuetify, themed and given its house defaults.
 *
 * Two jobs, and they are deliberately separate from the SCSS settings in styles/vuetify-settings.scss:
 * that file decides how the framework is *built* (sizes, radii, typography), and this one decides what
 * it is *told* at runtime (colours, per-component props). A value belongs in the settings file if it
 * should hold for every instance forever, and here if it is a default an instance may override.
 */

/**
 * The palette, named once.
 *
 * Every one of these came from the hand-written CSS it replaces — 299 colour literals across the app,
 * of which only 36 were distinct. Naming them is most of the reason for this migration: `#e8c878`
 * appeared 53 times and meant "brass" every time, but nothing said so.
 *
 * **The tile colours are not here.** A tile's colour is an index the rules deal, and only the renderer
 * knows what green looks like (`TILE_COLORS` in scene/constants.ts, pinned to `TILE_COLOR_COUNT` by a
 * typecheck). They are scene data, not chrome, and putting them in a theme would invite someone to
 * restyle the deck.
 */
const hexnome: ThemeDefinition = {
  dark: true,
  colors: {
    /* The table itself, and the panels laid on it. */
    background: '#0d0f13',
    surface: '#15171c',
    'surface-bright': '#22252b',
    'surface-light': '#2a2e35',
    'surface-variant': '#1b1e24',

    /*
     * Brass: the accent, and the most-used colour in the app by a wide margin.
     *
     * `primary` rather than a custom name so stock components pick it up untold — a `v-btn
     * color="primary"` is brass without anyone wiring it.
     */
    primary: '#e8c878',
    'primary-darken-1': '#c8a86d',
    /* The dim brass a resting border sits at, and what a hover warms *from*. */
    secondary: '#7d6a41',
    'secondary-darken-1': '#4a3f28',

    /* Mint: valid, allowed, "release here". Never used for anything that is merely on. */
    success: '#8fe6c0',
    error: '#ff4d3d',
    warning: '#d98b74',
    info: '#cfe0ff',

    /* Text, in the three weights the app actually distinguishes. */
    'on-background': '#cfd4de',
    'on-surface': '#cfd4de',
    muted: '#79808f',
    'muted-dim': '#6b7382',

    /*
     * Edges. `border` is the neutral hairline; `border-brass` is the warmer one the chrome panels
     * use, and is the value the WebGL panels have to match.
     */
    border: '#33383f',
    'border-brass': '#3a3222',
    divider: '#2a2c33',
    brass: '#e8c878',
    'brass-dim': '#7d6a41',
  },
  variables: {
    'border-color': '#33383f',
    'border-opacity': 1,
    /* Flat everywhere: the look is drawn with a 1px edge, never with a shadow. */
    'activated-opacity': 0.08,
    'hover-opacity': 0.06,
  },
}

export const vuetify = createVuetify({
  /*
   * `mdi-svg`, because the app already imports its icons as path data from `@mdi/js` and has done
   * since before Vuetify. Nothing needs a font or a network request: `<v-icon :icon="mdiCog" />` takes
   * the same string the hand-rolled `<svg><path :d="mdiCog"></svg>` did, and only the icons actually
   * imported are bundled.
   */
  /*
   * `defaultSet` names a key in `sets`, and `vuetify/iconsets/mdi-svg` exports its set as `mdi` — so
   * this is 'mdi' even though the module is the svg one. Naming it 'mdi-svg' here looks right and
   * fails at runtime with "Cannot read properties of undefined (reading 'component')".
   */
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'hexnome',
    themes: { hexnome },
  },
  defaults: {
    /*
     * The house style, said once instead of at every call site.
     *
     * `outlined` and `flat` are what make a stock `v-btn` read as this game rather than as Material:
     * a hairline edge on a dark surface, no fill, no shadow. Ripple is off for the same reason the
     * scene has no bounce — the table is meant to feel like objects on felt, not like a phone app.
     */
    /*
     * `text` plus the `border` prop, not `outlined`.
     *
     * They look like the same thing and are not: `outlined` draws its edge from **`currentColor`**,
     * so a button's border is whatever colour its text is — which gave every control a bright edge
     * instead of the slate hairline the chrome is built from. The `border` prop uses
     * `--v-border-color` / `--v-border-opacity`, which the theme owns, so one value carries the whole
     * app and `color="primary"` tints the label without repainting the frame.
     *
     * Ripple off for the same reason the scene has no bounce: the table is meant to feel like objects
     * on felt, not like a phone app.
     */
    VBtn: {
      variant: 'text',
      border: true,
      ripple: false,
    },
    VCard: {
      flat: true,
      border: true,
      color: 'surface',
    },
    VDialog: {
      scrim: 'background',
      transition: 'fade-transition',
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      hideDetails: 'auto',
    },
    VDivider: {
      color: 'divider',
    },
  },
})
