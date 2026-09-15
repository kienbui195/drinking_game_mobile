module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: { colors: { night: '#10101c', panel: '#1c1c30', accent: '#c4b5fd' } } },
  plugins: [],
};
