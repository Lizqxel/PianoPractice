import { chordName } from './chordDefinitions';
import { parseChordSymbol } from './chordParser';
import { simplifySongChord } from './songChordAnalysis';
import type { ChordSegment, ChordTarget } from '../types';

export interface TimedChordChartResult {
  segments: ChordSegment[];
  invalidTokens: string[];
  duration: number;
  mode: 'bars' | 'timestamps';
}

interface ChartCell {
  target: ChordTarget | null;
  label: string;
}

const TIMED_LINE = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s+(.+?)\s*$/;
const REST_NAMES = new Set(['N.C.', 'N.C', 'NC']);

export function buildTimedChordChart(text: string, bpm: number, beatsPerBar = 4): TimedChordChartResult {
  const safeBpm = clamp(bpm, 30, 300);
  const safeBeats = clamp(Math.round(beatsPerBar), 1, 12);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const timestampMode = lines.length > 0 && lines.every((line) => TIMED_LINE.test(line));
  return timestampMode
    ? buildTimestampChart(lines, safeBpm, safeBeats)
    : buildBarChart(text, safeBpm, safeBeats);
}

export function chartPreviewLabel(segment: ChordSegment): string {
  return segment.faithful ? chordName(segment.faithful) : 'N.C.';
}

export function retimeChordSegments(
  segments: readonly ChordSegment[],
  starts: readonly number[],
  mediaDuration = 0,
): ChordSegment[] {
  if (segments.length !== starts.length) throw new Error('すべてのコードに時刻を付けてください。');
  if (segments.length === 0) return [];
  starts.forEach((start, index) => {
    if (!Number.isFinite(start) || start < 0) throw new Error('同期時刻を読み取れませんでした。');
    if (index > 0 && start <= starts[index - 1]!) throw new Error('コードの時刻は前から順番に指定してください。');
  });

  const last = segments.at(-1)!;
  const fallbackTail = Math.max(0.25, last.end - last.start);
  return segments.map((segment, index) => ({
    ...segment,
    start: starts[index]!,
    end: index + 1 < starts.length
      ? starts[index + 1]!
      : Math.max(starts[index]! + fallbackTail, mediaDuration),
  }));
}

function buildTimestampChart(lines: readonly string[], bpm: number, beatsPerBar: number): TimedChordChartResult {
  const invalidTokens: string[] = [];
  const events: { start: number; cell: ChartCell }[] = [];
  for (const line of lines) {
    const match = TIMED_LINE.exec(line);
    if (!match) continue;
    const start = Number(match[1]) * 60 + Number(match[2]);
    const raw = match[3]!.trim();
    const cell = parseCell(raw);
    if (!cell || !Number.isFinite(start)) {
      invalidTokens.push(raw);
      continue;
    }
    if (events.length > 0 && start <= events.at(-1)!.start) {
      invalidTokens.push(`${raw}（時刻は昇順にしてください）`);
      continue;
    }
    events.push({ start, cell });
  }

  const fallbackDuration = beatsPerBar * 60 / bpm;
  const segments: ChordSegment[] = [];
  if (events[0] && events[0].start > 0) {
    segments.push(toSegment(0, events[0].start, null, 0));
  }
  segments.push(...events.map((event, index) => toSegment(
    event.start,
    events[index + 1]?.start ?? event.start + fallbackDuration,
    event.cell.target,
    Math.floor(index / 4) + 1,
  )));
  return {
    segments,
    invalidTokens,
    duration: segments.at(-1)?.end ?? 0,
    mode: 'timestamps',
  };
}

function buildBarChart(text: string, bpm: number, beatsPerBar: number): TimedChordChartResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let measures: string[];
  if (text.includes('|')) {
    measures = text.replace(/\r?\n/g, ' | ').split('|').map((measure) => measure.trim()).filter(Boolean);
  } else if (lines.length > 1) {
    measures = lines;
  } else {
    measures = (lines[0] ?? '').split(/[\s,]+/).filter(Boolean);
  }

  const invalidTokens: string[] = [];
  const parsedMeasures: ChartCell[][] = [];
  let previous: ChartCell | null = null;
  for (const measure of measures) {
    const cells: ChartCell[] = [];
    for (const token of measure.split(/[\s,]+/).filter(Boolean)) {
      if ((token === '%' || token === '-') && previous) {
        cells.push(previous);
        continue;
      }
      const cell = parseCell(token);
      if (!cell) {
        invalidTokens.push(token);
        continue;
      }
      cells.push(cell);
      previous = cell;
    }
    if (cells.length > 0) parsedMeasures.push(cells);
  }

  const barDuration = beatsPerBar * 60 / bpm;
  const segments: ChordSegment[] = [];
  parsedMeasures.forEach((measure, measureIndex) => {
    const cellDuration = barDuration / measure.length;
    measure.forEach((cell, cellIndex) => {
      const start = measureIndex * barDuration + cellIndex * cellDuration;
      segments.push(toSegment(start, start + cellDuration, cell.target, measureIndex + 1));
    });
  });
  return {
    segments,
    invalidTokens: [...new Set(invalidTokens)],
    duration: parsedMeasures.length * barDuration,
    mode: 'bars',
  };
}

function parseCell(raw: string): ChartCell | null {
  const label = raw.trim();
  if (REST_NAMES.has(label.toUpperCase())) return { target: null, label: 'N.C.' };
  const target = parseChordSymbol(label);
  return target ? { target, label } : null;
}

function toSegment(start: number, end: number, target: ChordTarget | null, measure: number): ChordSegment {
  return {
    start,
    end,
    faithful: target,
    simple: simplifySongChord(target),
    confidence: 1,
    measure,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
