import type { ChordPerformanceRecord, CurriculumDayRecord, DailySessionResult } from '../types';

const CURRICULUM_KEY = 'chord-sprint:curriculum:v1';
const BEST_KEY = 'chord-sprint:sixty-best:v1';
const PERFORMANCE_KEY = 'chord-sprint:performance:v1';

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadCurriculum(): CurriculumDayRecord[] {
  return safeRead<CurriculumDayRecord[]>(CURRICULUM_KEY, []);
}

export function saveCurriculum(records: CurriculumDayRecord[]): void {
  try {
    localStorage.setItem(CURRICULUM_KEY, JSON.stringify(records));
  } catch (error: unknown) {
    throw new Error(`練習履歴を保存できませんでした: ${error instanceof Error ? error.message : '保存領域を確認してください'}`);
  }
}

export function applyDailySessionResult(
  records: readonly CurriculumDayRecord[],
  result: DailySessionResult,
  practicedAt = new Date().toISOString(),
): CurriculumDayRecord[] {
  const existing = records.find((record) => record.day === result.day);
  const updated: CurriculumDayRecord = {
    day: result.day,
    minutes: (existing?.minutes ?? 0) + result.minutes,
    accuracy: result.accuracy,
    averageMs: result.averageMs,
    completed: (existing?.completed ?? false) || result.passed,
    lastPracticedAt: practicedAt,
  };
  return [...records.filter((record) => record.day !== result.day), updated].sort((a, b) => a.day - b.day);
}

export function saveDailySessionResult(result: DailySessionResult): CurriculumDayRecord[] {
  const next = applyDailySessionResult(loadCurriculum(), result);
  saveCurriculum(next);
  return next;
}

export function loadPerformance(): ChordPerformanceRecord[] {
  return safeRead<ChordPerformanceRecord[]>(PERFORMANCE_KEY, []);
}

export function savePerformance(records: readonly ChordPerformanceRecord[]): void {
  try {
    localStorage.setItem(PERFORMANCE_KEY, JSON.stringify(records));
  } catch (error: unknown) {
    throw new Error(`コード別成績を保存できませんでした: ${error instanceof Error ? error.message : '保存領域を確認してください'}`);
  }
}

export function loadSixtyBest(): number {
  return safeRead<number>(BEST_KEY, 0);
}

export function saveSixtyBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(score));
  } catch {
    // Best score failure is non-fatal during an active timed practice.
  }
}

export function curriculumCsv(records: CurriculumDayRecord[], titles: readonly string[]): string {
  const header = ['日', '内容', '練習時間（分）', '正解率（%）', '平均反応時間（ms）', '完了'];
  const rows = records.map((record) => [
    record.day,
    titles[record.day - 1] ?? '',
    record.minutes,
    record.accuracy,
    record.averageMs,
    record.completed ? 'はい' : 'いいえ',
  ]);
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return `\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')}`;
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
