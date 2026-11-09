/// <reference lib="webworker" />
import { runOptimize, type OptimizeRequest } from '../lib/optimize';
import { resolveStrategy, type StrategySpec } from '../lib/strategies';
import type { Params } from '../lib/strategies/types';
import type { Bar } from '../lib/types';

type Msg =
  | { type: 'optimize'; payload: OptimizeRequest }
  | { type: 'strategy'; payload: { spec: StrategySpec; bars: Bar[]; params: Params } };

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'optimize') {
      const result = runOptimize(msg.payload, (done, total) => self.postMessage({ type: 'progress', done, total }));
      self.postMessage({ type: 'done', result });
    } else if (msg.type === 'strategy') {
      const def = resolveStrategy(msg.payload.spec);
      const result = def.run(msg.payload.bars, msg.payload.params);
      self.postMessage({ type: 'done', result });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message || String(err) });
  }
};
