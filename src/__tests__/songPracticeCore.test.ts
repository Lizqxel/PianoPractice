import { Midi } from '@tonejs/midi';
import { describe, expect, it, vi } from 'vitest';
import { analysisTimeForPlayback, analyzeSongChords, findChordSegmentIndex, simplifySongChord } from '../music/songChordAnalysis';
import { parseSongMidi } from '../music/songMidi';
import { buildTimedChordChart, retimeChordSegments } from '../music/timedChordChart';
import { alignUfretChartToSongle, buildUfretVideoPlusChart } from '../music/ufretTiming';
import { createChordSourceSearchLinks } from '../services/chordSources';
import { transcribeAudio, validateTranscriptionFile } from '../services/transcriptionClient';
import { loadUfretChordChart, normalizeUfretSongUrl } from '../services/ufret';
import { parseYouTubeVideoId } from '../services/youtube';
import type { ChordQuality, SongNote, SongTrack } from '../types';

describe('YouTube URL解析', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=12', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%sから動画IDを得る', (input, expected) => expect(parseYouTubeVideoId(input)).toBe(expected));

  it('YouTube以外と不正IDは拒否する', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeVideoId('short')).toBeNull();
  });
});

describe('コード簡略化', () => {
  it.each<[ChordQuality, ChordQuality]>([
    ['major', 'major'], ['minor', 'minor'], ['dim', 'dim'], ['m7b5', 'dim'], ['aug', 'major'], ['sus2', 'sus2'], ['sus4', 'sus4'],
    ['6', 'major'], ['m6', 'minor'], ['7', 'major'], ['maj7', 'major'], ['m7', 'minor'], ['mMaj7', 'minor'], ['add9', 'major'],
  ])('%sを%sへ変換する', (quality, expected) => {
    expect(simplifySongChord({ root: 0, quality, bass: 4 })).toEqual({ root: 0, quality: expected });
  });
});

describe('手入力コード譜', () => {
  it('小節区切りとBPMからコード区間を作る', () => {
    const chart = buildTimedChordChart('C G | Am F | G | C', 120, 4);
    expect(chart.invalidTokens).toEqual([]);
    expect(chart.duration).toBe(8);
    expect(chart.segments.map((segment) => [segment.start, segment.end, segment.measure, segment.faithful?.root, segment.faithful?.quality])).toEqual([
      [0, 1, 1, 0, 'major'],
      [1, 2, 1, 7, 'major'],
      [2, 3, 2, 9, 'minor'],
      [3, 4, 2, 5, 'major'],
      [4, 6, 3, 7, 'major'],
      [6, 8, 4, 0, 'major'],
    ]);
  });

  it('時刻付きコードをそのまま同期区間にする', () => {
    const chart = buildTimedChordChart('[0:12.5] G#m\n[0:16.8] C#m\n[0:20] N.C.', 100, 4);
    expect(chart.mode).toBe('timestamps');
    expect(chart.segments[0]?.faithful).toBeNull();
    expect(chart.segments[0]?.end).toBe(12.5);
    expect(chart.segments[1]?.start).toBe(12.5);
    expect(chart.segments[1]?.end).toBe(16.8);
    expect(chart.segments[3]?.faithful).toBeNull();
  });

  it('未対応コードをエラー候補として返す', () => {
    expect(buildTimedChordChart('C | H7 | G', 100).invalidTokens).toEqual(['H7']);
  });

  it('動画を見ながら打った時刻で全コードを並べ直す', () => {
    const source = buildTimedChordChart('C | G | Am | F', 120, 4).segments;
    const synced = retimeChordSegments(source, [3.2, 5.8, 9.1, 12.4], 18);
    expect(synced.map((segment) => [segment.start, segment.end])).toEqual([
      [3.2, 5.8],
      [5.8, 9.1],
      [9.1, 12.4],
      [12.4, 18],
    ]);
    expect(synced.map((segment) => segment.faithful)).toEqual(source.map((segment) => segment.faithful));
  });

  it('タップ同期は時刻の逆行と不足を拒否する', () => {
    const source = buildTimedChordChart('C | G', 120, 4).segments;
    expect(() => retimeChordSegments(source, [2])).toThrow('すべてのコード');
    expect(() => retimeChordSegments(source, [2, 1])).toThrow('前から順番');
  });
});

