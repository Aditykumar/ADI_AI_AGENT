/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}', './contexts/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0f172a',
        surface:  '#1e293b',
        surface2: '#253348',
        border:   '#334155',
        muted:    '#94a3b8',
        accent:   '#6366f1',
        pass:     '#22c55e',
        fail:     '#ef4444',
        warn:     '#f59e0b',
      },
    },
  },
  plugins: [],
};
