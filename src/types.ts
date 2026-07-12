export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type ChordQuality = 'major' | 'minor' | 'dim' | 'sus4' | '7' | 'maj7' | 'm7' | 'add9';

export interface ChordDefinition {
  quality: ChordQuality;
  symbol: string;
  label: string;
  intervals: readonly number[];
}

export interface ChordTarget {
  root: PitchClass;
  quality: ChordQuality;
}

export type Inversion = '基本形' | '第1転回形' | '第2転回形' | '第3転回形' | '転回形不明';

export interface ChordAnalysis {
  isExact: boolean;
  targetName: string;
  playedName: string | null;
  inversion: Inversion | null;
  missing: PitchClass[];
  extra: PitchClass[];
}

export interface MidiNoteEvent {
  type: 'noteon' | 'noteoff';
  note: number;
  velocity: number;
  channel: number;
  timestamp: number;
}

export type AppMode = 'home' | 'sprint' | 'progression' | 'sixty' | 'curriculum';

export interface SprintStats {
  attempts: number;
  correct: number;
  totalReactionMs: number;
  fastestMs: number | null;
}

export interface CurriculumDayRecord {
  day: number;
  minutes: number;
  accuracy: number;
  averageMs: number;
  completed: boolean;
}
