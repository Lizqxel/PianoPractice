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
});
