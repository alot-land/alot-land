/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // On-brand (Alot Of Land), themeable: every token resolves through a
        // CSS variable (RGB triplet) so the .dark root class swaps the whole
        // palette. <alpha-value> keeps /20-style opacity modifiers working.
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        border: 'rgb(var(--c-border) / <alpha-value>)',
        'border-hi': 'rgb(var(--c-border-hi) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--c-ink-2) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        gold: 'rgb(var(--c-gold) / <alpha-value>)',
        green: 'rgb(var(--c-green) / <alpha-value>)',
        'green-deep': 'rgb(var(--c-green-deep) / <alpha-value>)',
        blue: 'rgb(var(--c-blue) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
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
