import { parseChordSymbol } from '../music/chordParser';
import { simplifySongChord } from '../music/songChordAnalysis';
import { parseYouTubeVideoId } from './youtube';
import type { ChordSegment, ChordTarget, SongleSearchResult } from '../types';

const SONGLE_API = 'https://widget.songle.jp/api/v1';
const RESULT_LIMIT = 8;

interface RawSongleSong {
  id?: number;
  title?: string;
  artist?: { name?: string };
  permalink?: string;
  url?: string;
  duration?: number;
}

interface RawSongleChord {
  start?: number;
  duration?: number;
  name?: string;
}

interface RawSongleBeat {
  start?: number;
  position?: number;
}

export interface SongleChordChart {
  segments: ChordSegment[];
  duration: number;
  unsupportedNames: string[];
  beats: number[];
}

export async function searchSongleSongs(query: string, signal?: AbortSignal): Promise<SongleSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const response = await fetch(`${SONGLE_API}/songs/search.json?q=${encodeURIComponent(normalized)}`, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error('曲を検索できませんでした。少し待ってからもう一度お試しください。');
  const payload = await response.json() as RawSongleSong[];
  const seen = new Set<string>();
  return (Array.isArray(payload) ? payload : []).flatMap((song): SongleSearchResult[] => {
    const videoId = parseYouTubeVideoId(song.permalink ?? '');
    if (!videoId || seen.has(videoId) || typeof song.id !== 'number') return [];
    seen.add(videoId);
    return [{
      id: song.id,
      title: song.title?.trim() || 'タイトル不明',
      artist: song.artist?.name?.trim() || 'アーティスト不明',
      videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      songleUrl: normalizeSongleUrl(song.url, videoId),
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      duration: Math.max(0, Number(song.duration) || 0) / 1000,
    }];
  }).slice(0, RESULT_LIMIT);
}

export async function loadSongleChordChart(song: SongleSearchResult, signal?: AbortSignal): Promise<SongleChordChart> {
  return loadSongleChordData(song.videoId, song.duration, signal);
}

export async function loadSongleChordChartForVideo(videoId: string, signal?: AbortSignal): Promise<SongleChordChart> {
  return loadSongleChordData(videoId, 0, signal);
}

async function loadSongleChordData(videoId: string, knownDuration: number, signal?: AbortSignal): Promise<SongleChordChart> {
  const sourceUrl = `www.youtube.com/watch?v=${videoId}`;
  const request = (path: 'chord' | 'beat') => fetch(
    `${SONGLE_API}/song/${path}.json?url=${encodeURIComponent(sourceUrl)}`,
    { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) },
  );
  const [chordResponse, beatResponse] = await Promise.all([request('chord'), request('beat')]);
  if (chordResponse.status === 404) throw new Error('この候補にはコード解析結果がありません。別の候補を選んでください。');
  if (!chordResponse.ok) throw new Error('コードを取得できませんでした。少し待ってからもう一度お試しください。');

  const chordPayload = await chordResponse.json() as { chords?: RawSongleChord[] };
  const beatPayload = beatResponse.ok ? await beatResponse.json() as { beats?: RawSongleBeat[] } : { beats: [] };
  const beats = Array.isArray(beatPayload.beats) ? beatPayload.beats : [];
  const unsupported = new Set<string>();
  const rawSegments = (Array.isArray(chordPayload.chords) ? chordPayload.chords : []).flatMap((chord): ChordSegment[] => {
    const start = Number(chord.start) / 1000;
    const duration = Number(chord.duration) / 1000;
    const name = chord.name?.trim() || 'N';
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
    const faithful = parseSongleChord(name);
    if (name !== 'N' && !faithful) unsupported.add(name);
    return [{
      start,
      end: start + duration,
      faithful,
      simple: simplifySongChord(faithful),
      confidence: faithful || name === 'N' ? 1 : 0,
      measure: measureAt(start * 1000, beats),
    }];
  });
  const segments = mergeSameMeasureSegments(rawSegments);
  if (segments.length === 0 || segments.every((segment) => !segment.faithful)) {
    throw new Error('この候補から練習できるコードを取得できませんでした。別の候補を選んでください。');
  }
  return {
    segments,
    duration: Math.max(knownDuration, segments.at(-1)?.end ?? 0),
    unsupportedNames: [...unsupported],
    beats: beats.flatMap((beat) => Number.isFinite(Number(beat.start)) ? [Number(beat.start) / 1000] : []),
  };
}

export function parseSongleChord(name: string): ChordTarget | null {
  const normalized = name.trim();
  if (!normalized || normalized === 'N') return null;
  const match = /^([A-G](?:#|b)?)([^/]*)?(?:\/([A-G](?:#|b)?))?$/.exec(normalized);
  if (!match) return null;
  const suffixes: Record<string, string> = {
    '': '',
    m: 'm',
    dim: 'dim',
    aug: 'aug',
    sus2: 'sus2',
    sus4: 'sus4',
    '6': '6',
    m6: 'm6',
    '7': '7',
    M7: 'maj7',
    maj7: 'maj7',
    m7: 'm7',
    mM7: 'mMaj7',
    mMaj7: 'mMaj7',
    add9: 'add9',
  };
  const suffix = suffixes[match[2] ?? ''];
  if (suffix === undefined) return null;
  return parseChordSymbol(`${match[1]}${suffix}${match[3] ? `/${match[3]}` : ''}`);
}

function measureAt(milliseconds: number, beats: readonly RawSongleBeat[]): number {
  let measure = 1;
  let sawFirstBeat = false;
  for (const beat of beats) {
    const start = Number(beat.start);
    if (!Number.isFinite(start) || start > milliseconds) break;
    if (beat.position === 1) {
      if (sawFirstBeat) measure += 1;
      else sawFirstBeat = true;
    }
  }
  return measure;
}

function mergeSameMeasureSegments(segments: readonly ChordSegment[]): ChordSegment[] {
  const result: ChordSegment[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous && previous.measure === segment.measure && chordKey(previous.faithful) === chordKey(segment.faithful) && Math.abs(previous.end - segment.start) < 0.02) {
      previous.end = segment.end;
    } else {
      result.push({ ...segment });
    }
  }
  return result;
}

function chordKey(target: ChordTarget | null): string {
  return target ? `${target.root}:${target.quality}:${target.bass ?? ''}` : 'N';
}

function normalizeSongleUrl(value: string | undefined, videoId: string): string {
  if (value?.startsWith('https://songle.jp/')) return value;
  if (value?.startsWith('http://songle.jp/')) return value.replace('http://', 'https://');
  return `https://songle.jp/songs/${encodeURIComponent(`www.youtube.com/watch?v=${videoId}`)}`;
}
