import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord, analyzeHands } from '../music/chordMatcher';
import { chordName } from '../music/chordDefinitions';
import { getCurriculumDay } from '../music/curriculum';
import { recommendedBassNote, recommendedVoicing } from '../music/voicings';
import type { AudioEngine } from '../services/audioEngine';
import type { ChordTarget, CurriculumDayDefinition, DailySessionResult, Inversion, KeyboardGuideState } from '../types';
import { ProgressionMode } from './ProgressionMode';
import { SequenceLessonMode } from './SequenceLessonMode';

type MixedKind = 'コード瞬発' | '転回形チェンジ' | '分数コード';
type MixedStage = 'knowledge' | 'progression' | 'sight';
interface MixedTask { kind: MixedKind; target: ChordTarget; inversion?: 0 | 1 | 2 }
const INV_NAMES: readonly Inversion[] = ['基本形', '第1転回形', '第2転回形'];

interface Props {
  definition: CurriculumDayDefinition;
  notes: readonly number[];
  splitNote: number;
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  metronomeVolume: number;
  onMetronomeVolumeChange: (volume: number) => void;
  onGuideChange: (guide: KeyboardGuideState) => void;
  onComplete: (result: DailySessionResult) => void;
  onSessionStart: () => void;
  onAllNotesOff: () => void;
  initialStage?: MixedStage;
}

