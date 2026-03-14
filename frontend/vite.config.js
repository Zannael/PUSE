import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // <-- Importa questo

export default defineConfig({
  base: globalThis.process?.env?.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    tailwindcss(), // <-- Aggiungilo qui
  ],
})
