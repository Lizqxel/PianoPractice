import type { SoundMode } from '../types';

export interface KeyboardAudioOutput {
  noteOn(note: number, velocity: number): Promise<void>;
  noteOff(note: number): void;
}

export interface ExternalMidiNoteOutput {
  sendNoteOn(note: number, velocity: number, channel?: number): void;
  sendNoteOff(note: number, channel?: number): void;
}

export function hasInternalSound(mode: SoundMode): boolean {
  return mode === 'internal' || mode === 'both';
}

export function hasExternalSound(mode: SoundMode): boolean {
  return mode === 'external' || mode === 'both';
}

export function routeKeyboardNoteOn(
  mode: SoundMode,
  audio: KeyboardAudioOutput,
  midi: ExternalMidiNoteOutput,
  note: number,
  velocity: number,
  channel = 1,
  forwardToExternal = true,
): Promise<void> | undefined {
  const internal = hasInternalSound(mode) ? audio.noteOn(note, velocity) : undefined;
  if (forwardToExternal && hasExternalSound(mode)) midi.sendNoteOn(note, velocity, channel);
  return internal;
}

export function routeKeyboardNoteOff(
  mode: SoundMode,
  audio: KeyboardAudioOutput,
  midi: ExternalMidiNoteOutput,
  note: number,
  channel = 1,
  forwardToExternal = true,
): void {
  audio.noteOff(note);
  if (forwardToExternal && hasExternalSound(mode)) midi.sendNoteOff(note, channel);
}
