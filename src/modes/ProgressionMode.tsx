import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { NOTE_NAMES_FLAT, chordName } from '../music/chordDefinitions';
import { PROGRESSIONS, progressionChords } from '../music/progressions';
import type { PitchClass } from '../types';

interface ProgressionModeProps { notes: readonly number[] }
type Division = 4 | 2 | 1;

export function ProgressionMode({ notes }: ProgressionModeProps) {
  const [patternId, setPatternId] = useState('pop');
  const [keyRoot, setKeyRoot] = useState<PitchClass>(0);
  const [bpm, setBpm] = useState(80);
  const [division, setDivision] = useState<Division>(4);
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [delays, setDelays] = useState<number[]>([]);
  const slotStart = useRef(0);
  const scored = useRef(false);
  const pattern = PROGRESSIONS.find((item) => item.id === patternId) ?? PROGRESSIONS[0]!;
  const chords = useMemo(() => progressionChords(pattern, keyRoot), [keyRoot, pattern]);
  const current = chords[index % chords.length]!;
  const analysis = analyzeChord(current, notes);
  const duration = (60_000 / bpm) * division;

  useEffect(() => {
    if (!running) return undefined;
    slotStart.current = performance.now();
    scored.current = false;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % chords.length);
      slotStart.current = performance.now();
      scored.current = false;
    }, duration);
    return () => window.clearInterval(timer);
  }, [chords.length, duration, running]);

  useEffect(() => {
    if (!running || scored.current || !analysis.isExact) return;
    scored.current = true;
    setDelays((items) => [...items, Math.round(performance.now() - slotStart.current)]);
  }, [analysis.isExact, running]);

  const next = chords[(index + 1) % chords.length]!;
  const afterNext = chords[(index + 2) % chords.length]!;
  const avgDelay = delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0;

  return (
    <div className="mode-layout progression-layout">
      <section className="practice-stage progression-stage">
        <div className="stage-topline"><span className="mode-kicker">PROGRESSION</span><span>{pattern.roman}</span></div>
        <div className="chord-queue">
          <div className="queue-next"><span>その次</span><strong>{chordName(afterNext)}</strong></div>
          <div className={`queue-current ${analysis.isExact ? 'correct' : ''}`}><span>現在</span><strong>{chordName(current)}</strong><small>{analysis.isExact ? `${analysis.inversion} · OK` : `${division === 4 ? '1小節' : `${division}拍`}で交代`}</small></div>
          <div className="queue-next"><span>次</span><strong>{chordName(next)}</strong></div>
        </div>
        <div className="progression-actions"><button className={`button ${running ? 'danger' : 'primary'}`} type="button" onClick={() => { setRunning((value) => !value); setIndex(0); setDelays([]); }}>{running ? '停止' : '進行を開始'}</button><span>テンポに遅れても進行は続き、遅延として記録します</span></div>
      </section>
      <aside className="mode-sidebar">
        <section className="panel"><span className="eyebrow">SETTINGS</span><h3>進行設定</h3>
          <label className="field-label">コード進行<select value={patternId} onChange={(event) => setPatternId(event.target.value)}>{PROGRESSIONS.map((item) => <option key={item.id} value={item.id}>{item.roman} · {item.name}</option>)}</select></label>
          <label className="field-label">キー<select value={keyRoot} onChange={(event) => setKeyRoot(Number(event.target.value) as PitchClass)}>{NOTE_NAMES_FLAT.map((name, pc) => <option key={name} value={pc}>{name}</option>)}</select></label>
          <label className="range-label">テンポ <span>{bpm} BPM</span></label><input type="range" min="40" max="160" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
          <label className="field-label">1コード<select value={division} onChange={(event) => setDivision(Number(event.target.value) as Division)}><option value="4">1小節（4拍）</option><option value="2">2拍</option><option value="1">1拍</option></select></label>
        </section>
        <section className="panel stats-grid"><div><span>成功</span><strong>{delays.length}</strong></div><div><span>平均遅延</span><strong>{avgDelay ? `${avgDelay}ms` : '—'}</strong></div></section>
      </aside>
    </div>
  );
}
