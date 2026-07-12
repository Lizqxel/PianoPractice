import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../services/audioEngine';

interface MetronomeProps {
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  enabled: boolean;
}

export function Metronome({ audio, bpm, onBpmChange, running, onRunningChange, volume, onVolumeChange, enabled }: MetronomeProps) {
  const [countIn, setCountIn] = useState(true);
  const [beat, setBeat] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    if (!running || !enabled) return undefined;
    countRef.current = countIn ? -4 : 0;
    const tick = () => {
      const value = countRef.current;
      void audio.click(value % 4 === 0, volume / 100);
      setBeat(value < 0 ? value : value % 4);
      countRef.current += 1;
    };
    tick();
    const timer = window.setInterval(tick, 60_000 / bpm);
    return () => window.clearInterval(timer);
  }, [audio, bpm, countIn, enabled, running, volume]);

  return (
    <section className="utility-card metronome" aria-label="メトロノーム">
      <div className="section-title-row">
        <div><span className="eyebrow">TEMPO</span><h3>メトロノーム</h3></div>
        <button className={`icon-toggle ${running ? 'active' : ''}`} type="button" onClick={() => {
          if (running) onRunningChange(false);
          else void audio.resume().then(() => onRunningChange(true));
        }} aria-label={running ? '停止' : '開始'} disabled={!enabled}>
          {running ? '■' : '▶'}
        </button>
      </div>
      <div className="tempo-readout"><strong>{bpm}</strong><span>BPM</span></div>
      <input aria-label="BPM" type="range" min="40" max="160" value={bpm} onChange={(event) => onBpmChange(Number(event.target.value))} />
      <div className="beat-dots" aria-label={`現在${beat < 0 ? `カウント${Math.abs(beat)}` : `${beat + 1}拍目`}`}>
        {[0, 1, 2, 3].map((index) => <i className={running && beat === index ? 'on' : ''} key={index} />)}
      </div>
      <label className="range-label">クリック音量 <span>{volume}%</span></label>
      <input aria-label="クリック音量" type="range" min="0" max="100" value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} />
      <label className="check-row"><input type="checkbox" checked={countIn} onChange={(event) => setCountIn(event.target.checked)} />開始前に4カウント</label>
    </section>
  );
}
