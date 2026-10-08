/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        jira: {
          blue: '#0052CC',
          navy: '#172B4D',
          gray: '#F4F5F7',
          border: '#DFE1E6',
        },
      },
    },
  },
  plugins: [],
};
