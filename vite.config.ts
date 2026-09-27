import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const OUT_DIR = resolve(import.meta.dirname, 'poc-out');
const ROOTS_FILE = resolve(import.meta.dirname, 'test-roots.local.json');

// 計測用に dev サーバーから読ませてよいフォルダ。test-roots.local.json(git 管理外)に絶対パスの配列で書く
function testRoots(): string[] {
  const roots: string[] = existsSync(ROOTS_FILE) ? JSON.parse(readFileSync(ROOTS_FILE, 'utf8')) : [];
  return [...roots, OUT_DIR].map((r) => resolve(r) + sep);
}

// PoC の自動計測用。dev サーバーでだけ有効で、ビルドには含まれない
function localTestFiles(): Plugin {
  return {
    name: 'local-test-files',
    apply: 'serve',
    configureServer(server) {
      const sendFile = (p: string, res: import('node:http').ServerResponse) => {
        if (!testRoots().some((r) => p.startsWith(r)) || !existsSync(p)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Length', statSync(p).size);
        createReadStream(p).pipe(res);
      };
      server.middlewares.use('/__test/file', (req, res) => {
        sendFile(resolve(new URL(req.url!, 'http://x').searchParams.get('p') ?? ''), res);
      });
      server.middlewares.use('/__test/jobs', (req, res) => {
        const name = new URL(req.url!, 'http://x').searchParams.get('name') ?? '';
        if (!/^\w+$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        sendFile(resolve(OUT_DIR, `jobs_${name}.json`), res);
      });
      server.middlewares.use('/__test/save', (req, res) => {
        const name = new URL(req.url!, 'http://x').searchParams.get('name') ?? 'out.bin';
        if (!/^[\w.-]+$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(OUT_DIR, { recursive: true });
          writeFileSync(resolve(OUT_DIR, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

// Service Worker がインストール時にキャッシュする、ビルド結果のファイル一覧(ハッシュ付きの名前は毎回変わる)
function precacheList(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'poc.html');
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [localTestFiles(), precacheList()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), poc: resolve(import.meta.dirname, 'poc.html') },
    },
  },
});
