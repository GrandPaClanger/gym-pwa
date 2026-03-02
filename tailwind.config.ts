import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "gym-bg": "#0f172a",
        "gym-card": "#1e293b",
        "gym-border": "#334155",
        "gym-accent": "#3b82f6",
        "gym-accent-hover": "#2563eb",
        "gym-text": "#f1f5f9",
        "gym-muted": "#94a3b8",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
