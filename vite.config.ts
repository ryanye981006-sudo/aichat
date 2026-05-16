import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    base: mode === 'production' ? './' : '/',
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            antd: ['antd'],
            markdown: ['react-markdown', 'remark-gfm'],
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${env.VITE_API_PORT || '3001'}`,
          changeOrigin: true,
        },
      },
    },
  };
});
