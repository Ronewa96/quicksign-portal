import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Server data (users, sent documents, the email outbox) and the Python env are not app code:
      // watching them reloads every open page whenever a document is sent or an email is saved.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/data/**', '**/.venv/**'] },
    },
  };
});
