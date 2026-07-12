import { useMemo, useState } from 'react';
import { CURRICULUM_DAYS } from '../music/curriculum';
import { curriculumCsv, downloadCsv, loadCurriculum, saveCurriculum } from '../services/storage';
import type { CurriculumDayRecord } from '../types';

export const CURRICULUM = CURRICULUM_DAYS.map((day) => day.title);

function initialRecords(): CurriculumDayRecord[] {
  const saved = loadCurriculum();
  return CURRICULUM.map((_, index) => saved.find((item) => item.day === index + 1) ?? {
    day: index + 1, minutes: 0, accuracy: 0, averageMs: 0, completed: false,
  });
}

interface CurriculumModeProps { onStartDay: (day: number) => void }

export function CurriculumMode({ onStartDay }: CurriculumModeProps) {
  const [records, setRecords] = useState(initialRecords);
  const [error, setError] = useState<string | null>(null);
  const completed = records.filter((record) => record.completed).length;
  const totalMinutes = records.reduce((sum, record) => sum + record.minutes, 0);
  const progress = Math.round((completed / 14) * 100);
  const nextDay = useMemo(() => records.find((record) => !record.completed)?.day ?? 14, [records]);

  const update = (day: number, patch: Partial<CurriculumDayRecord>) => {
    const next = records.map((record) => record.day === day ? { ...record, ...patch } : record);
    setRecords(next);
    try { saveCurriculum(next); setError(null); } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : '保存に失敗しました'); }
  };

  return (
    <div className="curriculum-page">
      <header className="curriculum-header"><div><span className="mode-kicker">14 DAY PROGRAM</span><h2>14日間で、コードを手の形に。</h2><p>短い練習を積み重ねて、見る・押さえる・つなぐを段階的に身につけます。</p></div><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><div><strong>{progress}%</strong><span>{completed}/14日</span></div></div></header>
      <div className="curriculum-summary"><div><span>次のレッスン</span><strong>Day {nextDay}</strong><small>{CURRICULUM[nextDay - 1]}</small></div><div><span>累計練習</span><strong>{totalMinutes}<small> 分</small></strong></div><button className="button secondary" type="button" onClick={() => downloadCsv(curriculumCsv(records, CURRICULUM), 'chord-sprint-history.csv')}>CSVを書き出す</button></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="day-grid">
        {records.map((record, index) => (
          <article className={`day-card ${record.completed ? 'completed' : ''} ${record.day === nextDay ? 'next' : ''}`} key={record.day}>
            <div className="day-card-head"><span>DAY {String(record.day).padStart(2, '0')}</span><label className="completion-check"><input type="checkbox" checked={record.completed} onChange={(event) => update(record.day, { completed: event.target.checked })} /><i>✓</i></label></div>
            <h3>{CURRICULUM[index]}</h3>
            <p className="day-description">{CURRICULUM_DAYS[index]?.description}</p>
            <div className="day-goal"><span>{CURRICULUM_DAYS[index]?.questionCount}問</span><span>合格 {CURRICULUM_DAYS[index]?.passAccuracy}%</span><span>平均 {(CURRICULUM_DAYS[index]!.maxAverageMs / 1000).toFixed(1)}秒以内</span></div>
            <div className="day-fields"><label>練習時間<input type="number" min="0" max="600" value={record.minutes} onChange={(event) => update(record.day, { minutes: Number(event.target.value) })} /><span>分</span></label><label>正解率<input type="number" min="0" max="100" value={record.accuracy} onChange={(event) => update(record.day, { accuracy: Number(event.target.value) })} /><span>%</span></label><label>平均反応<input type="number" min="0" max="60000" value={record.averageMs} onChange={(event) => update(record.day, { averageMs: Number(event.target.value) })} /><span>ms</span></label></div>
            <button className="button secondary day-start" type="button" onClick={() => onStartDay(record.day)}>この日の練習を開始 →</button>
          </article>
        ))}
      </div>
    </div>
  );
}
