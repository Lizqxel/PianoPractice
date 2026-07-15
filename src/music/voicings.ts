import { CHORD_DEFINITIONS, pitchClassNameForTarget, toPitchClass } from './chordDefinitions';
import type { ChordTarget, PitchClass } from '../types';

export type InversionIndex = 0 | 1 | 2 | 3;

export function recommendedVoicing(target: ChordTarget, inversion: InversionIndex = 0): number[] {
  const pitches = CHORD_DEFINITIONS[target.quality].intervals.map((interval) => target.root + interval);
  const rotated = [...pitches.slice(inversion), ...pitches.slice(0, inversion).map((value) => value + 12)];
  let base = 60 + target.root;
  if (base > 67) base -= 12;
  const rootOffset = base - target.root;
  return rotated.map((value) => rootOffset + value);
}

export function recommendedBassNote(target: ChordTarget): number {
  const pc = target.bass ?? target.root;
  return 48 + pc > 59 ? 36 + pc : 48 + pc;
}

export function voicingPitchClasses(target: ChordTarget): PitchClass[] {
  return CHORD_DEFINITIONS[target.quality].intervals.map((interval) => toPitchClass(target.root + interval));
}

export function voicingNoteNames(target: ChordTarget): string[] {
  return voicingPitchClasses(target).map((pc) => pitchClassNameForTarget(pc, target));
}

export function recommendedFingering(noteCount: number): number[] {
  if (noteCount <= 3) return [1, 3, 5];
  return [1, 2, 3, 5].slice(0, noteCount);
}

export function fingeringMap(notes: readonly number[]): Record<number, number> {
  const fingers = recommendedFingering(notes.length);
  return Object.fromEntries(notes.map((note, index) => [note, fingers[index] ?? 5]));
}

export function totalVoiceMovement(previous: readonly number[], next: readonly number[]): number {
  if (previous.length === 0 || next.length === 0) return 0;
  return next.reduce((sum, note) => sum + Math.min(...previous.map((prior) => Math.abs(note - prior))), 0);
}

export function sameMidiNotes(played: readonly number[], expected: readonly number[]): boolean {
  if (played.length !== expected.length) return false;
  const left = [...played].sort((a, b) => a - b);
  const right = [...expected].sort((a, b) => a - b);
  return left.every((note, index) => note === right[index]);
}

export function bestInversion(previous: readonly number[], target: ChordTarget): { inversion: InversionIndex; notes: number[]; movement: number } {
  const inversions = ([0, 1, 2, 3] as InversionIndex[]).slice(0, CHORD_DEFINITIONS[target.quality].intervals.length);
  const candidates = inversions.map((inversion) => {
    const notes = recommendedVoicing(target, inversion);
    return { inversion, notes, movement: totalVoiceMovement(previous, notes) };
  });
  return candidates.sort((a, b) => a.movement - b.movement)[0]!;
}
