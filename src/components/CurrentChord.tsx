import { analyzeHands, detectChord } from '../music/chordMatcher';
import { midiNoteName, pitchClassName } from '../music/chordDefinitions';

interface CurrentChordProps {
  notes: readonly number[];
  splitNote: number;
  onSplitNoteChange: (note: number) => void;
}

export function CurrentChord({ notes, splitNote, onSplitNoteChange }: CurrentChordProps) {
  const detected = detectChord(notes);
  const hand = detected ? analyzeHands(detected.target, notes, splitNote) : null;
  return (
    <div className="current-chord" aria-live="polite">
      <span>現在のコード</span>
      <strong>{detected?.name ?? '—'}</strong>
      <small>{hand
        ? `右手：${hand.rightInversion ?? '判定中'}、左手：${hand.leftBass === null ? '—' : pitchClassName(hand.leftBass)}`
        : notes.length > 0 ? `${notes.length}音を入力中` : '鍵盤を弾いてください'}</small>
      <label className="split-control">分割点
        <select aria-label="左右手の分割点" value={splitNote} onChange={(event) => onSplitNoteChange(Number(event.target.value))}>
          {[48, 52, 55, 57, 60, 62, 64, 67, 69, 72].map((note) => <option key={note} value={note}>{midiNoteName(note)}</option>)}
        </select>
      </label>
    </div>
  );
}
