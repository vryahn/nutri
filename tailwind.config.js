/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        accent: 'var(--accent)',
        'accent-deep': 'var(--accent-deep)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        'd-kcal': 'var(--d-kcal)',
        'd-prot': 'var(--d-prot)',
        'd-carb': 'var(--d-carb)',
        'd-fat': 'var(--d-fat)',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
