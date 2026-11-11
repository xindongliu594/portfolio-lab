import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from '../shared/types.js';
import type { PlanStore } from './store.js';
import { analyze, DomainError, simulate } from './domain.js';
import { createDemoAdvice, createDemoReply, resolveAssistantContext } from './assistant.js';
import { resolveSourceSnapshot } from './source.js';

export function createApp({ snapshot, store, staticDir }: { snapshot: Snapshot; store: PlanStore; staticDir?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/portfolio', (_req, res) => res.json({ snapshot, analysis: analyze(snapshot) }));
  app.post('/api/assistant/advice', (req, res) => res.json(createDemoAdvice(resolveAssistantContext(snapshot, store, req.body?.context))));
  app.post('/api/assistant/chat', (req, res) => res.json(createDemoReply(resolveAssistantContext(snapshot, store, req.body?.context), req.body?.question, req.body?.history === undefined ? [] : req.body.history, req.body?.topic)));
  app.post('/api/simulate', (req, res) => res.json(simulate(resolveSourceSnapshot(snapshot, store, req.body?.sourcePlanId), req.body?.operations)));
  app.post('/api/plans', (req, res) => {
    const rawName = req.body?.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || [...name].length > 60) throw new DomainError('INVALID_NAME', '方案名称去除首尾空格后须为 1～60 个字符。');
    const source = resolveSourceSnapshot(snapshot, store, req.body?.sourcePlanId);
    const result = simulate(source, req.body?.operations);
    const saved = store.save(name, source, result.operations);
    res.status(201).json({ ...saved, ...result });
  });
  app.get('/api/plans', (_req, res) => res.json(store.list()));
  app.get('/api/plans/:id', (req, res) => {
    const plan = store.get(req.params.id);
    if (!plan) { res.status(404).json({ error: { code: 'PLAN_NOT_FOUND', message: '没有找到此方案，请刷新方案列表。' } }); return; }
    res.json({ ...plan, ...simulate(plan.snapshot, plan.operations) });
  });
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get('/', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '请求的地址不存在。' } }));
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof DomainError) {
      res.status(error.code === 'PLAN_NOT_FOUND' ? 404 : 422).json({ error: { code: error.code, message: error.message, operationIndex: error.operationIndex } });
    } else if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: '请求 JSON 格式不正确。' } });
    } else if (error.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求过大，请减少操作数量。' } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务或数据保存暂时不可用，请稍后重试。当前有效模拟结果不会改变。' } });
    }
  };
  app.use(onError);
  return app;
}
