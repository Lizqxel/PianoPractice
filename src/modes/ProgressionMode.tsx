import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { NOTE_NAMES_FLAT, chordNameForKey, chordPitchClasses, toPitchClass } from '../music/chordDefinitions';
import { PROGRESSIONS, progressionChords } from '../music/progressions';
import { recommendedVoicing } from '../music/voicings';
import type { AudioEngine } from '../services/audioEngine';
import { TempoScheduler } from '../services/tempoScheduler';
import type { CurriculumDayDefinition, DailySessionResult, KeyboardGuideState, PitchClass } from '../types';

interface ProgressionModeProps {
  notes: readonly number[];
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  curriculumDefinition?: CurriculumDayDefinition;
  onGuideChange?: (guide: KeyboardGuideState) => void;
  onComplete?: (result: DailySessionResult) => void;
  onSessionStart?: () => void;
  metronomeVolume?: number;
  onMetronomeVolumeChange?: (volume: number) => void;
  onAllNotesOff?: () => void;
}
type Division = 4 | 2 | 1;
const KEY_SEQUENCE: readonly PitchClass[] = [0, 7, 2, 5, 9];

export function ProgressionMode({ notes, audio, bpm, onBpmChange, curriculumDefinition, onGuideChange, onComplete, onSessionStart, metronomeVolume, onMetronomeVolumeChange, onAllNotesOff }: ProgressionModeProps) {
  const [patternId, setPatternId] = useState('pop');
  const [selectedKey, setSelectedKey] = useState<PitchClass>(0);
  const [division, setDivision] = useState<Division>(4);
  const [localClickVolume, setLocalClickVolume] = useState(55);
  const clickVolume = metronomeVolume ?? localClickVolume;
  const [running, setRunning] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [sessionStep, setSessionStep] = useState(0);
  const sessionStepRef = useRef(0);
  const [delays, setDelays] = useState<number[]>([]);
  const delaysRef = useRef<number[]>([]);
  const slotStartAudio = useRef(0);
  const scored = useRef(false);
  const scheduler = useRef<TempoScheduler | null>(null);
  const startedAt = useRef(0);
  const completed = useRef(false);
  const isCurriculum = curriculumDefinition?.lessonType === 'progression';
  const maxSteps = curriculumDefinition?.day === 10 ? 40 : curriculumDefinition?.day === 6 ? 32 : curriculumDefinition?.day === 14 ? 16 : Number.POSITIVE_INFINITY;
  const curriculumKey = curriculumDefinition?.day === 10 ? KEY_SEQUENCE[Math.min(4, Math.floor(sessionStep / 8))]! : 0;
  const keyRoot = isCurriculum ? curriculumKey : selectedKey;
  const pattern = PROGRESSIONS.find((item) => item.id === patternId) ?? PROGRESSIONS[0]!;
  const chords = useMemo(() => progressionChords(pattern, keyRoot), [keyRoot, pattern]);
  const current = chords[index % chords.length]!;
  const analysis = analyzeChord(current, notes);

  const finishCurriculum = (stopped = false, completedSteps = sessionStepRef.current) => {
    if (!curriculumDefinition || !onComplete || completed.current) return;
    completed.current = true;
    scheduler.current?.stop();
    setRunning(false);
    const success = delaysRef.current.length;
    const accuracy = Math.round((success / Math.max(1, Math.min(completedSteps, maxSteps))) * 100);
    const averageMs = success ? Math.round(delaysRef.current.reduce((sum, value) => sum + value, 0) / success) : 0;
    onComplete({ day: curriculumDefinition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs, passed: !stopped && completedSteps >= maxSteps && accuracy >= curriculumDefinition.passAccuracy && averageMs <= curriculumDefinition.maxAverageMs });
  };

  useEffect(() => {
    if (!running) return undefined;
    let cancelled = false;
    void audio.resume().then(() => {
      if (cancelled) return;
      const nextScheduler = new TempoScheduler(audio);
      scheduler.current = nextScheduler;
      nextScheduler.start(bpm, division, clickVolume / 100, {
        onCountIn: (remaining) => setCountIn(remaining),
        onChord: (nextIndex, scheduledTime) => {
          sessionStepRef.current = nextIndex;
          if (isCurriculum && nextIndex >= maxSteps) { finishCurriculum(false, nextIndex); return; }
          setCountIn(null);
          setSessionStep(nextIndex);
          setIndex(nextIndex % chords.length);
          slotStartAudio.current = scheduledTime;
          scored.current = false;
        },
      });
    });
    return () => { cancelled = true; scheduler.current?.stop(); scheduler.current = null; setCountIn(null); };
    // The scheduler intentionally stays alive while curriculum keys change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, bpm, chords.length, clickVolume, division, isCurriculum, maxSteps, running]);

  useEffect(() => {
    if (!running || countIn !== null || scored.current || !analysis.isExact) return;
    scored.current = true;
    const delay = Math.max(0, Math.round((audio.currentTime - slotStartAudio.current) * 1000));
    delaysRef.current = [...delaysRef.current, delay];
    setDelays(delaysRef.current);
  }, [analysis.isExact, audio, countIn, running]);

  const next = chords[(index + 1) % chords.length]!;
  const afterNext = chords[(index + 2) % chords.length]!;
  const round = Math.floor(sessionStep / 4);
  const showCurrentGuide = curriculumDefinition?.day === 6 ? round < 2 : curriculumDefinition?.day === 10 ? Math.floor((sessionStep % 8) / 4) === 0 : false;
  const showNextGuide = curriculumDefinition?.day === 6 && round >= 2 && round < 4;

  useEffect(() => {
    if (!onGuideChange) return undefined;
    const guideTarget = showCurrentGuide ? current : showNextGuide ? next : null;
    const chordPcs = chordPitchClasses(current);
    const correctActive = notes.filter((note) => chordPcs.includes(toPitchClass(note)));
    const extraActive = notes.filter((note) => !chordPcs.includes(toPitchClass(note)));
    onGuideChange({ guideNotes: guideTarget ? recommendedVoicing(guideTarget) : [], leftGuideNotes: [], correctActiveNotes: correctActive, extraActiveNotes: extraActive, fingering: {}, spelling: keyRoot === 5 || [1, 3, 8, 10].includes(keyRoot) ? 'flat' : 'sharp' });
    return () => onGuideChange({ guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' });
  }, [analysis.isExact, current, keyRoot, next, notes, onGuideChange, pattern, showCurrentGuide, showNextGuide]);

  const stop = () => { scheduler.current?.stop(); scheduler.current = null; setCountIn(null); onAllNotesOff?.(); if (isCurriculum) finishCurriculum(true); else setRunning(false); };
  const start = async () => { await audio.resume(); onSessionStart?.(); completed.current = false; startedAt.current = nowMs(); delaysRef.current = []; sessionStepRef.current = 0; setDelays([]); setIndex(0); setSessionStep(0); setCountIn(4); setRunning(true); };
  const avgDelay = delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0;
  const curriculumStatus = curriculumDefinition?.day === 10 ? `キー ${chordNameForKey({ root: keyRoot, quality: 'major' }, keyRoot)} · ${Math.floor((sessionStep % 8) / 4) + 1}/2周` : `${Math.min(8, round + 1)}/8周`;

  return <div className="mode-layout progression-layout" data-testid={isCurriculum ? 'lesson-progression' : undefined}><section className="practice-stage progression-stage"><div className="stage-topline"><span className="mode-kicker">{isCurriculum ? `DAY ${curriculumDefinition.day} · PROGRESSION` : 'PROGRESSION + METRONOME'}</span><span>{isCurriculum ? curriculumStatus : pattern.roman}</span></div>{countIn !== null && <div className="count-in-overlay"><span>COUNT IN</span><strong>{countIn}</strong></div>}<div className="chord-queue"><div className="queue-next"><span>その次</span><strong>{chordNameForKey(afterNext, keyRoot)}</strong></div><div className={`queue-current ${analysis.isExact ? 'correct' : ''}`}><span>現在</span><strong>{chordNameForKey(current, keyRoot)}</strong><small>{analysis.isExact ? `${analysis.inversion} · OK` : `${division === 4 ? '1小節' : `${division}拍`}で交代`}</small></div><div className="queue-next"><span>次</span><strong>{chordNameForKey(next, keyRoot)}</strong></div></div>{isCurriculum && <div className="guide-stage-label">{showCurrentGuide ? '現在のコードをガイド表示' : showNextGuide ? '次のコードだけ先にガイド表示' : 'コードネームだけで演奏'}</div>}<div className="progression-actions"><button className={`button ${running ? 'danger' : 'primary'}`} type="button" onClick={running ? stop : () => void start()}>{running ? '停止' : '4カウントで開始'}</button><span>テンポを止めず、コードごとの成功と遅延を記録します</span></div></section><aside className="mode-sidebar"><section className="panel"><span className="eyebrow">SETTINGS</span><h3>進行・メトロノーム設定</h3>{!isCurriculum && <><label className="field-label">コード進行<select value={patternId} onChange={(event) => setPatternId(event.target.value)}>{PROGRESSIONS.map((item) => <option key={item.id} value={item.id}>{item.roman} · {item.name}</option>)}</select></label><label className="field-label">キー<select value={selectedKey} onChange={(event) => setSelectedKey(Number(event.target.value) as PitchClass)}>{NOTE_NAMES_FLAT.map((name, pc) => <option key={name} value={pc}>{name}</option>)}</select></label></>}<label className="range-label">共通テンポ <span>{bpm} BPM</span></label><input aria-label="進行BPM" type="range" min="40" max="160" value={bpm} onChange={(event) => onBpmChange(Number(event.target.value))} /><label className="range-label">クリック音量 <span>{clickVolume}%</span></label><input aria-label="進行クリック音量" type="range" min="0" max="100" value={clickVolume} onChange={(event) => { const value = Number(event.target.value); onMetronomeVolumeChange ? onMetronomeVolumeChange(value) : setLocalClickVolume(value); }} />{!isCurriculum && <label className="field-label">1コード<select value={division} onChange={(event) => setDivision(Number(event.target.value) as Division)}><option value="4">1小節（4拍）</option><option value="2">2拍</option><option value="1">1拍</option></select></label>}</section><section className="panel stats-grid"><div><span>成功</span><strong>{delays.length}</strong></div><div><span>平均遅延</span><strong>{avgDelay ? `${avgDelay}ms` : '—'}</strong></div></section></aside></div>;
}

function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
