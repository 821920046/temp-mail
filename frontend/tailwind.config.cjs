/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js,ts}"],
  theme: {
    extend: {
      colors: {
        nebula: {
          50: "#f0f4ff",
          100: "#e0eaff",
          200: "#c7d9ff",
          300: "#a3bffe",
          400: "#7a9bfc",
          500: "#5271fa",
          600: "#354df0",
          700: "#2638d4",
          800: "#2430ac",
          900: "#222b88",
          950: "#151953",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}
