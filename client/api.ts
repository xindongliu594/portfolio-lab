import type { ApiError } from '../shared/types.js';

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => { throw new Error('无法连接本地服务，请确认服务已启动后重试；当前模拟结果已保留。'); });
  const data = await response.json().catch(() => { throw new Error('服务返回了无法识别的数据，请稍后重试；当前模拟结果已保留。'); });
  if (!response.ok) {
    const detail = (data as ApiError).error;
    const prefix = detail.operationIndex === undefined ? '' : `第 ${detail.operationIndex + 1} 笔操作：`;
    throw new Error(prefix + (detail.message || '请求失败，请稍后重试。'));
  }
  return data as T;
}
