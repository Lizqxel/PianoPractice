import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeChord, analyzeHands, formatPitchClasses } from '../music/chordMatcher';
import { ALL_QUALITIES, NOTE_NAMES_FLAT, chordName } from '../music/chordDefinitions';
import { getCurriculumDay, targetsForDay } from '../music/curriculum';
import { extractWeakTargets, recordAttempt, targetId } from '../music/performance';
import { loadPerformance, savePerformance } from '../services/storage';
import type { ChordPerformanceRecord, ChordQuality, ChordTarget, DailySessionResult, PitchClass, SprintStats } from '../types';

interface SprintModeProps {
  notes: readonly number[];
  curriculumDay: number;
  dailySession: boolean;
  splitNote: number;
  onDailyComplete: (result: DailySessionResult) => void;
}

type Scope = 'today' | 'white' | 'major' | 'minor' | 'weak' | 'custom' | 'all';
const emptyStats: SprintStats = { attempts: 0, correct: 0, totalReactionMs: 0, fastestMs: null };
const basicTargets: ChordTarget[] = NOTE_NAMES_FLAT.flatMap((_, root) => [
  { root: root as PitchClass, quality: 'major' as const },
  { root: root as PitchClass, quality: 'minor' as const },
]);
const allTargets: ChordTarget[] = NOTE_NAMES_FLAT.flatMap((_, root) =>
  ALL_QUALITIES.map((quality) => ({ root: root as PitchClass, quality })),
);

function randomTarget(pool: readonly ChordTarget[], previous?: ChordTarget): ChordTarget {
  if (pool.length === 0) return { root: 0, quality: 'major' };
  const candidates = previous && pool.length > 1 ? pool.filter((item) => targetId(item) !== targetId(previous)) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0]!;
}

