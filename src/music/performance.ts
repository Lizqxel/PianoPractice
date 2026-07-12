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
    ...existing,
    id,
    target,
    attempts: (existing?.attempts ?? 0) + 1,
    correct: (existing?.correct ?? 0) + (correct ? 1 : 0),
    totalReactionMs: (existing?.totalReactionMs ?? 0) + (correct ? reactionMs : 0),
    lastPracticedAt: now,
  };
  return [...records.filter((record) => record.id !== id), updated];
}

export function recordLearningAttempt(
  records: readonly ChordPerformanceRecord[],
  target: ChordTarget,
  result: { correct: boolean; guided: boolean; hintUsed: boolean; reactionMs: number },
  now = new Date().toISOString(),
): ChordPerformanceRecord[] {
  const base = recordAttempt(records, target, result.correct, result.reactionMs, now);
  const id = targetId(target);
  return base.map((record) => {
    if (record.id !== id) return record;
    const recentResults = [...(record.recentResults ?? []), result.correct].slice(-10);
    const unguidedCorrect = (record.unguidedCorrect ?? 0) + (result.correct && !result.guided && !result.hintUsed ? 1 : 0);
    const recentAccuracy = recentResults.filter(Boolean).length / recentResults.length;
    return {
      ...record,
      guidedCorrect: (record.guidedCorrect ?? 0) + (result.correct && (result.guided || result.hintUsed) ? 1 : 0),
      unguidedCorrect,
      mistakes: (record.mistakes ?? 0) + (result.correct ? 0 : 1),
      hintUses: (record.hintUses ?? 0) + (result.hintUsed ? 1 : 0),
      recentResults,
      mastered: unguidedCorrect >= 2 && recentAccuracy >= 0.8,
    };
  });
}

export function learningSummary(records: readonly ChordPerformanceRecord[]): { mastered: number; learning: number; weak: ChordTarget[] } {
  return {
    mastered: records.filter((record) => record.mastered).length,
    learning: records.filter((record) => !record.mastered && record.attempts > 0).length,
    weak: extractWeakTargets(records),
  };
}

export function isLearningRecordMastered(record: ChordPerformanceRecord | undefined): boolean {
  if (!record || !record.mastered || (record.unguidedCorrect ?? 0) < 2) return false;
  const recent = record.recentResults ?? [];
  return recent.length > 0 && recent.filter(Boolean).length / recent.length >= 0.8;
}

export function areTargetsMastered(targets: readonly ChordTarget[], records: readonly ChordPerformanceRecord[]): boolean {
  return targets.every((target) => isLearningRecordMastered(records.find((record) => record.id === targetId(target))));
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
