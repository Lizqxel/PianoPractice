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
  bass?: PitchClass;
  spelling?: 'sharp' | 'flat';
}

export type LessonType = 'guidedChordLearning' | 'sprint' | 'inversion' | 'bassChord' | 'progression' | 'slashChord' | 'song' | 'sightReading' | 'mixedTest';

export type Inversion = '基本形' | '第1転回形' | '第2転回形' | '第3転回形' | '転回形不明';

export interface ChordAnalysis {
  isExact: boolean;
  targetName: string;
  playedName: string | null;
  inversion: Inversion | null;
  missing: PitchClass[];
  extra: PitchClass[];
}

export interface HandAnalysis {
  isExact: boolean;
  rightHand: ChordAnalysis;
  rightInversion: Inversion | null;
  leftBass: PitchClass | null;
  expectedBass: PitchClass | null;
  bassCorrect: boolean;
  bassMessage: string | null;
}

export interface MidiNoteEvent {
  type: 'noteon' | 'noteoff';
  note: number;
  velocity: number;
  channel: number;
  timestamp: number;
}

export interface MidiRawEvent {
  data: readonly number[];
  timestamp: number;
}

export type SoundMode = 'internal' | 'external' | 'both';

export type AppMode = 'home' | 'sprint' | 'progression' | 'sixty' | 'songPractice' | 'curriculum' | 'lesson';

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
  lastPracticedAt?: string;
}

export interface ChordPerformanceRecord {
  id: string;
  target: ChordTarget;
  attempts: number;
  correct: number;
  totalReactionMs: number;
  lastPracticedAt: string;
  guidedCorrect?: number;
  unguidedCorrect?: number;
  mistakes?: number;
  hintUses?: number;
  recentResults?: boolean[];
  mastered?: boolean;
}

export interface DailySessionResult {
  day: number;
  minutes: number;
  accuracy: number;
  averageMs: number;
  passed: boolean;
}

export interface CurriculumDayDefinition {
  day: number;
  title: string;
  description: string;
  targets: readonly ChordTarget[];
  questionCount: number;
  passAccuracy: number;
  maxAverageMs: number;
  lessonType: LessonType;
}

export interface KeyboardGuideState {
  guideNotes: readonly number[];
  leftGuideNotes: readonly number[];
  correctActiveNotes: readonly number[];
  extraActiveNotes: readonly number[];
  fingering: Readonly<Record<number, number>>;
  spelling: 'sharp' | 'flat';
}

export type SongChordDetail = 'simple' | 'faithful';

export type SongHandMode = 'right' | 'both';

export interface SongNote {
  id: string;
  pitch: number;
  start: number;
  end: number;
  velocity: number;
  trackId: string;
  instrument: string;
}

export interface SongTrack {
  id: string;
  name: string;
  instrument: string;
  isDrum: boolean;
  isVoice: boolean;
  enabled: boolean;
  notes: readonly SongNote[];
}

export interface ChordSegment {
  start: number;
  end: number;
  faithful: ChordTarget | null;
  simple: ChordTarget | null;
  confidence: number;
  measure?: number;
}

export interface ChordChartSource {
  label: string;
  url: string;
}

export type PlaybackSource =
  | { kind: 'local'; name: string; url: string; duration?: number }
  | { kind: 'youtube'; videoId: string; title?: string; channelTitle?: string; duration?: number };

export interface SongProject {
  title: string;
  playback: PlaybackSource;
  tracks: readonly SongTrack[];
  chords: readonly ChordSegment[];
  duration: number;
  midiBytes?: Uint8Array;
  chordSource?: ChordChartSource;
}

export type TranscriptionEvent =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'start'; pitch: number; start_time: number; index: number; instrument: string }
  | { type: 'end'; end_time: number; start_event_index: number }
  | { type: 'midi'; data: string };

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export interface LocalServiceStatus {
  status: 'ok';
  model: string;
  device: string;
  cudaAvailable: boolean;
  youtubeSearchConfigured: boolean;
}

export interface PlaybackController {
  play(): void | Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getAvailableRates(): readonly number[];
  isPlaying(): boolean;
}
