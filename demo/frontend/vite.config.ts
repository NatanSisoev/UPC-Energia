import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { alertPlugin } from './scripts/alert-plugin.mjs';
import { modelPlugin } from './scripts/model-plugin.mjs';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix: also load non-VITE_ vars (SMTP secrets stay server-side, never bundled into the client)
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), alertPlugin(env), modelPlugin()],
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
