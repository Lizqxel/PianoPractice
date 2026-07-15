import { Midi } from '@tonejs/midi';
import type { SongTrack } from '../types';

export interface ParsedSongMidi {
  name: string;
  duration: number;
  hasExplicitTempo: boolean;
  tracks: SongTrack[];
}

const VOICE_PATTERN = /voice|vocal|choir|singer|歌|ボーカル|合唱/i;
const DRUM_PATTERN = /drum|percussion|kit|cymbal|snare|kick|ドラム|打楽器/i;

export function parseSongMidi(data: ArrayBuffer | Uint8Array): ParsedSongMidi {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const tracks = midi.tracks
    .map((track, trackIndex): SongTrack | null => {
      if (track.notes.length === 0) return null;
      const id = `track-${trackIndex}`;
      const instrument = track.instrument.name || track.instrument.family || 'instrument';
      const name = track.name.trim() || instrument || `Track ${trackIndex + 1}`;
      const isDrum = track.instrument.percussion || track.channel === 9 || DRUM_PATTERN.test(`${name} ${instrument}`);
      const isVoice = VOICE_PATTERN.test(`${name} ${instrument}`);
      return {
        id,
        name,
        instrument,
        isDrum,
        isVoice,
        enabled: !isDrum && !isVoice,
        notes: track.notes.map((note, noteIndex) => ({
          id: `${id}-note-${noteIndex}`,
          pitch: note.midi,
          start: Math.max(0, note.time),
          end: Math.max(note.time + 0.03, note.time + note.duration),
          velocity: note.velocity || 0.75,
          trackId: id,
          instrument,
        })),
      };
    })
    .filter((track): track is SongTrack => track !== null);

  if (tracks.length > 0 && tracks.every((track) => !track.enabled)) {
    for (const track of tracks) {
      if (!track.isDrum) track.enabled = true;
    }
  }

  return {
    name: midi.name || '読み込んだ曲',
    duration: midi.duration,
    hasExplicitTempo: midi.header.tempos.length > 0,
    tracks,
  };
}

export function setSongTrackEnabled(tracks: readonly SongTrack[], trackId: string, enabled: boolean): SongTrack[] {
  return tracks.map((track) => track.id === trackId ? { ...track, enabled } : track);
}
