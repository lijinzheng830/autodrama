import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['electron']
      }
    },
    plugins: [
      {
        name: 'copy-prompt-templates',
        closeBundle(): void {
          const src = resolve('src/main/data')
          const dest = resolve('out/main/data')
          if (existsSync(src)) copyDirRecursive(src, dest)
        }
      }
    ]
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
