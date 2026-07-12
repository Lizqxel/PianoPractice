import type { ChordPerformanceRecord, ChordQuality, ChordTarget, CurriculumDayDefinition, PitchClass } from '../types';
import { extractWeakTargets } from './performance';

const chord = (root: PitchClass, quality: ChordQuality = 'major', bass?: PitchClass, spelling?: 'sharp' | 'flat'): ChordTarget => {
  const target: ChordTarget = { root, quality };
  if (bass !== undefined) target.bass = bass;
  if (spelling !== undefined) target.spelling = spelling;
  return target;
};

const majorMinor = (roots: readonly PitchClass[]): ChordTarget[] =>
  roots.flatMap((root) => [chord(root), chord(root, 'minor')]);

const day1 = [chord(0), chord(5), chord(7), chord(9, 'minor'), chord(2, 'minor'), chord(4, 'minor')];
const day2 = majorMinor([2, 9, 4, 11]).map((target) => ({ ...target, spelling: 'sharp' as const }));
const day3 = majorMinor([1, 3, 6, 8, 10]).map((target) => ({ ...target, spelling: 'flat' as const }));
const advanced = ([0, 5, 7] as PitchClass[]).flatMap((root) =>
  (['7', 'maj7', 'm7', 'sus4', 'add9'] as ChordQuality[]).map((quality) => chord(root, quality)),
);
const slashChords = [chord(0, 'major', 4), chord(0, 'major', 7), chord(2, 'major', 6, 'sharp'), chord(7, 'major', 11, 'sharp')];
const allTriads = majorMinor([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

export const CURRICULUM_DAYS: readonly CurriculumDayDefinition[] = [
  { day: 1, lessonType: 'guidedChordLearning', title: 'C、F、G、Am、Dm、Em', description: '白鍵中心の基本6コード', targets: day1, questionCount: 24, passAccuracy: 80, maxAverageMs: 5000 },
  { day: 2, lessonType: 'guidedChordLearning', title: 'D、A、E、Bと各マイナー', description: 'シャープ系コードを覚える', targets: day2, questionCount: 32, passAccuracy: 80, maxAverageMs: 5000 },
  { day: 3, lessonType: 'guidedChordLearning', title: 'Db、Eb、Gb、Ab、Bbと各マイナー', description: 'フラット系コードを覚える', targets: day3, questionCount: 40, passAccuracy: 80, maxAverageMs: 5500 },
  { day: 4, lessonType: 'inversion', title: '転回形', description: '右手の転回形を使って素早く移動', targets: day1, questionCount: 18, passAccuracy: 80, maxAverageMs: 4500 },
  { day: 5, lessonType: 'bassChord', title: '左手ベース＋右手コード', description: '左手ルートと右手コードを分離', targets: day1.map((target) => chord(target.root, target.quality, target.root)), questionCount: 18, passAccuracy: 80, maxAverageMs: 5500 },
  { day: 6, lessonType: 'progression', title: '定番4コード進行', description: 'I–V–vi–IVを8周止まらず演奏', targets: [chord(0), chord(7), chord(9, 'minor'), chord(5)], questionCount: 32, passAccuracy: 85, maxAverageMs: 4000 },
  { day: 7, lessonType: 'sprint', title: '第1回テスト', description: '基本メジャー・マイナー総復習', targets: allTriads, questionCount: 24, passAccuracy: 80, maxAverageMs: 4500 },
  { day: 8, lessonType: 'guidedChordLearning', title: '7、maj7、m7、sus4、add9', description: 'よく使う4音コードとsus4', targets: advanced, questionCount: 30, passAccuracy: 80, maxAverageMs: 6000 },
  { day: 9, lessonType: 'slashChord', title: '分数コード', description: '右手コードと左手ベースを別々に意識', targets: slashChords, questionCount: 16, passAccuracy: 80, maxAverageMs: 6000 },
  { day: 10, lessonType: 'progression', title: 'キー変更', description: 'C・G・D・F・AでI–V–vi–IV', targets: allTriads, questionCount: 40, passAccuracy: 80, maxAverageMs: 5500 },
  { day: 11, lessonType: 'song', title: '実曲練習', description: '自分で作るコード譜を止まらず演奏', targets: [...day1, chord(10), chord(11, 'minor')], questionCount: 16, passAccuracy: 85, maxAverageMs: 4000 },
  { day: 12, lessonType: 'sightReading', title: '初見コード練習', description: '10秒確認してランダムコード譜を初見演奏', targets: allTriads, questionCount: 12, passAccuracy: 80, maxAverageMs: 4500 },
  { day: 13, lessonType: 'sprint', title: '苦手コード集中', description: '成績から苦手コードを自動抽出', targets: allTriads, questionCount: 20, passAccuracy: 85, maxAverageMs: 4500 },
  { day: 14, lessonType: 'mixedTest', title: '最終テスト', description: '瞬発・転回形・分数・進行・初見の総合テスト', targets: [...allTriads, ...advanced, ...slashChords], questionCount: 46, passAccuracy: 85, maxAverageMs: 4000 },
];

export function getCurriculumDay(day: number): CurriculumDayDefinition {
  return CURRICULUM_DAYS.find((definition) => definition.day === day) ?? CURRICULUM_DAYS[0]!;
}

export function targetsForDay(day: number, performance: readonly ChordPerformanceRecord[] = []): readonly ChordTarget[] {
  const definition = getCurriculumDay(day);
  if (day !== 13) return definition.targets;
  const weak = extractWeakTargets(performance);
  return weak.length > 0 ? weak : definition.targets;
}
