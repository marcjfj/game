import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    cors: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // Proxy all WebSocket connections
      "/": {
        target: "ws://localhost:3000",
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
