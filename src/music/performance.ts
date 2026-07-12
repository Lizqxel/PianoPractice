import type { ChordPerformanceRecord, ChordTarget } from '../types';

export function targetId(target: ChordTarget): string {
  return `${target.root}:${target.quality}:${target.bass ?? '-'}`;
}

export function recordAttempt(
  records: readonly ChordPerformanceRecord[],
  target: ChordTarget,
  correct: boolean,
  reactionMs: number,
  now = new Date().toISOString(),
): ChordPerformanceRecord[] {
  const id = targetId(target);
  const existing = records.find((record) => record.id === id);
  const updated: ChordPerformanceRecord = {
    id,
    target,
    attempts: (existing?.attempts ?? 0) + 1,
    correct: (existing?.correct ?? 0) + (correct ? 1 : 0),
    totalReactionMs: (existing?.totalReactionMs ?? 0) + (correct ? reactionMs : 0),
    lastPracticedAt: now,
  };
  return [...records.filter((record) => record.id !== id), updated];
}

export function performanceAccuracy(record: ChordPerformanceRecord): number {
  return record.attempts === 0 ? 0 : (record.correct / record.attempts) * 100;
}

export function performanceAverageMs(record: ChordPerformanceRecord): number {
  return record.correct === 0 ? Number.POSITIVE_INFINITY : record.totalReactionMs / record.correct;
}

export function extractWeakTargets(records: readonly ChordPerformanceRecord[]): ChordTarget[] {
  return records
    .filter((record) => record.attempts >= 2 && (performanceAccuracy(record) < 75 || performanceAverageMs(record) > 2500))
    .sort((a, b) => {
      const accuracyGap = performanceAccuracy(a) - performanceAccuracy(b);
      return accuracyGap !== 0 ? accuracyGap : performanceAverageMs(b) - performanceAverageMs(a);
    })
    .slice(0, 12)
    .map((record) => record.target);
}
