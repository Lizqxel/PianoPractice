import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord, analyzeHands } from '../music/chordMatcher';
import { chordName, pitchClassNameForTarget, toPitchClass } from '../music/chordDefinitions';
import { areTargetsMastered, isLearningRecordMastered, recordLearningAttempt, targetId } from '../music/performance';
import { fingeringMap, recommendedBassNote, recommendedVoicing, sameMidiNotes, voicingNoteNames, voicingPitchClasses } from '../music/voicings';
import { loadPerformance, savePerformance } from '../services/storage';
import type { ChordPerformanceRecord, CurriculumDayDefinition, DailySessionResult, KeyboardGuideState } from '../types';

type LearningPhase = 'shape' | 'hinted' | 'independent';

interface GuidedChordLearningModeProps {
  definition: CurriculumDayDefinition;
  notes: readonly number[];
  splitNote: number;
  onGuideChange: (guide: KeyboardGuideState) => void;
  onComplete: (result: DailySessionResult) => void;
}

export function GuidedChordLearningMode({ definition, notes, splitNote, onGuideChange, onComplete }: GuidedChordLearningModeProps) {
  const [phase, setPhase] = useState<LearningPhase>('shape');
  const [index, setIndex] = useState(0);
  const [performance, setPerformance] = useState<ChordPerformanceRecord[]>(loadPerformance);
  const [showGuide, setShowGuide] = useState(true);
  const [wrong, setWrong] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [allowFlexibleVoicing, setAllowFlexibleVoicing] = useState(false);
  const [waitingRelease, setWaitingRelease] = useState(false);
  const [revealedNotes, setRevealedNotes] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [totalReactionMs, setTotalReactionMs] = useState(0);
  const startedAt = useRef(nowMs());
  const questionStartedAt = useRef(nowMs());
  const lastMistake = useRef('');

  const targets = definition.targets;
  const target = targets[index % targets.length]!;
  const recommended = useMemo(() => recommendedVoicing(target), [target]);
  const bassNote = target.bass === undefined ? null : recommendedBassNote(target);
  const targetPcs = useMemo(() => voicingPitchClasses(target), [target]);
  const requiredNoteCount = recommended.length + (bassNote === null ? 0 : 1);
  const handAnalysis = analyzeHands(target, notes, splitNote);
  const wholeAnalysis = analyzeChord(target, notes);
  const expectedMidi = useMemo(() => bassNote === null ? recommended : [bassNote, ...recommended], [bassNote, recommended]);
  const recommendedExact = sameMidiNotes(notes, expectedMidi);
  const flexibleExact = target.bass === undefined ? wholeAnalysis.isExact : handAnalysis.isExact;
  const isExact = phase === 'shape' || phase === 'hinted' || !allowFlexibleVoicing ? recommendedExact : flexibleExact;
  const attemptIsGuided = phase !== 'independent' || hintUsed;

  const classified = useMemo(() => {
    const correctNotes: number[] = [];
    const extraNotes: number[] = [];
    for (const note of notes) {
      const pc = toPitchClass(note);
      const strict = phase !== 'independent' || !allowFlexibleVoicing;
      const valid = strict ? expectedMidi.includes(note) : target.bass !== undefined && note < splitNote ? pc === target.bass : targetPcs.includes(pc);
      (valid ? correctNotes : extraNotes).push(note);
    }
    return { correctNotes, extraNotes };
  }, [allowFlexibleVoicing, expectedMidi, notes, phase, splitNote, target.bass, targetPcs]);

  useEffect(() => {
    if (phase === 'shape') setShowGuide(true);
    if (phase === 'hinted') {
      setShowGuide(true);
      const timer = window.setTimeout(() => setShowGuide(false), 2000);
      return () => window.clearTimeout(timer);
    }
    if (phase === 'independent') setShowGuide(false);
    return undefined;
  }, [index, phase]);

  useEffect(() => {
    onGuideChange({
      guideNotes: showGuide ? recommended : [],
      leftGuideNotes: showGuide && bassNote !== null ? [bassNote] : [],
      correctActiveNotes: classified.correctNotes,
      extraActiveNotes: classified.extraNotes,
      fingering: showGuide ? fingeringMap(recommended) : {},
      spelling: target.spelling ?? 'flat',
    });
    return () => onGuideChange(emptyKeyboardGuide());
  }, [bassNote, classified.correctNotes, classified.extraNotes, onGuideChange, recommended, showGuide, target.spelling]);

  useEffect(() => {
    if (waitingRelease || notes.length < requiredNoteCount || isExact) return;
    const signature = notes.join(',');
    if (signature === lastMistake.current) return;
    lastMistake.current = signature;
    setWrong(true);
    if (phase === 'hinted') setShowGuide(true);
    setAttempts((value) => value + 1);
    setPerformance((current) => persist(recordLearningAttempt(current, target, { correct: false, guided: attemptIsGuided, hintUsed, reactionMs: nowMs() - questionStartedAt.current })));
  }, [attemptIsGuided, hintUsed, isExact, notes, phase, requiredNoteCount, showGuide, target, waitingRelease]);

  useEffect(() => {
    if (waitingRelease || !isExact) return;
    const reactionMs = nowMs() - questionStartedAt.current;
    setAttempts((value) => value + 1);
    setCorrect((value) => value + 1);
    setTotalReactionMs((value) => value + reactionMs);
    setPerformance((current) => persist(recordLearningAttempt(current, target, { correct: true, guided: attemptIsGuided, hintUsed, reactionMs })));
    setWaitingRelease(true);
    setRevealedNotes(1);
  }, [attemptIsGuided, hintUsed, isExact, phase, showGuide, target, waitingRelease]);

  useEffect(() => {
    if (!waitingRelease || revealedNotes >= recommended.length) return undefined;
    const timer = window.setTimeout(() => setRevealedNotes((value) => value + 1), 320);
    return () => window.clearTimeout(timer);
  }, [recommended.length, revealedNotes, waitingRelease]);

  useEffect(() => {
    if (!waitingRelease || notes.length > 0) return;
    const nextIndex = index + 1;
    const endOfPass = nextIndex >= targets.length;
    if (phase === 'shape' && endOfPass) { setPhase('hinted'); setIndex(0); }
    else if (phase === 'hinted' && nextIndex >= targets.length * 2) { setPhase('independent'); setIndex(0); }
    else if (phase === 'hinted') setIndex(nextIndex);
    else if (phase === 'independent') {
      const masteredAll = areTargetsMastered(targets, performance);
      if (masteredAll) {
        const accuracy = attempts === 0 ? 100 : Math.round((correct / attempts) * 100);
        onComplete({ day: definition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs: correct ? Math.round(totalReactionMs / correct) : 0, passed: true });
        return;
      }
      let candidate = (index + 1) % targets.length;
      for (let offset = 0; offset < targets.length; offset += 1) {
        const possible = (candidate + offset) % targets.length;
        const record = performance.find((item) => item.id === targetId(targets[possible]!));
        if (!isLearningRecordMastered(record)) { candidate = possible; break; }
      }
      setIndex(candidate);
    } else setIndex(nextIndex);
    setWaitingRelease(false);
    setWrong(false);
    setHintUsed(false);
    setRevealedNotes(0);
    lastMistake.current = '';
    questionStartedAt.current = nowMs();
  }, [attempts, correct, definition.day, hintUsed, index, notes.length, onComplete, performance, phase, target, targets, totalReactionMs, waitingRelease]);

  const phaseLabel = phase === 'shape' ? 'A · 形を覚える' : phase === 'hinted' ? 'B · ヒント付き' : 'C · 自力確認';
  const noteNames = voicingNoteNames(target);
  const learned = targets.filter((item) => isLearningRecordMastered(performance.find((record) => record.id === targetId(item)))).length;
  const formula = target.quality === 'minor' || target.quality === 'm7' ? 'マイナーコード：ルートから3半音、さらに4半音' : target.quality === 'major' ? 'メジャーコード：ルートから4半音、さらに3半音' : '構成音を一音ずつ確認して形を覚えましょう';

  return <div className="mode-layout guided-layout" data-testid={`lesson-${definition.lessonType}`}>
    <section className="practice-stage guided-stage">
      <div className="stage-topline"><span className="mode-kicker">DAY {definition.day} · GUIDED LEARNING</span><span>{phaseLabel}</span></div>
      <div className="target-chord guided-target"><span>{waitingRelease ? '正解！ 音を離して次へ' : 'この形を覚える'}</span><strong>{chordName(target)}</strong><small>{noteNames.join('・')}</small></div>
      <div className="note-reading">{noteNames.map((name, noteIndex) => <span className={waitingRelease && noteIndex < revealedNotes ? 'revealed' : ''} key={`${name}-${noteIndex}`}>{name}</span>)}</div>
      {phase === 'shape' && <p className="chord-formula">{formula}</p>}
      {target.bass !== undefined && <div className="hands-instruction"><span>左手：{pitchClassNameForTarget(target.bass, target)}</span><span>右手：{noteNames.join('・')}</span></div>}
      {showGuide && <p className="fingering-hint">おすすめ指使い：{recommended.length === 3 ? '1・3・5' : '1・2・3・5'}（親指が1）</p>}
      {wrong && phase === 'independent' && !showGuide && <button className="button secondary" type="button" onClick={() => { setShowGuide(true); setHintUsed(true); }}>ヒントを見る</button>}
      <div className={`learning-feedback ${wrong ? 'bad' : ''}`}>{wrong ? '赤い×の鍵盤を離し、ガイドを確認しましょう' : waitingRelease ? `構成音：${noteNames.join(' → ')}` : phase === 'hinted' && !showGuide ? 'ヒントを隠しました。コードネームから弾いてみましょう' : 'ガイドの●とおすすめ指番号を見て弾きましょう'}</div>
    </section>
    <aside className="mode-sidebar"><section className="panel"><span className="eyebrow">PROGRESS</span><h3>{phaseLabel}</h3><div className="learning-progress"><div><span>覚えた</span><strong>{learned}/{targets.length}</strong></div><div><span>正解</span><strong>{correct}</strong></div></div><p className="hint">各コードをガイドなしで2回以上正解し、直近正解率80%以上で「覚えた」になります。</p>{phase === 'independent' && <label className="check-row"><input type="checkbox" checked={allowFlexibleVoicing} onChange={(event) => setAllowFlexibleVoicing(event.target.checked)} />別オクターブ・転回形も正解にする</label>}</section><section className="panel chord-roster">{targets.map((item) => { const record = performance.find((entry) => entry.id === targetId(item)); return <div className={isLearningRecordMastered(record) ? 'mastered' : ''} key={targetId(item)}><span>{chordName(item)}</span><b>{Math.min(2, record?.unguidedCorrect ?? 0)}/2</b></div>; })}</section></aside>
  </div>;
}

export function emptyKeyboardGuide(): KeyboardGuideState {
  return { guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' };
}

function persist(records: ChordPerformanceRecord[]): ChordPerformanceRecord[] {
  savePerformance(records);
  return records;
}

function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
