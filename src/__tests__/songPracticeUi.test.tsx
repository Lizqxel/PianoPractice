import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { SongPracticeMode } from '../modes/SongPracticeMode';
import type { PlaybackController } from '../types';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).YT;
});

describe('YouTubeプレイヤー', () => {
  it('IFrame APIのメソッドがまだ未準備でも同期ポーリングで例外にしない', async () => {
    const notReadyPlayer = { destroy: vi.fn() };
    const Player = vi.fn().mockImplementation(() => notReadyPlayer);
    (window as unknown as Record<string, unknown>).YT = { Player, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } };
    const ref = createRef<PlaybackController>();
    render(<YouTubePlayer ref={ref} videoId="dQw4w9WgXcQ" />);
    await waitFor(() => expect(Player).toHaveBeenCalled());
    expect(ref.current?.getCurrentTime()).toBe(0);
    expect(ref.current?.getDuration()).toBe(0);
    expect(ref.current?.getAvailableRates()).toEqual([1]);
    expect(() => { ref.current?.play(); ref.current?.pause(); ref.current?.seek(2); }).not.toThrow();
  });
});

describe('曲で弾くセットアップ', () => {
  it('公開版ではMIDI読込とYouTube URLを残し、ローカル機能を明示する', async () => {
    render(<SongPracticeMode notes={[]} splitNote={60} onGuideChange={vi.fn()} onAllNotesOff={vi.fn()} />);
    expect(screen.getByText('好きな曲を、コード練習に。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'YouTube' }));
    fireEvent.click(screen.getByRole('button', { name: 'MIDI' }));
    expect(screen.getByLabelText('YouTube URL')).toBeInTheDocument();
    expect(screen.getByLabelText('解析用のMIDIファイル')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/公開版：MIDI読込のみ利用可能/)).toBeInTheDocument());
  });

  it('対応するYouTube URL形式を選択し、不正URLは日本語で知らせる', () => {
    render(<SongPracticeMode notes={[]} splitNote={60} onGuideChange={vi.fn()} onAllNotesOff={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'YouTube' }));
    const input = screen.getByLabelText('YouTube URL');
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: '選択' }));
    expect(screen.getByText('dQw4w9WgXcQ')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'https://example.com/not-youtube' } });
    fireEvent.click(screen.getByRole('button', { name: '選択' }));
    expect(screen.getByRole('alert')).toHaveTextContent('YouTubeのURL');
  });

  it('曲名から外部コード譜を探し、コード記号を入力できる', () => {
    render(<SongPracticeMode notes={[]} splitNote={60} onGuideChange={vi.fn()} onAllNotesOff={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('コード譜サイト検索'), { target: { value: '鈴々 PEOPLE 1' } });
    expect(screen.getByRole('link', { name: /U-FRET/ })).toHaveAttribute('href', expect.stringContaining('search.php?key='));
    fireEvent.change(screen.getByLabelText('曲のコード譜'), { target: { value: 'G#m | C#m | F# | B' } });
    expect(screen.getByLabelText('コード譜プレビュー')).toHaveTextContent('G#m');
    expect(screen.getByLabelText('コード譜プレビュー')).toHaveTextContent('C#m');
  });

  it('タイトル検索の候補を選ぶだけでコードを取得して練習を開始する', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/songs/search.json')) return new Response(JSON.stringify([{
        id: 42,
        title: 'Automatic Song',
        artist: { name: 'Test Artist' },
        permalink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        url: 'https://songle.jp/songs/test',
        duration: 120000,
      }]), { status: 200 });
      if (url.includes('/song/chord.json')) return new Response(JSON.stringify({ chords: [
        { start: 0, duration: 2000, name: 'C' },
        { start: 2000, duration: 2000, name: 'G7' },
      ] }), { status: 200 });
      if (url.includes('/song/beat.json')) return new Response(JSON.stringify({ beats: [
        { start: 0, position: 1 }, { start: 1000, position: 2 }, { start: 2000, position: 3 },
      ] }), { status: 200 });
      return new Response('not found', { status: 404 });
    });

    render(<SongPracticeMode notes={[60, 64, 67]} splitNote={60} onGuideChange={vi.fn()} onAllNotesOff={vi.fn()} midiConnected midiDeviceName="Test MIDI" />);
    fireEvent.change(screen.getByLabelText('タイトルでコード検索'), { target: { value: 'Automatic Song' } });
    expect(screen.getByRole('link', { name: /U-FRETでコード譜を確認/ })).toHaveAttribute('href', expect.stringContaining('search.php?key='));
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    const candidate = await screen.findByRole('button', { name: /Automatic Song.*選んで開始/ });
    fireEvent.click(candidate);
    expect(await screen.findByRole('heading', { name: 'Automatic Song' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /参照元.*Songle/ })).toHaveAttribute('href', 'https://songle.jp/songs/test');
    expect(screen.getByRole('region', { name: '曲のコード譜' })).toHaveTextContent('C');
    expect(screen.getByRole('region', { name: '曲のコード譜' })).toHaveTextContent('G');
    expect(screen.getByLabelText('動画追従コード列')).toHaveTextContent('C');
    expect(screen.getByRole('region', { name: '動画とコード譜の自動同期' })).toHaveTextContent('コード時刻の手入力は不要');
    expect(screen.getByText('MIDI CHECK')).toBeInTheDocument();
    expect(screen.getByText('✓ MIDI MATCH')).toBeInTheDocument();
    expect(screen.getByText('Test MIDI')).toBeInTheDocument();
  });

  it('U-FRET検索結果から手入力なしでコードを転記して開始する', async () => {
    render(<SongPracticeMode notes={[]} splitNote={60} onGuideChange={vi.fn()} onAllNotesOff={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('タイトルでコード検索'), { target: { value: '常夜燈 PEOPLE1' } });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    const importButton = await screen.findByRole('button', { name: /常夜燈.*取り込んで開始/ });
    fireEvent.click(importButton);
    expect(await screen.findByRole('heading', { name: '常夜燈' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /参照元.*U-FRET/ })).toHaveAttribute('href', 'https://www.ufret.jp/song.php?data=71624');
    expect(screen.getByLabelText('動画追従コード列')).toHaveTextContent('Bb');
    expect(screen.getByLabelText('動画追従コード列')).toHaveTextContent('Am7♭5');
  });
});
