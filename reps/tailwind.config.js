/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0A',
        panel: '#111111',
        'panel-2': '#1A1A1A',
        border: '#222222',
        'border-hi': '#333333',
        muted: '#888888',
        text: '#E8E8E8',
        gold: '#F5B800',
        green: '#3CB054',
        blue: '#5B9BD5',
        grey: '#5A5A5A',
        danger: '#E5484D',
        // REPS evidence-strength semantics
        strong: '#3CB054',
        medium: '#F5B800',
        weak: '#8A7A5A',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        body: ['DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '12px', '2xl': '16px' },
    },
  },
  plugins: [],
};
