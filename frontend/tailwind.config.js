/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050505",
        cyan: "#00E5FF",
        "cyan-dim": "rgba(0, 229, 255, 0.15)",
        green: "#00E676",
        red: "#FF1744",
        surface: "#0A0A0A",
        border: "#1A1A1A",
      },
      fontFamily: {
        mono: ["'IBM Plex Mono'", "monospace"],
        heading: ["'Syne'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
