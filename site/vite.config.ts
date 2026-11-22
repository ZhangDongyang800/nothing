import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  preview: { port: 5274, strictPort: true },
  // 站点不依赖 Tailwind。显式清空 PostCSS 插件，避免连到主工程的
  // tailwind.config 与 postcss.config，导致构建告警和多余 preflight。
  css: { postcss: { plugins: [] } },
  build: { target: 'es2020', cssCodeSplit: true },
});
