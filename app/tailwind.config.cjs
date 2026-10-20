/** The theme: shadcn/ui's dark zinc and blue (tailwind.preset.cjs). */
module.exports = {
  presets: [require('./tailwind.preset.cjs')],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,ts}'],
  plugins: [],
}