export function SprintMode({ notes, curriculumDay, dailySession, splitNote, onDailyComplete }: SprintModeProps) {
  const definition = getCurriculumDay(curriculumDay);
  const [scope, setScope] = useState<Scope>(dailySession ? 'today' : 'white');
  const [customIds, setCustomIds] = useState<Set<string>>(() => new Set(basicTargets.slice(0, 6).map(targetId)));
  const [performance, setPerformance] = useState<ChordPerformanceRecord[]>(loadPerformance);
  const [limit, setLimit] = useState<2 | 3 | 5>(dailySession ? 5 : 3);
  const [autoNext, setAutoNext] = useState(true);
  const [stats, setStats] = useState<SprintStats>(emptyStats);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(limit * 1_000);
  const [result, setResult] = useState<'idle' | 'correct' | 'timeout' | 'complete'>('idle');
  const [storageError, setStorageError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const sessionStartedAt = useRef(performanceNow());
  const resolved = useRef(false);
  const transitionTimer = useRef<number | null>(null);

  const pool = useMemo(() => {
    if (scope === 'today') return [...targetsForDay(curriculumDay, performance)];
    if (scope === 'white') return basicTargets.filter((target) => [0, 2, 4, 5, 7, 9, 11].includes(target.root));
    if (scope === 'major') return basicTargets.filter((target) => target.quality === 'major');
    if (scope === 'minor') return basicTargets.filter((target) => target.quality === 'minor');
    if (scope === 'weak') return extractWeakTargets(performance).length > 0 ? extractWeakTargets(performance) : basicTargets;
    if (scope === 'custom') return basicTargets.filter((target) => customIds.has(targetId(target)));
    return allTargets;
  }, [curriculumDay, customIds, performance, scope]);

  const [target, setTarget] = useState<ChordTarget>(() => randomTarget(targetsForDay(curriculumDay)));
  const wholeAnalysis = analyzeChord(target, notes);
  const handAnalysis = analyzeHands(target, notes, splitNote);
  const isExact = target.bass === undefined ? wholeAnalysis.isExact : handAnalysis.isExact;

  const nextQuestion = useCallback(() => {
    setTarget((previous) => randomTarget(pool, previous));
    startedAt.current = performanceNow();
    resolved.current = false;
    setRemaining(limit * 1_000);
    setResult('idle');
    setRunning(true);
  }, [limit, pool]);

  const persistAttempt = useCallback((attemptTarget: ChordTarget, correct: boolean, reactionMs: number) => {
    setPerformance((current) => {
      const next = recordAttempt(current, attemptTarget, correct, reactionMs);
      try { savePerformance(next); setStorageError(null); } catch (error: unknown) {
        setStorageError(error instanceof Error ? error.message : '成績を保存できませんでした');
      }
      return next;
    });
  }, []);

  const resolveAttempt = useCallback((correct: boolean, reactionMs: number) => {
    if (resolved.current) return;
    resolved.current = true;
    setRunning(false);
    persistAttempt(target, correct, reactionMs);
    const updated: SprintStats = {
      attempts: stats.attempts + 1,
      correct: stats.correct + (correct ? 1 : 0),
      totalReactionMs: stats.totalReactionMs + (correct ? reactionMs : 0),
      fastestMs: correct ? (stats.fastestMs === null ? reactionMs : Math.min(stats.fastestMs, reactionMs)) : stats.fastestMs,
    };
    setStats(updated);
    setResult(correct ? 'correct' : 'timeout');

    if (dailySession && updated.attempts >= definition.questionCount) {
      const accuracy = Math.round((updated.correct / updated.attempts) * 100);
      const averageMs = updated.correct ? Math.round(updated.totalReactionMs / updated.correct) : 0;
      const passed = accuracy >= definition.passAccuracy && averageMs <= definition.maxAverageMs;
      setResult('complete');
      transitionTimer.current = window.setTimeout(() => onDailyComplete({
        day: curriculumDay,
        minutes: Math.max(1, Math.round((performanceNow() - sessionStartedAt.current) / 60_000)),
        accuracy,
        averageMs,
        passed,
      }), 500);
      return;
    }
    if (autoNext) transitionTimer.current = window.setTimeout(nextQuestion, correct ? 380 : 450);
  }, [autoNext, curriculumDay, dailySession, definition.maxAverageMs, definition.passAccuracy, definition.questionCount, nextQuestion, onDailyComplete, persistAttempt, stats, target]);

  useEffect(() => {
    if (!running || resolved.current) return undefined;
    const timer = window.setInterval(() => {
      const next = Math.max(0, limit * 1_000 - (performanceNow() - startedAt.current));
      setRemaining(next);
      if (next === 0) resolveAttempt(false, limit * 1_000);
    }, 40);
    return () => window.clearInterval(timer);
  }, [limit, resolveAttempt, running]);

  useEffect(() => {
    if (running && !resolved.current && isExact) resolveAttempt(true, performanceNow() - startedAt.current);
  }, [isExact, resolveAttempt, running]);

  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    if (!running) setTarget((previous) => pool.some((item) => targetId(item) === targetId(previous)) ? previous : randomTarget(pool));
  }, [pool, running]);

  const accuracy = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  const average = stats.correct ? Math.round(stats.totalReactionMs / stats.correct) : 0;
  const sessionLabel = dailySession ? `Day ${curriculumDay} · ${stats.attempts}/${definition.questionCount}` : `Q ${stats.attempts + 1}`;

  return (
    <div className="mode-layout sprint-layout">
      <section className="practice-stage">
        <div className="stage-topline"><span className="mode-kicker">{dailySession ? 'DAILY LESSON' : 'CHORD SPRINT'}</span><span>{sessionLabel}</span></div>
        <div className={`target-chord ${result}`} aria-live="polite">
          <span>{result === 'complete' ? '練習結果を保存中' : running ? 'このコードを弾く' : result === 'idle' ? '準備できたら開始' : result === 'correct' ? '正解' : '時間切れ'}</span>
          <strong>{chordName(target)}</strong>
          <small>{target.bass !== undefined
            ? handAnalysis.bassMessage ?? `右手：${handAnalysis.rightInversion ?? '判定中'}、左手：${handAnalysis.leftBass === null ? '—' : NOTE_NAMES_FLAT[handAnalysis.leftBass]}`
            : result === 'correct' ? wholeAnalysis.inversion : '転回形も正解です'}</small>
        </div>
        <div className="timer-track"><i style={{ transform: `scaleX(${remaining / (limit * 1_000)})` }} /></div>
        <div className="judgement-line">
          {notes.length === 0 && <span>鍵盤を弾くと判定します</span>}
          {notes.length > 0 && !isExact && <>
            {handAnalysis.rightHand.missing.length > 0 && <span className="bad">不足: {formatPitchClasses(handAnalysis.rightHand.missing)}</span>}
            {handAnalysis.rightHand.extra.length > 0 && <span className="bad">余分: {formatPitchClasses(handAnalysis.rightHand.extra)}</span>}
            {handAnalysis.bassMessage && <span className="bad">{handAnalysis.bassMessage}</span>}
          </>}
          {isExact && <span className="good">右手：{handAnalysis.rightInversion ?? wholeAnalysis.inversion}、左手：{handAnalysis.leftBass === null ? '—' : NOTE_NAMES_FLAT[handAnalysis.leftBass]}</span>}
        </div>
        {storageError && <div className="inline-practice-error" role="alert">{storageError}</div>}
        {!running && result !== 'complete' && <button className="button primary start-button" type="button" onClick={() => {
          if (stats.attempts === 0) sessionStartedAt.current = performanceNow();
          nextQuestion();
        }}>{stats.attempts === 0 ? '練習を開始' : '次のコード'}</button>}
      </section>
      <aside className="mode-sidebar">
        {dailySession && <section className="panel daily-brief"><span className="eyebrow">TODAY</span><h3>Day {curriculumDay} · {definition.title}</h3><p>{definition.description}</p><dl><div><dt>問題数</dt><dd>{definition.questionCount}</dd></div><div><dt>合格</dt><dd>{definition.passAccuracy}%以上</dd></div><div><dt>平均</dt><dd>{(definition.maxAverageMs / 1000).toFixed(1)}秒以内</dd></div></dl></section>}
        <section className="panel"><span className="eyebrow">RANGE</span><h3>出題範囲</h3>
          <label className="field-label">練習セット<select value={scope} disabled={dailySession} onChange={(event) => setScope(event.target.value as Scope)}><option value="today">今日のカリキュラム</option><option value="white">白鍵中心</option><option value="major">メジャーのみ</option><option value="minor">マイナーのみ</option><option value="weak">苦手コードのみ</option><option value="custom">カスタム</option><option value="all">全コード</option></select></label>
          {scope === 'weak' && extractWeakTargets(performance).length === 0 && <p className="hint">成績がたまるまでは基本コードを出題します。</p>}
          {scope === 'custom' && <div className="custom-chords">{basicTargets.map((item) => { const id = targetId(item); return <label key={id}><input type="checkbox" checked={customIds.has(id)} onChange={(event) => setCustomIds((current) => { const next = new Set(current); event.target.checked ? next.add(id) : next.delete(id); return next; })} />{chordName(item)}</label>; })}</div>}
          <label className="field-label">制限時間<select value={limit} onChange={(event) => setLimit(Number(event.target.value) as 2 | 3 | 5)}><option value="2">2秒</option><option value="3">3秒</option><option value="5">5秒</option></select></label>
          <label className="check-row"><input type="checkbox" checked={autoNext} onChange={(event) => setAutoNext(event.target.checked)} />正解後に自動で次へ</label>
        </section>
        <section className="panel stats-grid"><div><span>正解率</span><strong>{accuracy}%</strong></div><div><span>平均</span><strong>{average ? `${(average / 1000).toFixed(2)}s` : '—'}</strong></div><div><span>最速</span><strong>{stats.fastestMs ? `${(stats.fastestMs / 1000).toFixed(2)}s` : '—'}</strong></div><div><span>正解</span><strong>{stats.correct}</strong></div></section>
        {!dailySession && <button className="text-button" type="button" onClick={() => setStats(emptyStats)}>記録をリセット</button>}
      </aside>
    </div>
  );
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
