import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  // Relative asset URLs so the same build works at '/' locally and '/toys/' on GH Pages.
  base: './',
  plugins: [solid()],
});
