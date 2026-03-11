import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // <-- Importa questo

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <-- Aggiungilo qui
  ],
})