describe('外部コード譜検索', () => {
  it('譜面を複製せず、各サービスの検索リンクを作る', () => {
    const links = createChordSourceSearchLinks('鈴々 PEOPLE 1');
    expect(links.map((link) => link.label)).toEqual(['U-FRET', 'ChordWiki', '楽器.me', 'J-Total Music', 'UTABON']);
    expect(links[0]?.url).toContain('https://www.ufret.jp/search.php?key=');
  });

  it('U-FRET曲URLからコード記号を直接取り込む', async () => {
    const imported = await loadUfretChordChart('https://ufret.jp/song.php?data=69641#content');
    const chart = buildUfretVideoPlusChart(imported, 'OZpv_AcPCKg');
    expect(imported).toMatchObject({ title: '常夜燈', artist: 'PEOPLE1', chordCount: 202, bpm: 99 });
    expect(chart?.invalidTokens).toEqual([]);
    expect(chart?.segments).toHaveLength(202);
    expect(chart?.segments[0]?.start).toBeCloseTo(2.675, 3);
    expect(chart?.segments[1]?.start).toBeCloseTo(4.493, 3);
    expect(chart?.segments[2]?.start).toBeCloseTo(5.099, 3);
    expect(chart?.segments.at(-1)?.start).toBeCloseTo(262.675, 3);
    expect(chart?.segments.some((segment) => segment.faithful?.quality === 'm7b5')).toBe(true);
  });

  it('動画プラス未対応時はSongle実時間へU-FRETコード列を自動整列する', () => {
    const imported = {
      title: 'Test', artist: 'Artist', url: 'https://www.ufret.jp/song.php?data=1', version: '通常ver',
      chartText: 'C | G | Am | F', bpm: 100, chordCount: 4,
    };
    const reference = {
      segments: [
        segment(3, 6, 0, 'major'), segment(6, 9, 7, '7'),
        segment(9, 12, 9, 'm7'), segment(12, 16, 5, 'major'),
      ],
      duration: 18,
      unsupportedNames: [],
      beats: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    };
    const chart = alignUfretChartToSongle(imported, reference);
    expect(chart.timingSource).toBe('songle-alignment');
    expect(chart.anchorCount).toBe(4);
    expect(chart.segments.map((item) => item.start)).toEqual([3, 6, 9, 12]);
    expect(chart.segments.at(-1)?.end).toBe(18);
  });

  it('U-FRET以外のURLは取り込まない', () => {
    expect(() => normalizeUfretSongUrl('https://example.com/song.php?data=69641')).toThrow('U-FRET');
  });
});

