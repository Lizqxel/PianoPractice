import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import type { PlaybackController } from '../types';

interface Props {
  videoId: string;
  title?: string;
  onReady?: (rates: readonly number[], duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (elementId: string, options: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export const YouTubePlayer = forwardRef<PlaybackController, Props>(function YouTubePlayer(
  { videoId, title, onReady, onPlayingChange, onError },
  ref,
) {
  const player = useRef<YTPlayer | null>(null);
  const callbacks = useRef({ onReady, onPlayingChange, onError });
  callbacks.current = { onReady, onPlayingChange, onError };
  const elementId = `youtube-player-${useId().replaceAll(':', '')}`;

  useImperativeHandle(ref, () => ({
    play: () => { if (typeof player.current?.playVideo === 'function') player.current.playVideo(); },
    pause: () => { if (typeof player.current?.pauseVideo === 'function') player.current.pauseVideo(); },
    seek: (seconds) => { if (typeof player.current?.seekTo === 'function') player.current.seekTo(Math.max(0, seconds), true); },
    setRate: (rate) => { if (typeof player.current?.setPlaybackRate === 'function') player.current.setPlaybackRate(rate); },
    getCurrentTime: () => typeof player.current?.getCurrentTime === 'function' ? player.current.getCurrentTime() : 0,
    getDuration: () => typeof player.current?.getDuration === 'function' ? player.current.getDuration() : 0,
    getAvailableRates: () => typeof player.current?.getAvailablePlaybackRates === 'function' ? player.current.getAvailablePlaybackRates() : [1],
    isPlaying: () => typeof player.current?.getPlayerState === 'function' && player.current.getPlayerState() === window.YT?.PlayerState.PLAYING,
  }), []);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(elementId, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            const rates = typeof player.current?.getAvailablePlaybackRates === 'function' ? player.current.getAvailablePlaybackRates() : [1];
            const duration = typeof player.current?.getDuration === 'function' ? player.current.getDuration() : 0;
            callbacks.current.onReady?.(rates, duration);
          },
          onStateChange: (event: { data: number }) => callbacks.current.onPlayingChange?.(event.data === YT.PlayerState.PLAYING),
          onPlaybackRateChange: () => callbacks.current.onReady?.(
            typeof player.current?.getAvailablePlaybackRates === 'function' ? player.current.getAvailablePlaybackRates() : [1],
            typeof player.current?.getDuration === 'function' ? player.current.getDuration() : 0,
          ),
          onError: (event: { data: number }) => callbacks.current.onError?.(youtubeErrorMessage(event.data)),
        },
      });
    }).catch(() => {
      apiPromise = null;
      callbacks.current.onError?.('YouTubeプレイヤーを読み込めませんでした。通信状態を確認してください。');
    });
    return () => {
      cancelled = true;
      if (typeof player.current?.destroy === 'function') player.current.destroy();
      player.current = null;
    };
  }, [elementId, videoId]);

  return (
    <div className="youtube-player-shell">
      <div id={elementId} aria-label={title ? `${title}のYouTubeプレイヤー` : 'YouTubeプレイヤー'} />
    </div>
  );
});

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error('YouTube API timeout')), 15000);
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timeout);
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API unavailable'));
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => reject(new Error('YouTube API failed to load'));
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

function youtubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'この動画は外部サイトでの再生が許可されていません。別の動画を選んでください。';
  if (code === 100) return '動画が見つからないか、非公開になっています。';
  return 'YouTube動画を再生できませんでした。URLを確認してください。';
}
