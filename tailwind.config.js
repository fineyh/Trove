/** @type {import('tailwindcss').Config} */
// Design tokens live in src/styles.css; this file only maps them to classes.
// Scales are deliberately short — see notes/design.md.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    // Four radii. The Tailwind names are kept so existing classes map onto
    // the new scale: lg = controls, xl = cards / menus, 2xl = dialogs.
    borderRadius: {
      none: "0",
      sm: "4px",
      DEFAULT: "4px",
      md: "6px",
      lg: "6px",
      xl: "8px",
      "2xl": "12px",
      "3xl": "12px",
      full: "9999px",
    },
    fontSize: {
      "2xs": ["11px", "14px"],
      xs: ["12px", "16px"],
      sm: ["13px", "20px"],
      base: ["15px", "22px"],
      lg: ["18px", "26px"],
      xl: ["22px", "30px"],
    },
    extend: {
      colors: {
        app: {
          DEFAULT: token("bg"),
          fg: token("fg"),
          secondary: token("fg-2"),
          muted: token("fg-3"),
          subtle: token("fill"),
          hover: token("hover"),
          panel: token("panel"),
          border: token("line"),
          accent: token("accent"),
          "on-accent": token("on-accent"),
          danger: token("danger"),
          warning: token("warning"),
          success: token("success"),
        },
      },
      boxShadow: {
        sm: "0 1px 2px rgb(var(--shadow) / 0.06)",
        DEFAULT: "0 1px 3px rgb(var(--shadow) / 0.08), 0 1px 2px rgb(var(--shadow) / 0.04)",
        md: "0 4px 12px rgb(var(--shadow) / 0.08), 0 1px 3px rgb(var(--shadow) / 0.06)",
        lg: "0 8px 24px rgb(var(--shadow) / 0.12), 0 2px 6px rgb(var(--shadow) / 0.08)",
        xl: "0 20px 48px rgb(var(--shadow) / 0.18), 0 4px 12px rgb(var(--shadow) / 0.08)",
        "2xl": "0 20px 48px rgb(var(--shadow) / 0.18), 0 4px 12px rgb(var(--shadow) / 0.08)",
      },
      transitionDuration: {
        DEFAULT: "160ms",
        fast: "100ms",
        slow: "240ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.985)" },
          to: { opacity: "1", transform: "none" },
        },
        "menu-in": {
          from: { opacity: "0", transform: "scale(0.98)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in-right": {
          from: { transform: "translateX(16px)", opacity: "0" },
          to: { transform: "none", opacity: "1" },
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
        "fade-in": "fade-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "pop-in": "pop-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "menu-in": "menu-in 100ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-in-right": "slide-in-right 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        shake: "shake 360ms ease-in-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
      fontFamily: {
        sans: [
          "Segoe UI Variable Text",
          "Segoe UI",
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["Cascadia Mono", "Consolas", "SF Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
