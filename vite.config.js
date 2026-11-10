import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const saveCompiledTargets = {
  name: 'save-compiled-mindar-targets',
  configureServer(server) {
    server.middlewares.use('/__compile-targets', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end('POST only');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length < 1024 || data.length > 50 * 1024 * 1024) {
        response.statusCode = 400;
        response.end('Invalid target file size');
        return;
      }
      const output = path.resolve(server.config.root, 'public/targets.mind');
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, data);
      response.setHeader('Content-Type', 'text/plain');
      response.end(`Wrote ${data.length} bytes to public/targets.mind`);
      console.log(`MindAR target written (${data.length} bytes).`);
    });
  },
};

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [saveCompiledTargets],
  optimizeDeps: {
    exclude: ['mind-ar'],
    include: ['long', 'seedrandom', '@tensorflow/tfjs', '@msgpack/msgpack', 'mathjs', 'ml-matrix', 'svd-js', 'tinyqueue'],
  },
  server: { host: '0.0.0.0' },
});
