import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioRoutingPanel } from '../components/AudioRoutingPanel';
import { midiLoopWarning } from '../services/midiRouting';
import { routeKeyboardNoteOff, routeKeyboardNoteOn } from '../services/soundRouter';

afterEach(cleanup);

describe('sound routing', () => {
  it('routes a virtual key to the DAW without playing the internal instrument', () => {
    const audio = { noteOn: vi.fn(async () => undefined), noteOff: vi.fn() };
    const midi = { sendNoteOn: vi.fn(), sendNoteOff: vi.fn() };
    routeKeyboardNoteOn('external', audio, midi, 60, 100);
    routeKeyboardNoteOff('external', audio, midi, 60);
    expect(audio.noteOn).not.toHaveBeenCalled();
    expect(midi.sendNoteOn).toHaveBeenCalledWith(60, 100, 1);
    expect(midi.sendNoteOff).toHaveBeenCalledWith(60, 1);
  });

  it('warns about identical or circular MIDI ports', () => {
    expect(midiLoopWarning({ id: 'same', name: 'Chord Sprint Out' }, { id: 'same', name: 'Chord Sprint Out' })).toBeTruthy();
    const warning = midiLoopWarning({ id: 'in', name: 'Chord Sprint Out' }, { id: 'out', name: 'DAW Loop' });
    expect(warning).toContain('Chord Sprint');
  });

  it('shows the output selector, status, test button, warning and Studio One guide', () => {
    const onTest = vi.fn();
    render(<AudioRoutingPanel mode="external" onModeChange={vi.fn()} outputs={[{ id: 'out', name: 'Chord Sprint Out' }]} selectedOutputId="out" onOutputChange={vi.fn()} outputConnected internalVolume={35} onInternalVolumeChange={vi.fn()} metronomeVolume={55} onMetronomeVolumeChange={vi.fn()} metronomeEnabled onMetronomeEnabledChange={vi.fn()} onTestOutput={onTest} warning="MIDIループの可能性があります" />);
    expect(screen.getByRole('combobox', { name: 'MIDI出力機器' })).toHaveValue('out');
    expect(screen.getByRole('alert')).toHaveTextContent('MIDIループ');
    expect(screen.getByText('Studio One 6 接続方法')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'C4でMIDI出力をテスト' }));
    expect(onTest).toHaveBeenCalledOnce();
  });
});
