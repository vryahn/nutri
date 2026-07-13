import { defineConfig } from 'vitest/config';

// Config APARTE para el golden set de IA: solo *.eval.js, timeout largo (llamadas reales).
// El root queda en la raíz del repo (default), así Vitest carga `.env` igual que el config
// por defecto y `import.meta.env.VITE_GEMINI_KEY` llega al runner.
export default defineConfig({
  test: {
    include: ['evals/**/*.eval.js'],
    testTimeout: 120000,
  },
});
