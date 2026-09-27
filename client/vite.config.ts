import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5173 },
  build: {
    // Phaser alone is ~1.2 MB minified; it lives in its own chunk (below), so
    // only warn if something else grows past that.
    chunkSizeWarningLimit: 1300,
    rolldownOptions: {
      output: {
        // Keep Phaser in its own chunk so its hashed file stays cached across
        // deploys that only change game code.
        codeSplitting: {
          groups: [{ name: "phaser", test: /[\/]node_modules[\/]phaser[\/]/ }],
        },
      },
    },
  },
});
