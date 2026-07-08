import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.carteira.financeira',
  appName: 'Carteira Financeira',
  // O Vite gera os arquivos estáticos em dist/; o Capacitor empacota essa pasta
  // dentro do APK (offline-first, sem hosting).
  webDir: 'dist',
};

export default config;
