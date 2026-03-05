/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        custom: ["CustomFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};
