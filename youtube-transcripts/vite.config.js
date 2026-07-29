import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves /api/transcript during `npm run dev` by loading the same serverless
 * handler through Vite's SSR pipeline, so local dev matches production without
 * needing the Netlify CLI (and picks up edits to shared/ on save).
 */
function transcriptApi() {
  return {
    name: 'transcript-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/transcript', async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost/api/transcript');
        try {
          const module = await server.ssrLoadModule('/netlify/functions/transcript.mjs');
          const response = await module.default(
            new Request(`http://localhost/api/transcript${url.search}`, {
              method: req.method,
              headers: req.headers,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.ssrFixStacktrace(error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(error?.message || error), code: 'DEV_ERROR' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), transcriptApi()],
  server: { port: 5175, open: true },
});
