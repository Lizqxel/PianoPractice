import type { ChordSegment, ChordTarget } from '../types';
import type { SongleChordChart } from '../services/songle';
import type { UfretChordImport, UfretTimingMap } from '../services/ufret';
import { buildTimedChordChart } from './timedChordChart';
import type { TimedChordChartResult } from './timedChordChart';

export interface AutomaticUfretChart extends TimedChordChartResult {
  timingSource: 'ufret-video-plus' | 'songle-alignment';
  anchorCount: number;
}

export function buildUfretVideoPlusChart(
  imported: UfretChordImport,
  playbackVideoId: string,
): AutomaticUfretChart | null {
  const timing = imported.timing;
  if (!timing || timing.youtubeVideoId !== playbackVideoId) return null;
  const base = buildTimedChordChart(imported.chartText, imported.bpm, 4);
  if (base.invalidTokens.length > 0 || base.segments.length === 0) {
    throw new Error(`読み取れないU-FRETコードがあります: ${base.invalidTokens.join('、')}`);
  }

  const starts = chordStartsFromBeatMap(timing);
  if (starts.length !== base.segments.length) {
    throw new Error(`U-FRETのコード数（${base.segments.length}）と動画同期位置（${starts.length}）が一致しません。`);
  }
  const gridEnd = beatTimes(timing).at(-1) ?? starts.at(-1)! + 60 / timing.bpm;
  return {
    segments: base.segments.map((segment, index) => ({
      ...segment,
      start: starts[index]!,
      end: starts[index + 1] ?? Math.max(gridEnd, starts[index]! + 0.25),
    })),
    invalidTokens: [],
    duration: gridEnd,
    mode: 'timestamps',
    timingSource: 'ufret-video-plus',
    anchorCount: starts.length,
  };
}

export function alignUfretChartToSongle(
  imported: UfretChordImport,
  reference: SongleChordChart,
): AutomaticUfretChart {
  const base = buildTimedChordChart(imported.chartText, imported.bpm, 4);
  if (base.invalidTokens.length > 0 || base.segments.length === 0) {
    throw new Error(`読み取れないU-FRETコードがあります: ${base.invalidTokens.join('、')}`);
  }
  const anchors = alignChordSequences(base.segments, reference.segments);
  const minimumAnchors = Math.max(4, Math.ceil(base.segments.length * 0.1));
  if (anchors.length < minimumAnchors) {
    throw new Error(`選択したYouTubeとU-FRETコード譜を自動同期できませんでした（一致 ${anchors.length}/${minimumAnchors} 必要）。別バージョンの動画ではないか確認してください。`);
  }

  const referenceStart = reference.segments.find((segment) => segment.faithful)?.start ?? 0;
  const referenceEnd = Math.max(reference.duration, reference.segments.at(-1)?.end ?? 0);
  const starts = interpolateStarts(base.segments.length, anchors, referenceStart, referenceEnd);
  const segments = base.segments.map((segment, index) => ({
    ...segment,
    start: starts[index]!,
    end: starts[index + 1] ?? Math.max(referenceEnd, starts[index]! + 0.25),
    confidence: anchors.some((anchor) => anchor.sourceIndex === index) ? 0.9 : 0.7,
  }));
  return {
    segments,
    invalidTokens: [],
    duration: Math.max(referenceEnd, segments.at(-1)?.end ?? 0),
    mode: 'timestamps',
    timingSource: 'songle-alignment',
    anchorCount: anchors.length,
  };
}

export function chordStartsFromBeatMap(timing: UfretTimingMap): number[] {
  const times = beatTimes(timing);
  return [...timing.chordChange].flatMap((marker, index) => marker === '0' ? [times[index]!] : []);
}

function beatTimes(timing: UfretTimingMap): number[] {
  if (!/^[09]+$/.test(timing.chordChange) || !Number.isFinite(timing.startChord) || timing.startChord < 0) {
    throw new Error('U-FRET動画プラスの拍情報が壊れています。');
  }
  const defaultBpm = validBpm(timing.bpm) ? timing.bpm : 100;
  const changes = [{ beat: 0, bpm: defaultBpm }, ...timing.tempoChanges.flatMap((entry) => {
    const match = /^\s*(\d+)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(entry);
    if (!match) return [];
    const beat = Number(match[1]);
    const bpm = Number(match[2]);
    return Number.isInteger(beat) && beat >= 0 && validBpm(bpm) ? [{ beat, bpm }] : [];
  })].sort((left, right) => left.beat - right.beat);

  const tempos = new Map<number, number>();
  changes.forEach((change) => tempos.set(change.beat, change.bpm));
  const result: number[] = [];
  let current = timing.startChord;
  let bpm = defaultBpm;
  for (let beat = 0; beat <= timing.chordChange.length; beat += 1) {
    bpm = tempos.get(beat) ?? bpm;
    result.push(current);
    current += 60 / bpm;
  }
  return result;
}

