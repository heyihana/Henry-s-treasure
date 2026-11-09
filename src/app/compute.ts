import { runOptimize, type OptimizeRequest, type OptimizeResult } from '../lib/optimize';
import { resolveStrategy, type StrategySpec } from '../lib/strategies';
import type { Params, StrategyOutput } from '../lib/strategies/types';
import type { Bar } from '../lib/types';
import ComputeWorker from '../workers/compute.worker?worker&inline';

export interface Task<T> {
  promise: Promise<T>;
  cancel(): void;
}

function makeWorker(): Worker | null {
  try {
    return new ComputeWorker();
  } catch {
    return null;
  }
}

function runOnMainThread<T>(fallback: (onProgress?: (d: number, t: number) => void) => T, onProgress?: (d: number, t: number) => void): Task<T> {
  let cancelled = false;
  const promise = new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      if (cancelled) return reject(new Error('已取消'));
      try {
        resolve(fallback(onProgress));
      } catch (e) {
        reject(e);
      }
    }, 30),
  );
  return { promise, cancel: () => (cancelled = true) };
}

function runTask<T>(
  message: unknown,
  fallback: (onProgress?: (d: number, t: number) => void) => T,
  opts: { timeout?: number; onProgress?: (done: number, total: number) => void } = {},
): Task<T> {
  const worker = makeWorker();
  // 环境不支持 Worker 时在主线程计算
  if (!worker) return runOnMainThread(fallback, opts.onProgress);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectFn: (e: Error) => void = () => undefined;
  let settled = false;
  let inner: Task<T> | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectFn = reject;
    let gotMessage = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      gotMessage = true;
      const d = e.data;
      if (d.type === 'progress') opts.onProgress?.(d.done, d.total);
      else if (d.type === 'done') {
        finish();
        resolve(d.result as T);
      } else if (d.type === 'error') {
        finish();
        reject(new Error(d.message));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      finish();
      if (!gotMessage) {
        // Worker 无法启动（如 file:// 或受限的沙箱环境），退回主线程计算
        inner = runOnMainThread(fallback, opts.onProgress);
        inner.promise.then(resolve, reject);
      } else {
        reject(new Error(e.message || '计算出错'));
      }
    };
    if (opts.timeout) {
      timer = setTimeout(() => {
        finish();
        reject(new Error(`计算超时（超过 ${Math.round(opts.timeout! / 1000)} 秒），请检查代码是否有死循环`));
      }, opts.timeout);
    }
    worker.postMessage(message);
  });
  return {
    promise,
    cancel() {
      if (inner) return inner.cancel();
      if (settled) return;
      clearTimeout(timer);
      worker.terminate();
      rejectFn(new Error('已取消'));
    },
  };
}

export function optimizeTask(req: OptimizeRequest, onProgress?: (d: number, t: number) => void): Task<OptimizeResult> {
  return runTask({ type: 'optimize', payload: req }, (p) => runOptimize(req, p), { onProgress });
}

/** 计算策略仓位。代码策略放到 Worker 中运行，防止死循环卡住页面。 */
export async function computeStrategy(spec: StrategySpec, bars: Bar[], params: Params): Promise<StrategyOutput> {
  if (spec.type === 'custom' && spec.custom.kind === 'code') {
    return runTask<StrategyOutput>(
      { type: 'strategy', payload: { spec, bars, params } },
      () => resolveStrategy(spec).run(bars, params),
      { timeout: 8000 },
    ).promise;
  }
  return resolveStrategy(spec).run(bars, params);
}
