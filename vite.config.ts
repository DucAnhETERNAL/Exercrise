import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.DRIVE_API_KEY': JSON.stringify(env.DRIVE_API_KEY || ''),
        'process.env.CLOUDFLARE_R2_ACCOUNT_ID': JSON.stringify(env.CLOUDFLARE_R2_ACCOUNT_ID || ''),
        'process.env.CLOUDFLARE_R2_ACCESS_KEY_ID': JSON.stringify(env.CLOUDFLARE_R2_ACCESS_KEY_ID || ''),
        'process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY': JSON.stringify(env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ''),
        'process.env.CLOUDFLARE_R2_BUCKET_NAME': JSON.stringify(env.CLOUDFLARE_R2_BUCKET_NAME || ''),
        'process.env.CLOUDFLARE_R2_PUBLIC_URL': JSON.stringify(env.CLOUDFLARE_R2_PUBLIC_URL || ''),
        'process.env.CLOUDFLARE_R2_ENDPOINT': JSON.stringify(env.CLOUDFLARE_R2_ENDPOINT || ''),
        'process.env.CLOUDFLARE_R2_REGION': JSON.stringify(env.CLOUDFLARE_R2_REGION || 'auto')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
