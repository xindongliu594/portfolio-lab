import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { PlanStore } from './store.js';
import { analyze } from './domain.js';
import type { Snapshot } from '../shared/types.js';

const snapshot: Snapshot = JSON.parse(readFileSync(resolve('data/portfolio.json'), 'utf8').replace(/^\uFEFF/, ''));
analyze(snapshot);
const store = new PlanStore(resolve(process.env.PORTFOLIO_DB ?? '.runtime/plans.sqlite'));
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1～65535 的整数');
const server = createApp({ snapshot, store, staticDir: resolve('dist/client') }).listen(port, '127.0.0.1', () => {
  console.log(`Portfolio Lab: http://127.0.0.1:${port}`);
});
server.on('error', error => { console.error('服务启动失败：', error.message); store.close(); process.exit(1); });
function shutdown() { server.close(() => { store.close(); process.exit(0); }); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
