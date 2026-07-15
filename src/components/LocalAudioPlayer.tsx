import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { PlaybackController } from '../types';

interface Props {
  url: string;
  title: string;
  onReady?: (rates: readonly number[], duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
}

const LOCAL_RATES = [0.5, 0.75, 1, 1.25] as const;

export const LocalAudioPlayer = forwardRef<PlaybackController, Props>(function LocalAudioPlayer(
  { url, title, onReady, onPlayingChange, onError },
  ref,
) {
  const audio = useRef<HTMLAudioElement | null>(null);

  useImperativeHandle(ref, () => ({
    play: () => audio.current?.play(),
    pause: () => audio.current?.pause(),
    seek: (seconds) => { if (audio.current) audio.current.currentTime = Math.max(0, Math.min(seconds, audio.current.duration || seconds)); },
    setRate: (rate) => { if (audio.current) audio.current.playbackRate = rate; },
    getCurrentTime: () => audio.current?.currentTime ?? 0,
    getDuration: () => audio.current?.duration || 0,
    getAvailableRates: () => LOCAL_RATES,
    isPlaying: () => audio.current ? !audio.current.paused : false,
  }), []);

  return (
    <div className="local-audio-shell">
      <div className="local-audio-art" aria-hidden="true"><span>♪</span><i /></div>
      <div><small>LOCAL ORIGINAL AUDIO</small><strong>{title}</strong><span>音声はこのPC内だけで再生されます</span></div>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => onReady?.(LOCAL_RATES, event.currentTarget.duration)}
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
        onEnded={() => onPlayingChange?.(false)}
        onError={() => onError?.('原曲の音声ファイルを再生できませんでした。')}
      />
    </div>
  );
});
