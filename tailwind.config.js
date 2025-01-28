module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      keyframes: {
        rollAnimation: {
          '0%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(180deg)' },
          '50%': { transform: 'rotate(360deg)' },
          '75%': { transform: 'rotate(180deg)' },
          '100%': { transform: 'rotate(0deg)' }
        }
      }
    }
  },
  plugins: [],
};