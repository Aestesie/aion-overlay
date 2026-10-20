/**
 * The theme: shadcn/ui's dark look, Tailwind's zinc neutrals with blue for the accent, and the
 * semantic names built on them. The few CSS variables templates use are in assets/main.css.
 */
const zinc = {
  50: '#fafafa',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  925: '#111113',
  950: '#09090b',
}

const blue = {
  950: '#172554',
  600: '#2563eb',
  500: '#3b82f6',
  400: '#60a5fa',
}

/** Status colours: Radix red, green, amber, blue, orange — solid (step 9) and text (step 11). */
const status = {
  red: { solid: '#e5484d', text: '#ff9592' },
  green: { solid: '#30a46c', text: '#3dd68c' },
  amber: { solid: '#ffc53d', text: '#ffca16' },
  blue: { solid: '#0090ff', text: '#70b8ff' },
  orange: { solid: '#f76b15', text: '#ffa057' },
}

/** Item grades keep the game's colours; they are what players recognise. */
const grades = {
  'grade-0': '#ffffff',
  'grade-1': '#48bb78',
  'grade-2': '#4299e1',
  'grade-3': '#ecc94b',
  'grade-4': '#f56565',
  'grade-5': '#9f7aea',
  'grade-10': '#9f7aea',
  'grade-11': '#ed64a6',
  'rarity-0': '#787b8acc',
  'rarity-1': '#787b8acc',
  'rarity-2': '#48bb78',
  'rarity-3': '#4299e1',
  'rarity-4': '#ecc94b',
  'rarity-5': '#f56565',
  'rarity-6': '#9f7aea',
  'rarity-10': '#9f7aea',
  'rarity-11': '#ed64a6',
}

/** The numeric scale, used for overlays and backdrops (`bg-900/75`). */
const steps = {
  0: zinc[50],
  100: zinc[400],
  500: zinc[700],
  600: zinc[800],
  700: zinc[900],
  800: zinc[925],
  900: zinc[950],
  1000: '#000000',
}

/** Names whose meaning is the same wherever they are used. */
const shared = {
  ...steps,
  ...grades,
  accent: blue[500],
  'accent-hover': blue[600],
  'accent-soft': blue[950],
  'accent-text': blue[400],
  danger: status.red.solid,
  red: status.red.solid,
  green: status.green.solid,
  success: status.green.solid,
  yellow: status.amber.solid,
  warning: status.orange.solid,
  orange: status.orange.solid,
  blue: status.blue.solid,
  info: status.blue.solid,
  darkest: zinc[500],
  raised: zinc[900],
  white: '#ffffff',
}

module.exports = {
  theme: {
    extend: {
      /*
       * Inter, declared in assets/main.css and shipped with the renderer.
       * Tailwind's preflight puts `fontFamily.sans` on `html`, so naming it
       * here is what makes it the app's face — the overlay included, since
       * that is the same renderer on a different route.
       *
       * The fallbacks matter for the first paint of a cold start and for the
       * glyphs Inter's Latin cut does not carry: Segoe UI Variable Text is
       * Windows 11's own small-text face, and the emoji families are Tailwind's
       * defaults, kept so a symbol in an item name still renders.
       */
      fontFamily: {
        sans: [
          'Inter Variable',
          'Segoe UI Variable Text',
          'Segoe UI',
          'system-ui',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
          'Noto Color Emoji',
        ],
      },
      colors: shared,
      backgroundColor: {
        ...shared,
        app: zinc[950],
        card: zinc[925],
        darker: zinc[950],
        dark: zinc[900], // tiles on a card, and hovers
        default: zinc[950],
        light: zinc[800],
        lighter: zinc[700],
      },
      borderColor: {
        ...shared,
        app: zinc[800],
        card: zinc[800],
        dark: zinc[800],
        default: zinc[800],
        light: zinc[800],
        lighter: zinc[600],
      },
      textColor: {
        ...shared,
        default: zinc[50],
        dark: zinc[200],
        darker: zinc[400],
        darkest: zinc[500],
        accent: blue[400],
        danger: status.red.text,
        red: status.red.text,
        green: status.green.text,
        success: status.green.text,
        yellow: status.amber.text,
        warning: status.orange.text,
        orange: status.orange.text,
        blue: status.blue.text,
        info: status.blue.text,
      },
      ringColor: shared,
      fill: shared,
      boxShadow: {
        // A card's lift on a dark page: a hairline plus a soft drop.
        card: '0 0 0 1px rgb(0 0 0 / 0.2), 0 8px 24px -12px rgb(0 0 0 / 0.7)',
      },
    },
  },
}
