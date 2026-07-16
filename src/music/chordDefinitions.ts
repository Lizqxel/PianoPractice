import type { ChordDefinition, ChordQuality, ChordTarget, PitchClass } from '../types';

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const CHORD_DEFINITIONS: Record<ChordQuality, ChordDefinition> = {
  major: { quality: 'major', symbol: '', label: 'メジャー', intervals: [0, 4, 7] },
  minor: { quality: 'minor', symbol: 'm', label: 'マイナー', intervals: [0, 3, 7] },
  dim: { quality: 'dim', symbol: 'dim', label: 'ディミニッシュ', intervals: [0, 3, 6] },
  m7b5: { quality: 'm7b5', symbol: 'm7♭5', label: 'ハーフディミニッシュ', intervals: [0, 3, 6, 10] },
  aug: { quality: 'aug', symbol: 'aug', label: 'オーギュメント', intervals: [0, 4, 8] },
  sus2: { quality: 'sus2', symbol: 'sus2', label: 'サスツー', intervals: [0, 2, 7] },
  sus4: { quality: 'sus4', symbol: 'sus4', label: 'サスフォー', intervals: [0, 5, 7] },
  '6': { quality: '6', symbol: '6', label: 'シックス', intervals: [0, 4, 7, 9] },
  m6: { quality: 'm6', symbol: 'm6', label: 'マイナーシックス', intervals: [0, 3, 7, 9] },
  '7': { quality: '7', symbol: '7', label: 'セブンス', intervals: [0, 4, 7, 10] },
  maj7: { quality: 'maj7', symbol: 'maj7', label: 'メジャーセブンス', intervals: [0, 4, 7, 11] },
  m7: { quality: 'm7', symbol: 'm7', label: 'マイナーセブンス', intervals: [0, 3, 7, 10] },
  mMaj7: { quality: 'mMaj7', symbol: 'mMaj7', label: 'マイナーメジャーセブンス', intervals: [0, 3, 7, 11] },
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

export function chordName(target: ChordTarget, preferFlats = keyPrefersFlats(target.root)): string {
  if (target.spelling) preferFlats = target.spelling === 'flat';
  const chord = `${pitchClassName(target.root, preferFlats)}${CHORD_DEFINITIONS[target.quality].symbol}`;
  return target.bass !== undefined && target.bass !== target.root
    ? `${chord}/${pitchClassName(target.bass, preferFlats)}`
    : chord;
}

export function pitchClassNameForTarget(pc: PitchClass, target: ChordTarget): string {
  return pitchClassName(pc, target.spelling ? target.spelling === 'flat' : keyPrefersFlats(target.root));
}

const FLAT_KEYS = new Set<PitchClass>([1, 3, 5, 8, 10]);

export function keyPrefersFlats(key: PitchClass): boolean {
  return FLAT_KEYS.has(key) || key === 0;
}

export function chordNameForKey(target: ChordTarget, key: PitchClass): string {
  return chordName(target, keyPrefersFlats(key));
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
  const match = /^([A-G])([#b]?)$/.exec(normalized);
  if (match) {
    const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
    return toPitchClass(natural[match[1]!]! + accidental);
  }
  throw new Error(`不明な音名です: ${name}`);
}
