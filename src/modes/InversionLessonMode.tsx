import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { chordName, pitchClassNameForTarget, toPitchClass } from '../music/chordDefinitions';
import { bestInversion, fingeringMap, recommendedVoicing, totalVoiceMovement, voicingPitchClasses } from '../music/voicings';
import type { CurriculumDayDefinition, DailySessionResult, Inversion, KeyboardGuideState } from '../types';

const INVERSION_NAMES: readonly Inversion[] = ['基本形', '第1転回形', '第2転回形'];

interface Props {
  definition: CurriculumDayDefinition;
  notes: readonly number[];
  onGuideChange: (guide: KeyboardGuideState) => void;
  onComplete: (result: DailySessionResult) => void;
}

export function InversionLessonMode({ definition, notes, onGuideChange, onComplete }: Props) {
  const [question, setQuestion] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [waitingRelease, setWaitingRelease] = useState(false);
  const previousVoicing = useRef<number[]>([]);
  const startedAt = useRef(nowMs());
  const target = definition.targets[question % definition.targets.length]!;
  const inversion = (question % 3) as 0 | 1 | 2;
  const expectedNotes = useMemo(() => recommendedVoicing(target, inversion), [inversion, target]);
  const targetPcs = useMemo(() => voicingPitchClasses(target), [target]);
  const analysis = analyzeChord(target, notes);
  const expectedInversion = INVERSION_NAMES[inversion]!;
  const exact = analysis.isExact && analysis.inversion === expectedInversion;
  const guided = question < Math.ceil(definition.questionCount / 2);
  const correctNotes = useMemo(() => notes.filter((note) => targetPcs.includes(toPitchClass(note))), [notes, targetPcs]);
  const extraNotes = useMemo(() => notes.filter((note) => !targetPcs.includes(toPitchClass(note))), [notes, targetPcs]);
  const movement = totalVoiceMovement(previousVoicing.current, expectedNotes);
  const optimal = bestInversion(previousVoicing.current, target);

  useEffect(() => {
    onGuideChange({ guideNotes: guided ? expectedNotes : [], leftGuideNotes: [], correctActiveNotes: correctNotes, extraActiveNotes: extraNotes, fingering: guided ? fingeringMap(expectedNotes) : {}, spelling: target.spelling ?? 'flat' });
    return () => onGuideChange({ guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' });
  }, [correctNotes, expectedNotes, extraNotes, guided, onGuideChange, target.spelling]);

  useEffect(() => {
    if (waitingRelease || !exact) return;
    setCorrect((value) => value + 1);
    setAttempts((value) => value + 1);
    setWaitingRelease(true);
  }, [exact, waitingRelease]);

  useEffect(() => {
    if (waitingRelease || notes.length < expectedNotes.length || exact) return;
    setAttempts((value) => value + 1);
  }, [exact, expectedNotes.length, notes.length, waitingRelease]);

  useEffect(() => {
    if (!waitingRelease || notes.length > 0) return;
    previousVoicing.current = expectedNotes;
    const next = question + 1;
    if (next >= definition.questionCount) {
      const accuracy = Math.round(((correct + 1) / Math.max(attempts + 1, 1)) * 100);
      onComplete({ day: definition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs: 0, passed: accuracy >= definition.passAccuracy });
      return;
    }
    setQuestion(next);
    setWaitingRelease(false);
  }, [attempts, correct, definition.day, definition.passAccuracy, definition.questionCount, expectedNotes, notes.length, onComplete, question, waitingRelease]);

  return <div className="mode-layout" data-testid="lesson-inversion"><section className="practice-stage guided-stage"><div className="stage-topline"><span className="mode-kicker">DAY 4 · INVERSION</span><span>{question + 1}/{definition.questionCount} · {guided ? 'ガイドあり' : '自力'}</span></div><div className="target-chord guided-target"><span>{waitingRelease ? '正解！ 音を離して次へ' : `${expectedInversion}を弾く`}</span><strong>{chordName(target)}</strong><small>最低音を{pitchClassNameForTarget(toPitchClass(expectedNotes[0]!), target)}にする</small></div><div className="hands-instruction"><span>指定：{expectedInversion}</span><span>前の形から {movement}半音移動</span></div><p className="fingering-hint">最小移動の候補：{INVERSION_NAMES[optimal.inversion]}（{optimal.movement}半音）</p><div className={`learning-feedback ${notes.length >= expectedNotes.length && !exact ? 'bad' : ''}`}>{notes.length >= expectedNotes.length && !exact ? `現在は${analysis.inversion ?? '判定中'}。指定された最低音を確認してください` : guided ? '●の鍵盤と指番号を参考にしてください' : 'ガイドなしで指定転回形を作りましょう'}</div></section><aside className="mode-sidebar"><section className="panel"><span className="eyebrow">VOICE LEADING</span><h3>近い形へつなぐ</h3><p className="hint">基本形・第1・第2転回形を均等に出題します。基本形だけでは合格できません。</p></section><section className="panel stats-grid"><div><span>正解</span><strong>{correct}</strong></div><div><span>試行</span><strong>{attempts}</strong></div></section></aside></div>;
}

function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