export function MixedTestMode(props: Props) {
  const { definition, notes, splitNote, onGuideChange, onComplete } = props;
  const tasks = useMemo(createKnowledgeTasks, []);
  const [stage, setStage] = useState<MixedStage>(props.initialStage ?? 'knowledge');
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [review, setReview] = useState(false);
  const [waitingRelease, setWaitingRelease] = useState(false);
  const startedAt = useRef(nowMs());
  const sectionResults = useRef<DailySessionResult[]>([]);
  const task = tasks[Math.min(index, tasks.length - 1)]!;
  const whole = analyzeChord(task.target, notes);
  const hand = analyzeHands(task.target, notes, splitNote);
  const exact = task.kind === '分数コード' ? hand.isExact : task.kind === '転回形チェンジ' ? whole.isExact && whole.inversion === INV_NAMES[task.inversion ?? 0] : whole.isExact;
  const expected = useMemo(() => recommendedVoicing(task.target, task.inversion ?? 0), [task]);

  useEffect(() => {
    if (stage === 'knowledge' && !waitingRelease && !review && notes.length >= expected.length + (task.target.bass === undefined ? 0 : 1) && !exact) { setReview(true); setAttempts((value) => value + 1); }
  }, [exact, expected.length, notes.length, review, stage, task.target.bass, waitingRelease]);

  useEffect(() => {
    if (stage !== 'knowledge' || waitingRelease || !exact) return;
    setCorrect((value) => value + 1); setAttempts((value) => value + 1); setWaitingRelease(true);
  }, [exact, stage, waitingRelease]);

  useEffect(() => {
    if (stage !== 'knowledge') return undefined;
    onGuideChange({ guideNotes: review ? expected : [], leftGuideNotes: review && task.target.bass !== undefined ? [recommendedBassNote(task.target)] : [], correctActiveNotes: exact ? notes : [], extraActiveNotes: review && !exact ? notes : [], fingering: {}, spelling: task.target.spelling ?? 'flat' });
    return () => onGuideChange(emptyGuide());
  }, [exact, expected, notes, onGuideChange, review, stage, task.target]);

  useEffect(() => {
    if (stage !== 'knowledge' || !waitingRelease || notes.length > 0) return;
    const next = index + 1;
    if (next >= tasks.length) {
      const accuracy = Math.round(((correct + 1) / Math.max(1, attempts + 1)) * 100);
      sectionResults.current = [{ day: 14, minutes: 0, accuracy, averageMs: 0, passed: accuracy >= 80 }];
      setStage('progression'); onGuideChange(emptyGuide());
      return;
    }
    setIndex(next); setReview(false); setWaitingRelease(false);
  }, [attempts, correct, index, notes.length, onGuideChange, stage, tasks.length, waitingRelease]);

  const progressionDefinition: CurriculumDayDefinition = { ...getCurriculumDay(6), day: 14, lessonType: 'progression', questionCount: 16, passAccuracy: 80 };
  const sightDefinition: CurriculumDayDefinition = { ...getCurriculumDay(12), day: 14, lessonType: 'sightReading', questionCount: 8, passAccuracy: 80 };

  if (stage === 'progression') return <div data-testid="lesson-mixedTest" data-day14-section="progression"><ProgressionMode notes={notes} audio={props.audio} bpm={props.bpm} onBpmChange={props.onBpmChange} curriculumDefinition={progressionDefinition} onGuideChange={onGuideChange} onSessionStart={props.onSessionStart} onAllNotesOff={props.onAllNotesOff} metronomeVolume={props.metronomeVolume} onMetronomeVolumeChange={props.onMetronomeVolumeChange} onComplete={(result) => { sectionResults.current.push(result); setStage('sight'); }} /></div>;
  if (stage === 'sight') return <div data-testid="lesson-mixedTest" data-day14-section="sight"><SequenceLessonMode kind="sightReading" definition={sightDefinition} notes={notes} audio={props.audio} bpm={props.bpm} onBpmChange={props.onBpmChange} onGuideChange={onGuideChange} onSessionStart={props.onSessionStart} onAllNotesOff={props.onAllNotesOff} metronomeVolume={props.metronomeVolume} fixedSightLength={8} onComplete={(result) => {
    const all = [...sectionResults.current, result];
    const accuracy = Math.round(all.reduce((sum, item) => sum + item.accuracy, 0) / all.length);
    const measured = all.filter((item) => item.averageMs > 0);
    const averageMs = measured.length ? Math.round(measured.reduce((sum, item) => sum + item.averageMs, 0) / measured.length) : 0;
    onComplete({ day: definition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs, passed: all.length === 3 && all.every((item) => item.passed) && accuracy >= definition.passAccuracy });
  }} /></div>;

  const stageStart = tasks.findIndex((item) => item.kind === task.kind);
  const stageTotal = tasks.filter((item) => item.kind === task.kind).length;
  return <div className="mode-layout" data-testid="lesson-mixedTest" data-day14-section="knowledge"><section className="practice-stage guided-stage"><div className="stage-topline"><span className="mode-kicker">DAY 14 · FINAL TEST</span><span>{task.kind} {index - stageStart + 1}/{stageTotal}</span></div><div className="target-chord guided-target"><span>{task.kind}{task.inversion !== undefined ? ` · ${INV_NAMES[task.inversion]}` : ''}</span><strong>{chordName(task.target)}</strong><small>{review ? '不正解後の復習ガイドを表示中' : '事前ガイドなし'}</small></div><div className={`learning-feedback ${review ? 'bad' : ''}`}>{waitingRelease ? '正解。音を離して次へ' : review ? '●の鍵盤で正しい形を復習してください' : 'ガイドなしで弾いてください'}</div></section><aside className="mode-sidebar"><section className="panel"><span className="eyebrow">TOTAL</span><h3>{index + 1}/22</h3><p className="hint">瞬発10問 → 転回形8問 → 分数4問 → メトロノーム進行4周 → 初見8小節</p></section><section className="panel stats-grid"><div><span>正解</span><strong>{correct}</strong></div><div><span>試行</span><strong>{attempts}</strong></div></section></aside></div>;
}

function createKnowledgeTasks(): MixedTask[] {
  const basics = getCurriculumDay(1).targets;
  const slash = getCurriculumDay(9).targets;
  const tasks: MixedTask[] = [];
  for (let i = 0; i < 10; i += 1) tasks.push({ kind: 'コード瞬発', target: basics[i % basics.length]! });
  for (let i = 0; i < 8; i += 1) tasks.push({ kind: '転回形チェンジ', target: basics[i % basics.length]!, inversion: (i % 3) as 0 | 1 | 2 });
  for (let i = 0; i < 4; i += 1) tasks.push({ kind: '分数コード', target: slash[i]! });
  return tasks;
}
function emptyGuide(): KeyboardGuideState { return { guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' }; }
function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
