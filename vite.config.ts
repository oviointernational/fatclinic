import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// No dev proxy: the browser talks to Supabase directly over HTTPS, so there is
// no local API to forward to. If a /api call reappears in the app it is a bug -
// the data layer goes through src/services/supabase.ts, not a local server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
});
