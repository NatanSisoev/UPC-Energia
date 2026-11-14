/// <reference lib="webworker" />
import { computeJob, type JobKind } from './sweeps.core';
import type { ReplayWeek } from '../types';

/** Runs one sweep job off the main thread; posts progress and the result. */
self.onmessage = (e: MessageEvent<{ id: number; kind: JobKind; weeks: ReplayWeek[] }>) => {
  const { id, kind, weeks } = e.data;
  const result = computeJob(kind, weeks, (done, total) => self.postMessage({ id, type: 'progress', done, total }));
  self.postMessage({ id, type: 'result', result });
};
