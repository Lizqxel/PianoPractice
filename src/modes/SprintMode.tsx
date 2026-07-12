import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeChord, formatPitchClasses } from '../music/chordMatcher';
import { BEGINNER_QUALITIES, INTERMEDIATE_QUALITIES, chordName } from '../music/chordDefinitions';
import type { ChordQuality, ChordTarget, PitchClass, SprintStats } from '../types';

interface SprintModeProps { notes: readonly number[] }
type Level = 'beginner' | 'intermediate';

const emptyStats: SprintStats = { attempts: 0, correct: 0, totalReactionMs: 0, fastestMs: null };

function randomTarget(level: Level, previous?: ChordTarget): ChordTarget {
  const qualities = level === 'beginner' ? BEGINNER_QUALITIES : INTERMEDIATE_QUALITIES;
  let result: ChordTarget;
  do {
    result = {
      root: Math.floor(Math.random() * 12) as PitchClass,
      quality: qualities[Math.floor(Math.random() * qualities.length)] as ChordQuality,
    };
  } while (previous && result.root === previous.root && result.quality === previous.quality);
  return result;
}

export function SprintMode({ notes }: SprintModeProps) {
  const [level, setLevel] = useState<Level>('beginner');
  const [limit, setLimit] = useState<2 | 3 | 5>(3);
  const [autoNext, setAutoNext] = useState(true);
  const [target, setTarget] = useState<ChordTarget>(() => randomTarget('beginner'));
  const [stats, setStats] = useState<SprintStats>(emptyStats);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(3_000);
  const [result, setResult] = useState<'idle' | 'correct' | 'timeout'>('idle');
  const startedAt = useRef(0);
  const resolved = useRef(false);
  const analysis = analyzeChord(target, notes);

  const nextQuestion = useCallback(() => {
    setTarget((previous) => randomTarget(level, previous));
    startedAt.current = performance.now();
    resolved.current = false;
    setRemaining(limit * 1_000);
    setResult('idle');
    setRunning(true);
  }, [level, limit]);

  useEffect(() => {
    if (!running || resolved.current) return undefined;
    const timer = window.setInterval(() => {
      const next = Math.max(0, limit * 1_000 - (performance.now() - startedAt.current));
      setRemaining(next);
      if (next === 0) {
        resolved.current = true;
        setRunning(false);
        setResult('timeout');
        setStats((current) => ({ ...current, attempts: current.attempts + 1 }));
        if (autoNext) window.setTimeout(nextQuestion, 450);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [autoNext, limit, nextQuestion, running]);

  useEffect(() => {
    if (!running || resolved.current || !analysis.isExact) return;
    resolved.current = true;
    const reaction = performance.now() - startedAt.current;
    setRunning(false);
    setResult('correct');
    setStats((current) => ({
      attempts: current.attempts + 1,
      correct: current.correct + 1,
      totalReactionMs: current.totalReactionMs + reaction,
      fastestMs: current.fastestMs === null ? reaction : Math.min(current.fastestMs, reaction),
    }));
    if (autoNext) window.setTimeout(nextQuestion, 380);
  }, [analysis.isExact, autoNext, nextQuestion, running]);

  const accuracy = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  const average = stats.correct ? Math.round(stats.totalReactionMs / stats.correct) : 0;

  return (
    <div className="mode-layout sprint-layout">
      <section className="practice-stage">
        <div className="stage-topline"><span className="mode-kicker">CHORD SPRINT</span><span>Q {stats.attempts + 1}</span></div>
        <div className={`target-chord ${result}`} aria-live="polite">
          <span>{running ? 'このコードを弾く' : result === 'idle' ? '準備できたら開始' : result === 'correct' ? '正解' : '時間切れ'}</span>
          <strong>{chordName(target)}</strong>
          <small>{result === 'correct' ? analysis.inversion : '転回形も正解です'}</small>
        </div>
        <div className="timer-track"><i style={{ transform: `scaleX(${remaining / (limit * 1_000)})` }} /></div>
        <div className="judgement-line">
          {notes.length === 0 && <span>鍵盤を弾くと判定します</span>}
          {notes.length > 0 && !analysis.isExact && (
            <>
              {analysis.missing.length > 0 && <span className="bad">不足: {formatPitchClasses(analysis.missing)}</span>}
              {analysis.extra.length > 0 && <span className="bad">余分: {formatPitchClasses(analysis.extra)}</span>}
            </>
          )}
          {analysis.isExact && <span className="good">{analysis.playedName} · {analysis.inversion}</span>}
        </div>
        {!running && (
          <button className="button primary start-button" type="button" onClick={nextQuestion}>
            {stats.attempts === 0 ? '練習を開始' : '次のコード'}
          </button>
        )}
      </section>
      <aside className="mode-sidebar">
        <section className="panel"><span className="eyebrow">SETTINGS</span><h3>出題設定</h3>
          <div className="segmented">
            <button type="button" className={level === 'beginner' ? 'active' : ''} onClick={() => setLevel('beginner')}>初級</button>
            <button type="button" className={level === 'intermediate' ? 'active' : ''} onClick={() => setLevel('intermediate')}>中級</button>
          </div>
          <label className="field-label">制限時間<select value={limit} onChange={(event) => setLimit(Number(event.target.value) as 2 | 3 | 5)}><option value="2">2秒</option><option value="3">3秒</option><option value="5">5秒</option></select></label>
          <label className="check-row"><input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />正解後に自動で次へ</label>
        </section>
        <section className="panel stats-grid"><div><span>正解率</span><strong>{accuracy}%</strong></div><div><span>平均</span><strong>{average ? `${(average / 1000).toFixed(2)}s` : '—'}</strong></div><div><span>最速</span><strong>{stats.fastestMs ? `${(stats.fastestMs / 1000).toFixed(2)}s` : '—'}</strong></div><div><span>正解</span><strong>{stats.correct}</strong></div></section>
        <button className="text-button" type="button" onClick={() => setStats(emptyStats)}>記録をリセット</button>
      </aside>
    </div>
  );
}
