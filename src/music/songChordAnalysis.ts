import { CHORD_DEFINITIONS, chordPitchClasses, toPitchClass } from './chordDefinitions';
import type { ChordQuality, ChordSegment, ChordTarget, PitchClass, SongChordDetail, SongTrack } from '../types';

const FRAME_SECONDS = 0.5;
const MIN_SEGMENT_SECONDS = 0.5;
const QUALITIES: readonly ChordQuality[] = ['major', 'minor', 'dim', 'sus4', '7', 'maj7', 'm7', 'add9'];

interface FrameChord {
  start: number;
  end: number;
  target: ChordTarget | null;
  confidence: number;
}

interface Candidate {
  target: ChordTarget;
  score: number;
}

export function simplifySongChord(target: ChordTarget | null): ChordTarget | null {
  if (!target) return null;
  const quality: ChordQuality = target.quality === 'm7' || target.quality === 'm6' || target.quality === 'mMaj7'
    ? 'minor'
    : target.quality === '7' || target.quality === 'maj7' || target.quality === 'add9' || target.quality === '6' || target.quality === 'aug'
      ? 'major'
      : target.quality;
  return {
    root: target.root,
    quality,
    ...(target.spelling ? { spelling: target.spelling } : {}),
  };
}

export function chordForDetail(segment: ChordSegment | null | undefined, detail: SongChordDetail): ChordTarget | null {
  if (!segment) return null;
  return detail === 'simple' ? segment.simple : segment.faithful;
}

export function analysisTimeForPlayback(playbackTime: number, syncOffset: number): number {
  return Math.max(0, playbackTime - syncOffset);
}

export function analyzeSongChords(tracks: readonly SongTrack[], duration: number): ChordSegment[] {
  const notes = tracks.filter((track) => track.enabled).flatMap((track) => track.notes);
  if (notes.length === 0) return [];

  const actualDuration = Math.max(duration, ...notes.map((note) => note.end));
  const frames: FrameChord[] = [];
  for (let start = 0; start < actualDuration; start += FRAME_SECONDS) {
    const end = Math.min(actualDuration, start + FRAME_SECONDS);
    const weights = Array.from({ length: 12 }, () => 0);
    let lowestPitch = Number.POSITIVE_INFINITY;
    for (const note of notes) {
      const overlap = Math.max(0, Math.min(note.end, end) - Math.max(note.start, start));
      if (overlap <= 0) continue;
      const bassBoost = note.pitch < 55 ? 1.18 : 1;
      weights[toPitchClass(note.pitch)]! += overlap * (0.45 + note.velocity) * bassBoost;
      lowestPitch = Math.min(lowestPitch, note.pitch);
    }
    frames.push(bestFrameChord(start, end, weights, lowestPitch));
  }

  smoothSingleFrameChanges(frames);
  let segments = mergeFrames(frames);
  segments = absorbShortSegments(segments);
  segments = mergeFrames(segments);

  return segments.map((segment) => {
    const faithful = segment.target ? addStableSlashBass(segment.target, segment.start, segment.end, notes) : null;
    return {
      start: segment.start,
      end: segment.end,
      faithful,
      simple: simplifySongChord(faithful),
      confidence: segment.confidence,
    };
  });
}

export function findChordSegmentIndex(segments: readonly ChordSegment[], time: number): number {
  if (segments.length === 0) return -1;
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid]!;
    if (time < segment.start) high = mid - 1;
    else if (time >= segment.end) low = mid + 1;
    else return mid;
  }
  return Math.min(segments.length - 1, Math.max(0, low));
}

