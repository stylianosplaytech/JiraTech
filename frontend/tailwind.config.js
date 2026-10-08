/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      colors: {
        jira: {
          blue: '#0052CC',
          'blue-hover': '#0747A6',
          'blue-light': '#DEEBFF',
          navy: '#172B4D',
          subtle: '#5E6C84',
          muted: '#6B778C',
          gray: '#F4F5F7',
          'gray-hover': '#EBECF0',
          border: '#DFE1E6',
          input: '#FAFBFC',
          focus: '#4C9AFF',
        },
      },
      boxShadow: {
        popover: '0 4px 8px -2px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
        card: '0 1px 1px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
        modal: '0 8px 16px -4px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)',
      },
    },
  },
  plugins: [],
};
