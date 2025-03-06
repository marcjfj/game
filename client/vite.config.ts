import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    cors: true,
    hmr: {
      overlay: true,
      protocol: "ws",
      host: "localhost",
      port: 24678,
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      ".ngrok-free.app",
      "f617-2605-59c0-203b-9410-851c-a447-a5e0-362.ngrok-free.app",
    ],
  },
  build: {
    outDir: "build",
  },
});
