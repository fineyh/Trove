/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        app: {
          DEFAULT: "rgb(var(--color-app) / <alpha-value>)",
          fg: "rgb(var(--color-app-fg) / <alpha-value>)",
          subtle: "rgb(var(--color-app-subtle) / <alpha-value>)",
          panel: "rgb(var(--color-panel) / <alpha-value>)",
          border: "rgb(var(--color-border) / <alpha-value>)",
          accent: "rgb(var(--color-accent) / <alpha-value>)",
          muted: "rgb(var(--color-muted) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
