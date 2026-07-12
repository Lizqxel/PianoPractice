import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord } from '../music/chordMatcher';
import { NOTE_NAMES_FLAT, chordName } from '../music/chordDefinitions';
import { loadSixtyBest, saveSixtyBest } from '../services/storage';
import type { ChordTarget, PitchClass } from '../types';

interface SixtySecondModeProps { notes: readonly number[] }

const choices: ChordTarget[] = NOTE_NAMES_FLAT.flatMap((_, root) => [
  { root: root as PitchClass, quality: 'major' as const },
  { root: root as PitchClass, quality: 'minor' as const },
]);

function choiceKey(target: ChordTarget): string { return `${target.root}:${target.quality}`; }
function fromKey(value: string): ChordTarget {
  const [root = '0', quality = 'major'] = value.split(':');
  return { root: Number(root) as PitchClass, quality: quality === 'minor' ? 'minor' : 'major' };
}

export function SixtySecondMode({ notes }: SixtySecondModeProps) {
  const [first, setFirst] = useState<ChordTarget>({ root: 0, quality: 'major' });
  const [second, setSecond] = useState<ChordTarget>({ root: 7, quality: 'major' });
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(60);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(loadSixtyBest);
  const [expectedIndex, setExpectedIndex] = useState<0 | 1>(0);
  const accepted = useRef(false);
  const expected = useMemo(() => expectedIndex === 0 ? first : second, [expectedIndex, first, second]);
  const exact = analyzeChord(expected, notes).isExact;

  useEffect(() => {
    if (!running) return undefined;
    const endsAt = Date.now() + 60_000;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) setRunning(false);
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || !exact || accepted.current) return;
    accepted.current = true;
    setScore((current) => current + 1);
    setExpectedIndex((current) => current === 0 ? 1 : 0);
  }, [exact, running]);

  useEffect(() => {
    if (notes.length === 0) accepted.current = false;
  }, [notes.length]);

  useEffect(() => {
    if (!running && score > best) {
      setBest(score);
      saveSixtyBest(score);
    }
  }, [best, running, score]);

  const start = () => {
    setScore(0); setRemaining(60); setExpectedIndex(0); accepted.current = false; setRunning(true);
  };

  return (
    <div className="mode-layout sixty-layout">
      <section className="practice-stage">
        <div className="stage-topline"><span className="mode-kicker">60 SECOND CHANGE</span><span>BEST {best}</span></div>
        <div className="sixty-timer"><span>残り</span><strong>{remaining}</strong><small>秒</small></div>
        <div className="alternating-chords">
          <div className={expectedIndex === 0 ? 'active' : ''}><span>A</span><strong>{chordName(first)}</strong></div>
          <i>↔</i>
          <div className={expectedIndex === 1 ? 'active' : ''}><span>B</span><strong>{chordName(second)}</strong></div>
        </div>
        <div className="score-line"><span>今回の記録</span><strong>{score}</strong><small>回</small></div>
        <button className={`button ${running ? 'danger' : 'primary'} start-button`} type="button" onClick={() => running ? setRunning(false) : start()}>{running ? '終了' : '60秒チャレンジを開始'}</button>
      </section>
      <aside className="mode-sidebar"><section className="panel"><span className="eyebrow">CHORDS</span><h3>2つのコード</h3>
        <label className="field-label">コード A<select value={choiceKey(first)} onChange={(event) => setFirst(fromKey(event.target.value))}>{choices.map((item) => <option key={`a-${choiceKey(item)}`} value={choiceKey(item)}>{chordName(item)}</option>)}</select></label>
        <label className="field-label">コード B<select value={choiceKey(second)} onChange={(event) => setSecond(fromKey(event.target.value))}>{choices.map((item) => <option key={`b-${choiceKey(item)}`} value={choiceKey(item)}>{chordName(item)}</option>)}</select></label>
        <p className="hint">正しいコードを弾いていったん鍵盤を離すと、次のコードへ切り替わります。</p>
      </section><section className="panel record-card"><span>過去最高</span><strong>{best}<small> 回</small></strong></section></aside>
    </div>
  );
}
