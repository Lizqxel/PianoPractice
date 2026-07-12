import { useMemo, useState } from 'react';
import { midiNoteName, toPitchClass } from '../music/chordDefinitions';

interface PianoKeyboardProps {
  activeNotes: ReadonlySet<number>;
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
}

const START_NOTE = 36;
const END_NOTE = 84;
const BLACK_PITCHES = new Set([1, 3, 6, 8, 10]);

export function PianoKeyboard({ activeNotes, onNoteOn, onNoteOff }: PianoKeyboardProps) {
  const [latch, setLatch] = useState(false);
  const [latchedNotes, setLatchedNotes] = useState<Set<number>>(new Set());
  const notes = useMemo(
    () => Array.from({ length: END_NOTE - START_NOTE + 1 }, (_, index) => START_NOTE + index),
    [],
  );
  const whiteNotes = notes.filter((note) => !BLACK_PITCHES.has(toPitchClass(note)));
  const blackNotes = notes.filter((note) => BLACK_PITCHES.has(toPitchClass(note)));

  const press = (event: React.PointerEvent<HTMLButtonElement>, note: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!latch) {
      onNoteOn(note, 100);
      return;
    }
    if (latchedNotes.has(note)) {
      onNoteOff(note);
      setLatchedNotes((current) => { const next = new Set(current); next.delete(note); return next; });
    } else {
      onNoteOn(note, 100);
      setLatchedNotes((current) => new Set(current).add(note));
    }
  };

  const release = (event: React.PointerEvent<HTMLButtonElement>, note: number) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!latch) onNoteOff(note);
  };

  return (
    <div className="piano-wrap" aria-label="C2からC6の仮想鍵盤">
      <div className="keyboard-tools">
        <span>仮想鍵盤</span>
        <button
          type="button"
          className={latch ? 'active' : ''}
          aria-pressed={latch}
          onClick={() => {
            if (latch) {
              for (const note of latchedNotes) onNoteOff(note);
              setLatchedNotes(new Set());
            }
            setLatch((value) => !value);
          }}
        >
          ◉ クリック保持 {latch ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="piano">
        {whiteNotes.map((note) => (
          <button
            className={`piano-key white-key ${activeNotes.has(note) ? 'is-active' : ''}`}
            key={note}
            type="button"
            aria-label={`${midiNoteName(note)} MIDI ${note}`}
            onPointerDown={(event) => press(event, note)}
            onPointerUp={(event) => release(event, note)}
            onPointerCancel={(event) => release(event, note)}
          >
            {toPitchClass(note) === 0 && <span>{midiNoteName(note)}</span>}
          </button>
        ))}
        {blackNotes.map((note) => {
          const whitesBefore = whiteNotes.filter((white) => white < note).length;
          const width = 62 / whiteNotes.length;
          const left = (whitesBefore / whiteNotes.length) * 100 - width / 2;
          return (
            <button
              className={`piano-key black-key ${activeNotes.has(note) ? 'is-active' : ''}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              key={note}
              type="button"
              aria-label={`${midiNoteName(note)} MIDI ${note}`}
              onPointerDown={(event) => press(event, note)}
              onPointerUp={(event) => release(event, note)}
              onPointerCancel={(event) => release(event, note)}
            />
          );
        })}
      </div>
      <div className="keyboard-range"><span>C2 · MIDI 36</span><span>C6 · MIDI 84</span></div>
    </div>
  );
}
