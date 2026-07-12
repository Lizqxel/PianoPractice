import type { PitchClass } from '../types';
import { transpose } from './chordDefinitions';

export interface ProgressionPattern {
  id: string;
  name: string;
  roman: string;
  degrees: readonly { semitones: number; minor: boolean }[];
}

export const PROGRESSIONS: readonly ProgressionPattern[] = [
  { id: 'pop', name: '王道進行', roman: 'I–V–vi–IV', degrees: [{ semitones: 0, minor: false }, { semitones: 7, minor: false }, { semitones: 9, minor: true }, { semitones: 5, minor: false }] },
  { id: 'sensitive', name: '感傷進行', roman: 'vi–IV–I–V', degrees: [{ semitones: 9, minor: true }, { semitones: 5, minor: false }, { semitones: 0, minor: false }, { semitones: 7, minor: false }] },
  { id: 'fifties', name: '50年代進行', roman: 'I–vi–IV–V', degrees: [{ semitones: 0, minor: false }, { semitones: 9, minor: true }, { semitones: 5, minor: false }, { semitones: 7, minor: false }] },
  { id: 'basic', name: '基本カデンツ', roman: 'I–IV–V–I', degrees: [{ semitones: 0, minor: false }, { semitones: 5, minor: false }, { semitones: 7, minor: false }, { semitones: 0, minor: false }] },
];

export function progressionChords(pattern: ProgressionPattern, key: PitchClass) {
  return pattern.degrees.map((degree) => ({
    root: transpose(key, degree.semitones),
    quality: degree.minor ? ('minor' as const) : ('major' as const),
  }));
}
