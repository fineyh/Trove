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
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2)",
        shake: "shake 360ms ease-in-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
