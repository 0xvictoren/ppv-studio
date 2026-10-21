import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1.25rem", md: "2rem" }, screens: { "2xl": "1200px" } },
    extend: {
      colors: {
        background: token("background"),
        surface: token("surface"),
        foreground: token("foreground"),
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        border: token("border"),
        ring: token("ring"),
        primary: {
          DEFAULT: token("primary"),
          hover: token("primary-hover"),
          border: token("primary-border"),
          foreground: token("primary-foreground"),
        },
        secondary: token("secondary"),
        tint: token("tint"),
        destructive: token("destructive"),
        overlay: token("overlay"),
      },
      borderRadius: { sm: "8px", md: "10px", lg: "14px", xl: "20px" },
      fontFamily: {
        sans: ["var(--font-text)", "-apple-system", "BlinkMacSystemFont", "Helvetica Neue", "sans-serif"],
        display: ["var(--font-display)", "var(--font-text)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      transitionTimingFunction: { apple: "cubic-bezier(0.4, 0, 0.2, 1)" },
    },
  },
  plugins: [],
};
export default config;
