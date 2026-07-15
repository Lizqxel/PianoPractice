import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSongleChordChart, parseSongleChord, searchSongleSongs } from '../services/songle';
import type { SongleSearchResult } from '../types';

afterEach(() => vi.restoreAllMocks());

describe('Songleコード自動取得', () => {
  it('タイトル検索結果からYouTube候補だけを正規化する', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      {
        id: 42,
        title: 'Automatic Song',
        artist: { name: 'Test Artist' },
        permalink: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
        url: 'https://songle.jp/songs/test',
        duration: 123000,
      },
      { id: 43, title: 'Not YouTube', permalink: 'https://example.com/song.mp3' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));

    const results = await searchSongleSongs('Automatic Song');
    expect(results).toEqual([expect.objectContaining({
      id: 42,
      title: 'Automatic Song',
      artist: 'Test Artist',
      videoId: 'dQw4w9WgXcQ',
      duration: 123,
    })]);
  });

  it('コード時刻と拍位置を練習区間・小節へ変換する', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/chord.json')) return new Response(JSON.stringify({ chords: [
        { start: 0, duration: 2000, name: 'N' },
        { start: 2000, duration: 2000, name: 'C#M7/G#' },
        { start: 4000, duration: 2000, name: 'E6' },
      ] }), { status: 200 });
      return new Response(JSON.stringify({ beats: [
        { start: 0, position: 1 }, { start: 1000, position: 2 },
        { start: 2000, position: 3 }, { start: 3000, position: 4 },
        { start: 4000, position: 1 },
      ] }), { status: 200 });
    });
    const chart = await loadSongleChordChart(song());
    expect(chart.duration).toBe(120);
    expect(chart.segments).toHaveLength(3);
    expect(chart.segments[0]?.faithful).toBeNull();
    expect(chart.segments[1]).toMatchObject({
      start: 2,
      end: 4,
      measure: 1,
      faithful: { root: 1, quality: 'maj7', bass: 8 },
      simple: { root: 1, quality: 'major' },
    });
    expect(chart.segments[2]).toMatchObject({ measure: 2, faithful: { root: 4, quality: '6' } });
  });

  it('Songleで使われる拡張コードを鍵盤用コードへ変換する', () => {
    expect(parseSongleChord('Eaug')).toMatchObject({ root: 4, quality: 'aug' });
    expect(parseSongleChord('Ebsus2/Bb')).toMatchObject({ root: 3, quality: 'sus2', bass: 10, spelling: 'flat' });
    expect(parseSongleChord('AbmM7')).toMatchObject({ root: 8, quality: 'mMaj7' });
    expect(parseSongleChord('C#7/E#')).toMatchObject({ root: 1, quality: '7', bass: 5 });
    expect(parseSongleChord('N')).toBeNull();
    expect(parseSongleChord('C13')).toBeNull();
  });
});

function song(): SongleSearchResult {
  return {
    id: 42,
    title: 'Automatic Song',
    artist: 'Test Artist',
    videoId: 'dQw4w9WgXcQ',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    songleUrl: 'https://songle.jp/songs/test',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    duration: 120,
  };
}
