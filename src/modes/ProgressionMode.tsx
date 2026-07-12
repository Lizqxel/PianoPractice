import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { NOTE_NAMES_FLAT, chordNameForKey } from '../music/chordDefinitions';
import { PROGRESSIONS, progressionChords } from '../music/progressions';
import type { AudioEngine } from '../services/audioEngine';
import { TempoScheduler } from '../services/tempoScheduler';
import type { PitchClass } from '../types';

interface ProgressionModeProps {
  notes: readonly number[];
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
}
type Division = 4 | 2 | 1;

export function ProgressionMode({ notes, audio, bpm, onBpmChange }: ProgressionModeProps) {
  const [patternId, setPatternId] = useState('pop');
  const [keyRoot, setKeyRoot] = useState<PitchClass>(0);
  const [division, setDivision] = useState<Division>(4);
  const [clickVolume, setClickVolume] = useState(55);
  const [running, setRunning] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [delays, setDelays] = useState<number[]>([]);
  const slotStartAudio = useRef(0);
  const scored = useRef(false);
  const scheduler = useRef<TempoScheduler | null>(null);
  const pattern = PROGRESSIONS.find((item) => item.id === patternId) ?? PROGRESSIONS[0]!;
  const chords = useMemo(() => progressionChords(pattern, keyRoot), [keyRoot, pattern]);
  const current = chords[index % chords.length]!;
  const analysis = analyzeChord(current, notes);

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
          setCountIn(null);
          setIndex(nextIndex % chords.length);
          slotStartAudio.current = scheduledTime;
          scored.current = false;
        },
      });
    });
    return () => {
      cancelled = true;
      scheduler.current?.stop();
      scheduler.current = null;
      setCountIn(null);
    };
  }, [audio, bpm, chords.length, clickVolume, division, running]);

  useEffect(() => {
    if (!running || countIn !== null || scored.current || !analysis.isExact) return;
    scored.current = true;
    setDelays((items) => [...items, Math.max(0, Math.round((audio.currentTime - slotStartAudio.current) * 1000))]);
  }, [analysis.isExact, audio, countIn, running]);

  const stop = () => {
    scheduler.current?.stop();
    scheduler.current = null;
    setRunning(false);
    setCountIn(null);
  };
  const start = async () => {
    await audio.resume();
    setIndex(0);
    setDelays([]);
    setCountIn(4);
    setRunning(true);
  };
  const next = chords[(index + 1) % chords.length]!;
  const afterNext = chords[(index + 2) % chords.length]!;
  const avgDelay = delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0;

  return (
    <div className="mode-layout progression-layout">
      <section className="practice-stage progression-stage">
        <div className="stage-topline"><span className="mode-kicker">PROGRESSION + METRONOME</span><span>{pattern.roman}</span></div>
        {countIn !== null && <div className="count-in-overlay"><span>COUNT IN</span><strong>{countIn}</strong></div>}
        <div className="chord-queue">
          <div className="queue-next"><span>その次</span><strong>{chordNameForKey(afterNext, keyRoot)}</strong></div>
          <div className={`queue-current ${analysis.isExact ? 'correct' : ''}`}><span>現在</span><strong>{chordNameForKey(current, keyRoot)}</strong><small>{analysis.isExact ? `${analysis.inversion} · OK` : `${division === 4 ? '1小節' : `${division}拍`}で交代`}</small></div>
          <div className="queue-next"><span>次</span><strong>{chordNameForKey(next, keyRoot)}</strong></div>
        </div>
        <div className="progression-actions"><button className={`button ${running ? 'danger' : 'primary'}`} type="button" onClick={running ? stop : () => void start()}>{running ? '停止' : '4カウントで開始'}</button><span>クリックとコード変更は同じ音声時間軸で同期します</span></div>
      </section>
      <aside className="mode-sidebar">
        <section className="panel"><span className="eyebrow">SETTINGS</span><h3>進行・メトロノーム設定</h3>
          <label className="field-label">コード進行<select value={patternId} onChange={(event) => setPatternId(event.target.value)}>{PROGRESSIONS.map((item) => <option key={item.id} value={item.id}>{item.roman} · {item.name}</option>)}</select></label>
          <label className="field-label">キー<select value={keyRoot} onChange={(event) => setKeyRoot(Number(event.target.value) as PitchClass)}>{NOTE_NAMES_FLAT.map((name, pc) => <option key={name} value={pc}>{name}</option>)}</select></label>
          <label className="range-label">共通テンポ <span>{bpm} BPM</span></label><input aria-label="進行BPM" type="range" min="40" max="160" value={bpm} onChange={(event) => onBpmChange(Number(event.target.value))} />
          <label className="range-label">クリック音量 <span>{clickVolume}%</span></label><input aria-label="進行クリック音量" type="range" min="0" max="100" value={clickVolume} onChange={(event) => setClickVolume(Number(event.target.value))} />
          <label className="field-label">1コード<select value={division} onChange={(event) => setDivision(Number(event.target.value) as Division)}><option value="4">1小節（4拍）</option><option value="2">2拍</option><option value="1">1拍</option></select></label>
        </section>
        <section className="panel stats-grid"><div><span>成功</span><strong>{delays.length}</strong></div><div><span>平均遅延</span><strong>{avgDelay ? `${avgDelay}ms` : '—'}</strong></div></section>
      </aside>
    </div>
  );
}
