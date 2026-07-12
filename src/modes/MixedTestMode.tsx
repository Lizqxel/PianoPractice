import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord, analyzeHands } from '../music/chordMatcher';
import { chordName } from '../music/chordDefinitions';
import { getCurriculumDay } from '../music/curriculum';
import { recommendedBassNote, recommendedVoicing } from '../music/voicings';
import type { ChordTarget, CurriculumDayDefinition, DailySessionResult, Inversion, KeyboardGuideState } from '../types';

type MixedKind = 'コード瞬発' | '転回形チェンジ' | '分数コード' | '4コード進行' | '初見8小節';
interface MixedTask { kind: MixedKind; target: ChordTarget; inversion?: 0 | 1 | 2 }
const INV_NAMES: readonly Inversion[] = ['基本形', '第1転回形', '第2転回形'];

interface Props { definition: CurriculumDayDefinition; notes: readonly number[]; splitNote: number; onGuideChange: (guide: KeyboardGuideState) => void; onComplete: (result: DailySessionResult) => void }

export function MixedTestMode({ definition, notes, splitNote, onGuideChange, onComplete }: Props) {
  const tasks = useMemo(createTasks, []);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [review, setReview] = useState(false);
  const [waitingRelease, setWaitingRelease] = useState(false);
  const startedAt = useRef(nowMs());
  const task = tasks[index]!;
  const whole = analyzeChord(task.target, notes);
  const hand = analyzeHands(task.target, notes, splitNote);
  const exact = task.kind === '分数コード' ? hand.isExact : task.kind === '転回形チェンジ' ? whole.isExact && whole.inversion === INV_NAMES[task.inversion ?? 0] : whole.isExact;
  const expected = recommendedVoicing(task.target, task.inversion ?? 0);

  useEffect(() => {
    if (!waitingRelease && !review && notes.length >= expected.length + (task.target.bass === undefined ? 0 : 1) && !exact) { setReview(true); setAttempts((value) => value + 1); }
  }, [exact, expected.length, notes.length, review, task.target.bass, waitingRelease]);

  useEffect(() => {
    if (waitingRelease || !exact) return;
    setCorrect((value) => value + 1); setAttempts((value) => value + 1); setWaitingRelease(true);
  }, [exact, waitingRelease]);

  useEffect(() => {
    const guide = review ? expected : [];
    onGuideChange({ guideNotes: guide, leftGuideNotes: review && task.target.bass !== undefined ? [recommendedBassNote(task.target)] : [], correctActiveNotes: exact ? notes : [], extraActiveNotes: review && !exact ? notes : [], fingering: {}, spelling: task.target.spelling ?? 'flat' });
    return () => onGuideChange(emptyGuide());
  }, [exact, expected, notes, onGuideChange, review, task.target]);

  useEffect(() => {
    if (!waitingRelease || notes.length > 0) return;
    const next = index + 1;
    if (next >= tasks.length) {
      const accuracy = Math.round(((correct + 1) / Math.max(1, attempts + 1)) * 100);
      onComplete({ day: definition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs: 0, passed: accuracy >= definition.passAccuracy });
      return;
    }
    setIndex(next); setReview(false); setWaitingRelease(false);
  }, [attempts, correct, definition.day, definition.passAccuracy, index, notes.length, onComplete, tasks.length, waitingRelease]);

  const stageStart = tasks.findIndex((item) => item.kind === task.kind);
  const stageTotal = tasks.filter((item) => item.kind === task.kind).length;
  return <div className="mode-layout" data-testid="lesson-mixedTest"><section className="practice-stage guided-stage"><div className="stage-topline"><span className="mode-kicker">DAY 14 · FINAL TEST</span><span>{task.kind} {index - stageStart + 1}/{stageTotal}</span></div><div className="target-chord guided-target"><span>{task.kind}{task.inversion !== undefined ? ` · ${INV_NAMES[task.inversion]}` : ''}</span><strong>{chordName(task.target)}</strong><small>{review ? '不正解後の復習ガイドを表示中' : '事前ガイドなし'}</small></div>{task.kind === '4コード進行' && <p className="chord-formula">C → G → Am → Fを4周</p>}{task.kind === '初見8小節' && <p className="chord-formula">初見セクション：コードネームだけで演奏</p>}<div className={`learning-feedback ${review ? 'bad' : ''}`}>{waitingRelease ? '正解。音を離して次へ' : review ? '●の鍵盤で正しい形を復習してください' : 'ガイドなしで弾いてください'}</div></section><aside className="mode-sidebar"><section className="panel"><span className="eyebrow">TOTAL</span><h3>{index + 1}/{tasks.length}</h3><p className="hint">瞬発10問 → 転回形8問 → 分数4問 → 進行4周 → 初見8小節</p></section><section className="panel stats-grid"><div><span>正解</span><strong>{correct}</strong></div><div><span>試行</span><strong>{attempts}</strong></div></section></aside></div>;
}

function createTasks(): MixedTask[] {
  const basics = getCurriculumDay(1).targets;
  const slash = getCurriculumDay(9).targets;
  const progression = getCurriculumDay(6).targets;
  const tasks: MixedTask[] = [];
  for (let i = 0; i < 10; i += 1) tasks.push({ kind: 'コード瞬発', target: basics[i % basics.length]! });
  for (let i = 0; i < 8; i += 1) tasks.push({ kind: '転回形チェンジ', target: basics[i % basics.length]!, inversion: (i % 3) as 0 | 1 | 2 });
  for (let i = 0; i < 4; i += 1) tasks.push({ kind: '分数コード', target: slash[i]! });
  for (let i = 0; i < 16; i += 1) tasks.push({ kind: '4コード進行', target: progression[i % 4]! });
  for (let i = 0; i < 8; i += 1) tasks.push({ kind: '初見8小節', target: basics[(i * 5) % basics.length]! });
  return tasks;
}
function emptyGuide(): KeyboardGuideState { return { guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' }; }
function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
