import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Pull canister ids from the dfx-generated .env at the project root.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env") });

const backendId = process.env.CANISTER_ID_KIVULI_BACKEND ?? "";
const network = process.env.DFX_NETWORK ?? "local";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  define: {
    __KIVULI_BACKEND_ID__: JSON.stringify(backendId),
    __DFX_NETWORK__: JSON.stringify(network),
  },
  server: { port: 3000, host: true },
});
