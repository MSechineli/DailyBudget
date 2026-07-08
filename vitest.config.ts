import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // fake-indexeddb registra o global indexedDB para os testes de storage.
    setupFiles: ['./src/test/setup.ts'],
  },
});
