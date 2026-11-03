import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const apiTarget = `http://127.0.0.1:${mode === 'test' ? 3100 : 3000}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': apiTarget,
        '/demo': apiTarget,
        '/docs': apiTarget,
        '/openapi.yaml': apiTarget,
      },
    },
  };
});