function validBpm(value: number): boolean {
  return Number.isFinite(value) && value >= 30 && value <= 300;
}

interface AlignmentAnchor {
  sourceIndex: number;
  time: number;
}

function alignChordSequences(sourceSegments: readonly ChordSegment[], referenceSegments: readonly ChordSegment[]): AlignmentAnchor[] {
  const source = sourceSegments.flatMap((segment, index) => segment.faithful ? [{ index, target: segment.faithful }] : []);
  const reference = referenceSegments.flatMap((segment, index) => segment.faithful ? [{ index, segment, target: segment.faithful }] : []);
  const rows = source.length + 1;
  const columns = reference.length + 1;
  const scores = new Float64Array(rows * columns);
  const trace = new Uint8Array(rows * columns);
  const at = (row: number, column: number) => row * columns + column;
  for (let row = 1; row < rows; row += 1) {
    scores[at(row, 0)] = scores[at(row - 1, 0)]! - 2.5;
    trace[at(row, 0)] = 2;
  }
  for (let column = 1; column < columns; column += 1) {
    scores[at(0, column)] = scores[at(0, column - 1)]! - 1.5;
    trace[at(0, column)] = 3;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const diagonal = scores[at(row - 1, column - 1)]! + chordMatchScore(source[row - 1]!.target, reference[column - 1]!.target);
      const dropSource = scores[at(row - 1, column)]! - 2.5;
      const dropReference = scores[at(row, column - 1)]! - 1.5;
      if (diagonal >= dropSource && diagonal >= dropReference) {
        scores[at(row, column)] = diagonal;
        trace[at(row, column)] = 1;
      } else if (dropSource >= dropReference) {
        scores[at(row, column)] = dropSource;
        trace[at(row, column)] = 2;
      } else {
        scores[at(row, column)] = dropReference;
        trace[at(row, column)] = 3;
      }
    }
  }

  const anchors: AlignmentAnchor[] = [];
  let row = source.length;
  let column = reference.length;
  while (row > 0 || column > 0) {
    const direction = trace[at(row, column)];
    if (direction === 1) {
      const left = source[row - 1]!;
      const right = reference[column - 1]!;
      if (chordMatchScore(left.target, right.target) >= 6) {
        anchors.push({ sourceIndex: left.index, time: right.segment.start });
      }
      row -= 1;
      column -= 1;
    } else if (direction === 2) {
      row -= 1;
    } else if (direction === 3) {
      column -= 1;
    } else {
      break;
    }
  }
  return anchors.reverse();
}

function chordMatchScore(left: ChordTarget, right: ChordTarget): number {
  if (left.root !== right.root) return -5;
  if (left.quality === right.quality) return left.bass === right.bass ? 8 : 7;
  return qualityFamily(left.quality) === qualityFamily(right.quality) ? 6 : 2;
}

function qualityFamily(quality: ChordTarget['quality']): 'major' | 'minor' | 'dim' | 'other' {
  if (['major', '6', '7', 'maj7', 'add9', 'aug'].includes(quality)) return 'major';
  if (['minor', 'm6', 'm7', 'mMaj7'].includes(quality)) return 'minor';
  if (quality === 'dim' || quality === 'm7b5') return 'dim';
  return 'other';
}

function interpolateStarts(count: number, anchors: readonly AlignmentAnchor[], referenceStart: number, referenceEnd: number): number[] {
  const starts = Array<number>(count).fill(Number.NaN);
  anchors.forEach((anchor) => { starts[anchor.sourceIndex] = anchor.time; });
  const first = anchors[0]!;
  for (let index = 0; index < first.sourceIndex; index += 1) {
    const ratio = index / Math.max(1, first.sourceIndex);
    starts[index] = referenceStart + (first.time - referenceStart) * ratio;
  }
  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex]!;
    const right = anchors[anchorIndex + 1]!;
    for (let index = left.sourceIndex + 1; index < right.sourceIndex; index += 1) {
      const ratio = (index - left.sourceIndex) / (right.sourceIndex - left.sourceIndex);
      starts[index] = left.time + (right.time - left.time) * ratio;
    }
  }
  const last = anchors.at(-1)!;
  for (let index = last.sourceIndex + 1; index < count; index += 1) {
    const ratio = (index - last.sourceIndex) / Math.max(1, count - last.sourceIndex);
    starts[index] = last.time + (referenceEnd - last.time) * ratio;
  }
  for (let index = 0; index < starts.length; index += 1) {
    if (!Number.isFinite(starts[index])) starts[index] = index === 0 ? referenceStart : starts[index - 1]! + 0.05;
    if (index > 0 && starts[index]! <= starts[index - 1]!) starts[index] = starts[index - 1]! + 0.05;
  }
  return starts;
}
