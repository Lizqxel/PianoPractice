import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { chordName } from '../music/chordDefinitions';
import { parseChordChart } from '../music/chordParser';
import { recommendedVoicing } from '../music/voicings';
import type { AudioEngine } from '../services/audioEngine';
import { TempoScheduler } from '../services/tempoScheduler';
import type { CurriculumDayDefinition, DailySessionResult, KeyboardGuideState } from '../types';

const SAMPLES = ['C | G | Am | F', 'Am | F | C | G', 'C | Am | F | G'] as const;

interface Props {
  kind: 'song' | 'sightReading';
  definition: CurriculumDayDefinition;
  notes: readonly number[];
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  onGuideChange: (guide: KeyboardGuideState) => void;
  onComplete: (result: DailySessionResult) => void;
  onSessionStart: () => void;
  metronomeVolume: number;
}

export function SequenceLessonMode({ kind, definition, notes, audio, bpm, onBpmChange, onGuideChange, onComplete, onSessionStart, metronomeVolume }: Props) {
  const [chartText, setChartText] = useState<string>(SAMPLES[0]);
  const [sightChart] = useState(() => generateSightChart(8 + Math.floor(Math.random() * 9)));
  const [guideEnabled, setGuideEnabled] = useState(true);
  const [practiceSight, setPracticeSight] = useState(true);
  const [preview, setPreview] = useState(kind === 'sightReading' ? 10 : 0);
  const [running, setRunning] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState(false);
  const successes = useRef(0);
  const delays = useRef<number[]>([]);
  const slotStart = useRef(0);
  const scored = useRef(false);
  const startedAt = useRef(0);
  const scheduler = useRef<TempoScheduler | null>(null);
  const completed = useRef(false);
  const autoStarted = useRef(false);
  const sequence = useMemo(() => kind === 'song' ? parseChordChart(chartText) : sightChart, [chartText, kind, sightChart]);
  const current = sequence[index % Math.max(1, sequence.length)] ?? { root: 0 as const, quality: 'major' as const };
  const next = sequence[(index + 1) % Math.max(1, sequence.length)] ?? current;
  const afterNext = sequence[(index + 2) % Math.max(1, sequence.length)] ?? current;
  const analysis = analyzeChord(current, notes);
  const showGuide = kind === 'song' ? guideEnabled : practiceSight && wrong;

  useEffect(() => {
    if (preview <= 0 || kind !== 'sightReading') return undefined;
    const timer = window.setInterval(() => setPreview((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [kind, preview]);

  useEffect(() => {
    if (!running || scored.current || !analysis.isExact) return;
    scored.current = true;
    successes.current += 1;
    delays.current.push(Math.max(0, Math.round((audio.currentTime - slotStart.current) * 1000)));
  }, [analysis.isExact, audio.currentTime, running]);

  useEffect(() => {
    if (!running || notes.length < 3 || analysis.isExact) return;
    setWrong(true);
  }, [analysis.isExact, notes.length, running]);

  useEffect(() => {
    onGuideChange({ guideNotes: showGuide ? recommendedVoicing(current) : [], leftGuideNotes: [], correctActiveNotes: analysis.isExact ? notes : [], extraActiveNotes: notes.length >= 3 && !analysis.isExact ? notes : [], fingering: {}, spelling: current.spelling ?? 'flat' });
    return () => onGuideChange(emptyGuide());
  }, [analysis.isExact, current, notes, onGuideChange, showGuide]);

  const finish = (stopped: boolean) => {
    if (completed.current) return;
    completed.current = true;
    scheduler.current?.stop();
    setRunning(false);
    const accuracy = Math.round((successes.current / Math.max(1, sequence.length)) * 100);
    const averageMs = delays.current.length ? Math.round(delays.current.reduce((sum, value) => sum + value, 0) / delays.current.length) : 0;
    onComplete({ day: definition.day, minutes: Math.max(1, Math.round((nowMs() - startedAt.current) / 60000)), accuracy, averageMs, passed: !stopped && accuracy >= definition.passAccuracy && averageMs <= definition.maxAverageMs });
  };

  useEffect(() => () => scheduler.current?.stop(), []);

  const start = async () => {
    if (sequence.length === 0 || (kind === 'sightReading' && preview > 0)) return;
    await audio.resume();
    onSessionStart();
    completed.current = false; successes.current = 0; delays.current = []; startedAt.current = nowMs(); setIndex(0); setWrong(false); setCountIn(4); setRunning(true);
    const nextScheduler = new TempoScheduler(audio);
    scheduler.current = nextScheduler;
    nextScheduler.start(bpm, 4, metronomeVolume / 100, { onCountIn: setCountIn, onChord: (nextIndex, scheduledTime) => {
      if (nextIndex >= sequence.length) { finish(false); return; }
      setCountIn(null); setIndex(nextIndex); setWrong(false); scored.current = false; slotStart.current = scheduledTime;
    } });
  };

  useEffect(() => {
    if (kind !== 'sightReading' || preview > 0 || running || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [kind, preview, running]);

  return <div className="mode-layout" data-testid={`lesson-${kind}`}><section className="practice-stage progression-stage"><div className="stage-topline"><span className="mode-kicker">DAY {definition.day} · {kind === 'song' ? 'CHORD CHART' : 'SIGHT READING'}</span><span>{running ? `${index + 1}/${sequence.length}小節` : kind === 'sightReading' && preview > 0 ? `確認 ${preview}秒` : '準備'}</span></div>{countIn !== null && <div className="count-in-overlay"><span>COUNT IN</span><strong>{countIn}</strong></div>}{kind === 'sightReading' && preview > 0 ? <div className="chart-preview"><span>10秒でコード譜を確認</span><div>{sequence.map((target, chartIndex) => <b key={`${chordName(target)}-${chartIndex}`}>{chordName(target)}</b>)}</div><strong>{preview}</strong></div> : <><div className="chord-queue"><div className="queue-next"><span>その次</span><strong>{chordName(afterNext)}</strong></div><div className={`queue-current ${analysis.isExact ? 'correct' : ''}`}><span>現在</span><strong>{chordName(current)}</strong><small>{wrong ? '間違いを確認' : '1小節'}</small></div><div className="queue-next"><span>次</span><strong>{chordName(next)}</strong></div></div><div className="progression-actions"><button className={`button ${running ? 'danger' : 'primary'}`} type="button" disabled={kind === 'sightReading' && preview > 0} onClick={running ? () => finish(true) : () => void start()}>{running ? '停止（完走失敗）' : '4カウントで開始'}</button><span>最初から最後まで止まらず演奏しましょう</span></div></>}</section><aside className="mode-sidebar">{kind === 'song' && <section className="panel"><span className="eyebrow">CHART EDITOR</span><h3>コード譜</h3><select aria-label="サンプルコード譜" value={chartText} onChange={(event) => setChartText(event.target.value)}>{SAMPLES.map((sample) => <option key={sample} value={sample}>{sample}</option>)}</select><textarea aria-label="コード進行を入力" value={chartText} onChange={(event) => setChartText(event.target.value)} /><p className="hint">C | G | Am | F のように入力します。</p></section>}<section className="panel"><span className="eyebrow">PRACTICE</span><h3>演奏設定</h3><label className="range-label">BPM <span>{bpm}</span></label><input aria-label="コード譜BPM" type="range" min="40" max="160" value={bpm} onChange={(event) => onBpmChange(Number(event.target.value))} />{kind === 'song' ? <label className="check-row"><input type="checkbox" checked={guideEnabled} onChange={(event) => setGuideEnabled(event.target.checked)} />鍵盤ガイドを表示</label> : <label className="check-row"><input type="checkbox" checked={practiceSight} onChange={(event) => setPracticeSight(event.target.checked)} />練習用初見（間違い後にガイド）</label>}</section></aside></div>;
}

function generateSightChart(length: number) {
  const pool = ['C', 'Dm', 'Em', 'F', 'G', 'Am'].map((name) => parseChordChart(name)[0]!);
  return Array.from({ length }, (_, index) => pool[(index * 5 + Math.floor(Math.random() * pool.length)) % pool.length]!);
}
function emptyGuide(): KeyboardGuideState { return { guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' }; }
function nowMs(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
