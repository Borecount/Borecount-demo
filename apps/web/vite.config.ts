import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, envDir, 'VITE_');
  const publicUrl = new URL(env.VITE_PUBLIC_URL || 'https://borecount.dev/');
  if (!['http:', 'https:'].includes(publicUrl.protocol)) {
    throw new Error('VITE_PUBLIC_URL must be an HTTP(S) URL');
  }
  return {
    envDir,
    define: { 'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicUrl.href) },
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': mode === 'test' ? 'http://127.0.0.1:3100' : 'http://127.0.0.1:3000',
        '/demo': mode === 'test' ? 'http://127.0.0.1:3100' : 'http://127.0.0.1:3000',
        '/docs': mode === 'test' ? 'http://127.0.0.1:3100' : 'http://127.0.0.1:3000',
        '/openapi.yaml': mode === 'test' ? 'http://127.0.0.1:3100' : 'http://127.0.0.1:3000',
      },
    },
  };
});
