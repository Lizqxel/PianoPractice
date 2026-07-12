import type { ChordDefinition, ChordQuality, ChordTarget, PitchClass } from '../types';

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const CHORD_DEFINITIONS: Record<ChordQuality, ChordDefinition> = {
  major: { quality: 'major', symbol: '', label: 'メジャー', intervals: [0, 4, 7] },
  minor: { quality: 'minor', symbol: 'm', label: 'マイナー', intervals: [0, 3, 7] },
  dim: { quality: 'dim', symbol: 'dim', label: 'ディミニッシュ', intervals: [0, 3, 6] },
  sus4: { quality: 'sus4', symbol: 'sus4', label: 'サスフォー', intervals: [0, 5, 7] },
  '7': { quality: '7', symbol: '7', label: 'セブンス', intervals: [0, 4, 7, 10] },
  maj7: { quality: 'maj7', symbol: 'maj7', label: 'メジャーセブンス', intervals: [0, 4, 7, 11] },
  m7: { quality: 'm7', symbol: 'm7', label: 'マイナーセブンス', intervals: [0, 3, 7, 10] },
  add9: { quality: 'add9', symbol: 'add9', label: 'アドナインス', intervals: [0, 2, 4, 7] },
};

export const ALL_QUALITIES = Object.keys(CHORD_DEFINITIONS) as ChordQuality[];
export const BEGINNER_QUALITIES: readonly ChordQuality[] = ['major', 'minor'];
export const INTERMEDIATE_QUALITIES: readonly ChordQuality[] = ['major', 'minor', '7', 'maj7', 'm7', 'sus4', 'add9'];

export function toPitchClass(note: number): PitchClass {
  return (((note % 12) + 12) % 12) as PitchClass;
}

export function pitchClassName(pc: PitchClass, preferFlats = true): string {
  return (preferFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[pc];
}

export function midiNoteName(note: number): string {
  const pc = toPitchClass(note);
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES_SHARP[pc]}${octave}`;
}

export function chordName(target: ChordTarget, preferFlats = true): string {
  return `${pitchClassName(target.root, preferFlats)}${CHORD_DEFINITIONS[target.quality].symbol}`;
}

export function chordPitchClasses(target: ChordTarget): PitchClass[] {
  return CHORD_DEFINITIONS[target.quality].intervals.map(
    (interval) => toPitchClass(target.root + interval),
  );
}

export function transpose(root: PitchClass, semitones: number): PitchClass {
  return toPitchClass(root + semitones);
}

export function parseRoot(name: string): PitchClass {
  const normalized = name.replace('♭', 'b').replace('♯', '#');
  const index = [...NOTE_NAMES_FLAT].findIndex((note) => note === normalized);
  if (index >= 0) return index as PitchClass;
  const sharpIndex = [...NOTE_NAMES_SHARP].findIndex((note) => note === normalized);
  if (sharpIndex >= 0) return sharpIndex as PitchClass;
  throw new Error(`不明な音名です: ${name}`);
}
