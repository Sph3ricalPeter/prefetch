import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Ignore git internals and Rust build artifacts — git operations
      // (stash, commit, checkout) modify .git/ files which would trigger
      // unwanted HMR full-page reloads
      ignored: ["**/.git/**", "**/src-tauri/target/**"],
    },
  },
});
