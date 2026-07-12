import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../services/audioEngine';

interface MetronomeProps {
  audio: AudioEngine;
}

export function Metronome({ audio }: MetronomeProps) {
  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [volume, setVolume] = useState(55);
  const [countIn, setCountIn] = useState(true);
  const [beat, setBeat] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    if (!running) return undefined;
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
  }, [audio, bpm, countIn, running, volume]);

  return (
    <section className="utility-card metronome" aria-label="メトロノーム">
      <div className="section-title-row">
        <div><span className="eyebrow">TEMPO</span><h3>メトロノーム</h3></div>
        <button className={`icon-toggle ${running ? 'active' : ''}`} type="button" onClick={() => setRunning((value) => !value)} aria-label={running ? '停止' : '開始'}>
          {running ? '■' : '▶'}
        </button>
      </div>
      <div className="tempo-readout"><strong>{bpm}</strong><span>BPM</span></div>
      <input aria-label="BPM" type="range" min="40" max="160" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
      <div className="beat-dots" aria-label={`現在${beat < 0 ? `カウント${Math.abs(beat)}` : `${beat + 1}拍目`}`}>
        {[0, 1, 2, 3].map((index) => <i className={running && beat === index ? 'on' : ''} key={index} />)}
      </div>
      <label className="range-label">クリック音量 <span>{volume}%</span></label>
      <input aria-label="クリック音量" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
      <label className="check-row"><input type="checkbox" checked={countIn} onChange={(event) => setCountIn(event.target.checked)} />開始前に4カウント</label>
    </section>
  );
}