describe('MIDI正規化とコード解析', () => {
  it('テンポ・複数トラックを秒へ正規化し、ドラムとボーカルを既定で除外する', () => {
    const midi = new Midi();
    midi.name = 'Practice Song';
    midi.header.setTempo(120);
    const piano = midi.addTrack();
    piano.name = 'Piano';
    piano.addNote({ midi: 60, ticks: 0, durationTicks: 960, velocity: 0.8 });
    const drums = midi.addTrack();
    drums.name = 'Drum Kit';
    drums.channel = 9;
    drums.addNote({ midi: 36, ticks: 0, durationTicks: 120, velocity: 1 });
    const voice = midi.addTrack();
    voice.name = 'Lead Vocal';
    voice.addNote({ midi: 67, ticks: 0, durationTicks: 480, velocity: 0.7 });

    const parsed = parseSongMidi(new Uint8Array(midi.toArray()));
    expect(parsed.name).toBe('Practice Song');
    expect(parsed.hasExplicitTempo).toBe(true);
    expect(parsed.tracks).toHaveLength(3);
    expect(parsed.duration).toBeCloseTo(1, 3);
    expect(parsed.tracks.map((track) => [track.name, track.isDrum, track.isVoice, track.enabled])).toEqual([
      ['Piano', false, false, true],
      ['Drum Kit', true, false, false],
      ['Lead Vocal', false, true, false],
    ]);
  });

  it('短い誤検出を前後のコードへ統合し、無音をN.C.にする', () => {
    const notes = [
      ...chordNotes([48, 60, 64, 67], 0, 2),
      ...chordNotes([53, 57, 60], 2, 2.5),
      ...chordNotes([48, 60, 64, 67], 2.5, 4),
      ...chordNotes([43, 55, 59, 62, 65], 5, 7),
    ];
    const segments = analyzeSongChords([track(notes)], 7);
    expect(segments[0]?.faithful).toMatchObject({ root: 0, quality: 'major' });
    expect(segments.some((segment) => segment.start <= 4.5 && segment.end >= 4.5 && segment.faithful === null)).toBe(true);
    expect(segments.some((segment) => segment.faithful?.root === 7 && segment.faithful.quality === '7')).toBe(true);
    expect(segments.filter((segment) => segment.start < 4 && segment.faithful?.root !== 0)).toHaveLength(0);
  });

  it('安定したコード構成音の最低音を分数ベースにする', () => {
    const segments = analyzeSongChords([track(chordNotes([40, 60, 64, 67], 0, 2))], 2);
    expect(segments[0]?.faithful).toMatchObject({ root: 0, quality: 'major', bass: 4 });
    expect(segments[0]?.simple).toEqual({ root: 0, quality: 'major' });
  });

  it('空トラックはコードなしになる', () => {
    expect(analyzeSongChords([], 10)).toEqual([]);
    expect(analyzeSongChords([{ ...track([]), enabled: false }], 10)).toEqual([]);
  });

  it('曖昧な2音だけの区間はN.C.にする', () => {
    const segments = analyzeSongChords([track(chordNotes([48, 55], 0, 2))], 2);
    expect(segments.every((segment) => segment.faithful === null)).toBe(true);
  });

  it('停止・シーク・速度に依存せず原曲時刻と同期補正から区間を決める', () => {
    const segments = [
      { start: 0, end: 2, faithful: { root: 0 as const, quality: 'major' as const }, simple: { root: 0 as const, quality: 'major' as const }, confidence: 1 },
      { start: 2, end: 4, faithful: { root: 7 as const, quality: '7' as const }, simple: { root: 7 as const, quality: 'major' as const }, confidence: 1 },
    ];
    expect(findChordSegmentIndex(segments, analysisTimeForPlayback(2.4, 0.5))).toBe(0);
    expect(findChordSegmentIndex(segments, analysisTimeForPlayback(2.6, 0.5))).toBe(1);
    expect(findChordSegmentIndex(segments, analysisTimeForPlayback(2.6, -0.5))).toBe(1);
    expect(findChordSegmentIndex([{ ...segments[0]!, start: 2, end: 4 }], 1.9)).toBe(-1);
  });
});

describe('MuScriptor SSEクライアント', () => {
  it('進捗とノートイベントを渡し、最終MIDIを復元する', async () => {
    const sse = [
      'data: {"type":"progress","completed":0,"total":2}\n\n',
      'data: {"type":"start","pitch":60,"start_time":0,"index":1,"instrument":"acoustic_piano"}\n\n',
      'data: {"type":"end","end_time":1,"start_event_index":1}\n\n',
      'data: {"type":"midi","data":"TVRoZA=="}\n\n',
    ].join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const events: string[] = [];
    const bytes = await transcribeAudio(new File(['audio'], 'song.mp3'), (event) => events.push(event.type));
    expect(events).toEqual(['progress', 'start', 'end', 'midi']);
    expect(new TextDecoder().decode(bytes)).toBe('MThd');
  });

  it('形式・空ファイル・過大ファイルを変換前に拒否する', () => {
    expect(validateTranscriptionFile(new File(['x'], 'song.txt'))).toContain('WAV');
    expect(validateTranscriptionFile(new File([], 'song.wav'))).toContain('空');
    expect(validateTranscriptionFile({ name: 'song.mp3', size: 251 * 1024 * 1024 } as File)).toContain('250MB');
  });
});

function track(notes: SongNote[]): SongTrack {
  return { id: 'track-0', name: 'Piano', instrument: 'acoustic piano', isDrum: false, isVoice: false, enabled: true, notes };
}

function chordNotes(pitches: number[], start: number, end: number): SongNote[] {
  return pitches.map((pitch, index) => ({
    id: `note-${start}-${pitch}-${index}`,
    pitch,
    start,
    end,
    velocity: 0.8,
    trackId: 'track-0',
    instrument: 'acoustic piano',
  }));
}

function segment(start: number, end: number, root: number, quality: ChordQuality) {
  return {
    start,
    end,
    faithful: { root: root as 0, quality },
    simple: { root: root as 0, quality: quality === '7' ? 'major' as const : quality === 'm7' ? 'minor' as const : quality },
    confidence: 1,
  };
}
