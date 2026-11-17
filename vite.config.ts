import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          server: {
            port: 5173,
            strictPort: true,
          },
          optimizeDeps: {
            include: [], // react-window removed
          },
          build: {
            // Vite 8 (Rolldown) reads `rolldownOptions`; the old `rollupOptions` key is ignored here, which
            // bundled better-sqlite3 into dist-electron and broke loading its native binding in the built app.
            // scripts/dev/check-build-output.cjs fails the verify run if that happens again.
            rolldownOptions: {
              external: ['better-sqlite3', 'exiftool-vendored', 'sharp'],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: {
      fs: path.resolve(__dirname, 'src/utils/mock-fs.ts'),
      path: path.resolve(__dirname, 'src/utils/mock-path.ts'),
      url: path.resolve(__dirname, 'src/utils/mock-fs.ts'),
    },
  },
})
