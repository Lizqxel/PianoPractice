import { detectChord } from '../music/chordMatcher';

interface CurrentChordProps { notes: readonly number[] }

export function CurrentChord({ notes }: CurrentChordProps) {
  const detected = detectChord(notes);
  return (
    <div className="current-chord" aria-live="polite">
      <span>現在のコード</span>
      <strong>{detected?.name ?? '—'}</strong>
      <small>{detected?.inversion ?? (notes.length > 0 ? `${notes.length}音を入力中` : '鍵盤を弾いてください')}</small>
    </div>
  );
}