function bestFrameChord(start: number, end: number, weights: readonly number[], lowestPitch: number): FrameChord {
  const total = weights.reduce((sum, value) => sum + value, 0);
  const present = weights.filter((value) => value >= total * 0.08).length;
  if (total < 0.05 || present < 2) return { start, end, target: null, confidence: 0 };

  const bassPc = Number.isFinite(lowestPitch) ? toPitchClass(lowestPitch) : null;
  const candidates: Candidate[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const quality of QUALITIES) {
      const target: ChordTarget = { root: root as PitchClass, quality };
      const chordPcs = chordPitchClasses(target);
      const chordWeight = chordPcs.reduce<number>((sum, pc) => sum + weights[pc]!, 0);
      const completeness = chordPcs.filter((pc) => weights[pc]! >= total * 0.08).length / chordPcs.length;
      const coverage = chordWeight / total;
      const rootPresent = weights[target.root]! >= total * 0.08 ? 1 : 0;
      const bassBonus = bassPc === target.root ? 0.07 : 0;
      const complexityPenalty = Math.max(0, chordPcs.length - 3) * 0.025;
      const score = coverage * 0.62 + completeness * 0.26 + rootPresent * 0.1 + bassBonus - complexityPenalty;
      candidates.push({ target, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score || chordComplexity(left.target) - chordComplexity(right.target));
  const best = candidates[0]!;
  const second = candidates[1];
  const margin = second ? best.score - second.score : best.score;
  const confidence = Math.min(1, best.score * 0.82 + Math.max(0, margin) * 1.8);
  const ambiguousDyad = present < 3 && margin < 0.06;
  return best.score >= 0.55 && !ambiguousDyad
    ? { start, end, target: best.target, confidence }
    : { start, end, target: null, confidence };
}

function smoothSingleFrameChanges(frames: FrameChord[]): void {
  for (let index = 1; index < frames.length - 1; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const next = frames[index + 1]!;
    if (targetKey(previous.target) === targetKey(next.target) && targetKey(current.target) !== targetKey(previous.target)) {
      current.target = previous.target;
      current.confidence = (previous.confidence + next.confidence) / 2;
    }
  }
}

function mergeFrames(frames: readonly FrameChord[]): FrameChord[] {
  const merged: FrameChord[] = [];
  for (const frame of frames) {
    const previous = merged.at(-1);
    if (previous && targetKey(previous.target) === targetKey(frame.target) && Math.abs(previous.end - frame.start) < 0.001) {
      const previousDuration = previous.end - previous.start;
      const nextDuration = frame.end - frame.start;
      previous.confidence = ((previous.confidence * previousDuration) + (frame.confidence * nextDuration)) / (previousDuration + nextDuration);
      previous.end = frame.end;
    } else {
      merged.push({ ...frame });
    }
  }
  return merged;
}

function absorbShortSegments(segments: FrameChord[]): FrameChord[] {
  if (segments.length < 2) return segments;
  const result = segments.map((segment) => ({ ...segment }));
  for (let index = 0; index < result.length; index += 1) {
    const segment = result[index]!;
    if (segment.end - segment.start >= MIN_SEGMENT_SECONDS) continue;
    const previous = result[index - 1];
    const next = result[index + 1];
    const replacement = previous && next && targetKey(previous.target) === targetKey(next.target)
      ? previous
      : !previous ? next : !next ? previous : previous.confidence >= next.confidence ? previous : next;
    if (replacement) {
      segment.target = replacement.target;
      segment.confidence = replacement.confidence;
    }
  }
  return result;
}

function addStableSlashBass(target: ChordTarget, start: number, end: number, notes: readonly SongTrack['notes'][number][]): ChordTarget {
  const chordPcs = chordPitchClasses(target);
  const bassWeights = Array.from({ length: 12 }, () => 0);
  const frame = 0.25;
  for (let time = start; time < end; time += frame) {
    const sounding = notes.filter((note) => note.start < time + frame && note.end > time);
    if (sounding.length === 0) continue;
    const lowest = sounding.reduce((best, note) => note.pitch < best.pitch ? note : best, sounding[0]!);
    bassWeights[toPitchClass(lowest.pitch)]! += Math.min(frame, end - time);
  }
  const total = bassWeights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return target;
  const bass = bassWeights.indexOf(Math.max(...bassWeights)) as PitchClass;
  if (bass !== target.root && chordPcs.includes(bass) && bassWeights[bass]! / total >= 0.58) {
    return { ...target, bass };
  }
  return target;
}

function targetKey(target: ChordTarget | null): string {
  return target ? `${target.root}:${target.quality}` : 'nc';
}

function chordComplexity(target: ChordTarget): number {
  return CHORD_DEFINITIONS[target.quality].intervals.length;
}
