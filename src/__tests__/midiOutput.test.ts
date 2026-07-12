import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiService } from '../services/midiService';

interface MidiFixture {
  service: MidiService;
  input: MIDIInput;
  output: MIDIOutput;
  send: ReturnType<typeof vi.fn>;
}

async function fixture(): Promise<MidiFixture> {
  const send = vi.fn();
  const input = { id: 'keyboard-in', name: 'USB Keyboard', state: 'connected', onmidimessage: null } as unknown as MIDIInput;
  const output = { id: 'daw-out', name: 'Chord Sprint Out', state: 'connected', send } as unknown as MIDIOutput;
  const access = {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null,
  } as unknown as MIDIAccess;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn(async () => access) });
  const service = new MidiService();
  await service.connect();
  return { service, input, output, send };
}

function receive(input: MIDIInput, data: number[], timeStamp = 120): void {
  input.onmidimessage?.({ data: new Uint8Array(data), timeStamp } as MIDIMessageEvent);
}

beforeEach(() => vi.restoreAllMocks());

describe('MIDI output routing', () => {
  it('lists and selects an output independently from the input', async () => {
    const { service, output } = await fixture();
    expect(service.outputs()).toEqual([output]);
    service.selectOutput(output.id);
    expect(service.selectedOutputId).toBe(output.id);
    expect(service.selectedOutputName).toBe('Chord Sprint Out');
  });

  it('forwards Note On/Off while preserving velocity and channel', async () => {
    const { service, input, output, send } = await fixture();
    service.selectInput(input.id); service.selectOutput(output.id);
    service.onRawMessage((event) => service.sendRaw(event.data, event.timestamp));
    receive(input, [0x94, 60, 87], 140);
    receive(input, [0x84, 60, 41], 150);
    expect(send).toHaveBeenNthCalledWith(1, [0x94, 60, 87], 140);
    expect(send).toHaveBeenNthCalledWith(2, [0x84, 60, 41], 150);
  });

  it('forwards sustain CC64 and other raw controller messages', async () => {
    const { service, input, output, send } = await fixture();
    service.selectInput(input.id); service.selectOutput(output.id);
    service.onRawMessage((event) => service.sendRaw(event.data, event.timestamp));
    receive(input, [0xb2, 64, 127], 200);
    expect(send).toHaveBeenCalledWith([0xb2, 64, 127], 200);
  });

  it('sends All Notes Off to all 16 channels', async () => {
    const { service, output, send } = await fixture();
    service.selectOutput(output.id);
    service.allNotesOff();
    expect(send).toHaveBeenCalledTimes(16);
    expect(send).toHaveBeenNthCalledWith(1, [0xb0, 123, 0]);
    expect(send).toHaveBeenNthCalledWith(16, [0xbf, 123, 0]);
  });
});
