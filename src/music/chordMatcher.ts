import type { ChordAnalysis, ChordTarget, Inversion, PitchClass } from '../types';
import {
  ALL_QUALITIES,
  CHORD_DEFINITIONS,
  chordName,
  chordPitchClasses,
  pitchClassName,
  toPitchClass,
} from './chordDefinitions';

function uniquePitchClasses(notes: Iterable<number>): PitchClass[] {
  return [...new Set([...notes].map(toPitchClass))].sort((a, b) => a - b) as PitchClass[];
}

function setDifference(left: readonly PitchClass[], right: readonly PitchClass[]): PitchClass[] {
  return left.filter((pitch) => !right.includes(pitch));
}

function inversionFor(target: ChordTarget, notes: readonly number[]): Inversion | null {
  if (notes.length === 0) return null;
  const bass = toPitchClass(Math.min(...notes));
  const ordered = CHORD_DEFINITIONS[target.quality].intervals.map((interval) => toPitchClass(target.root + interval));
  const index = ordered.indexOf(bass);
  if (index === 0) return '基本形';
  if (index === 1) return '第1転回形';
  if (index === 2) return '第2転回形';
  if (index === 3) return '第3転回形';
  return '転回形不明';
}

export function detectChord(notes: readonly number[]): { name: string; target: ChordTarget; inversion: Inversion } | null {
  const played = uniquePitchClasses(notes);
  if (played.length < 3) return null;
  for (let root = 0; root < 12; root += 1) {
    for (const quality of ALL_QUALITIES) {
      const target: ChordTarget = { root: root as PitchClass, quality };
      const expected = chordPitchClasses(target).slice().sort((a, b) => a - b);
      if (expected.length === played.length && expected.every((pc, index) => pc === played[index])) {
        return {
          name: chordName(target),
          target,
          inversion: inversionFor(target, notes) ?? '転回形不明',
        };
      }
    }
  }
  return null;
}

export function analyzeChord(target: ChordTarget, notes: readonly number[]): ChordAnalysis {
  const played = uniquePitchClasses(notes);
  const expected = chordPitchClasses(target);
  const detected = detectChord(notes);
  return {
    isExact: played.length === expected.length && expected.every((pc) => played.includes(pc)),
    targetName: chordName(target),
    playedName: detected?.name ?? null,
    inversion: detected?.inversion ?? inversionFor(target, notes),
    missing: setDifference(expected, played),
    extra: setDifference(played, expected),
  };
}

export function formatPitchClasses(pitches: readonly PitchClass[]): string {
  return pitches.map((pitch) => pitchClassName(pitch)).join('・');
}
