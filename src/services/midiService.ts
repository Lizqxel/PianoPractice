import type { MidiNoteEvent, MidiRawEvent } from '../types';

export class MidiService {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private listener: ((event: MidiNoteEvent) => void) | null = null;
  private rawListener: ((event: MidiRawEvent) => void) | null = null;
  private stateListener: (() => void) | null = null;

  get supported(): boolean { return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator; }
  get selectedInputId(): string | null { return this.input?.id ?? null; }
  get selectedOutputId(): string | null { return this.output?.id ?? null; }
  get selectedInputName(): string | null { return this.input?.name ?? null; }
  get selectedOutputName(): string | null { return this.output?.name ?? null; }

  async connect(): Promise<MIDIInput[]> {
    if (!this.supported) throw new Error('このブラウザはWeb MIDI APIに対応していません。ChromeまたはEdgeを使用してください。');
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.stateListener?.();
      return this.inputs();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('MIDIへのアクセスが拒否されました。ブラウザのサイト設定でMIDI権限を許可してください。');
      throw new Error('MIDI機器へ接続できませんでした。機器を接続し、ページを再読み込みしてください。');
    }
  }

  inputs(): MIDIInput[] { return this.access ? Array.from(this.access.inputs.values()).filter((port) => port.state !== 'disconnected') : []; }
  outputs(): MIDIOutput[] { return this.access ? Array.from(this.access.outputs.values()).filter((port) => port.state !== 'disconnected') : []; }

  selectInput(id: string): void {
    const next = this.access?.inputs.get(id);
    if (!next) throw new Error('選択したMIDI入力が見つかりません。再接続してください。');
    if (this.input) this.input.onmidimessage = null;
    this.input = next;
    this.input.onmidimessage = (message) => this.handleMessage(message);
  }

  selectOutput(id: string): void {
    const next = this.access?.outputs.get(id);
    if (!next) throw new Error('選択したMIDI出力が見つかりません。再接続してください。');
    if (this.output && this.output.id !== id) this.allNotesOff();
    this.output = next;
  }

  clearOutput(): void { this.allNotesOff(); this.output = null; }
  onNote(listener: (event: MidiNoteEvent) => void): void { this.listener = listener; }
  onRawMessage(listener: (event: MidiRawEvent) => void): void { this.rawListener = listener; }
  onStateChange(listener: () => void): void { this.stateListener = listener; }

  sendRaw(data: readonly number[], timestamp?: number): void {
    if (!this.output) return;
    try { timestamp === undefined ? this.output.send([...data]) : this.output.send([...data], timestamp); } catch { /* Port disconnected between state events. */ }
  }

  sendNoteOn(note: number, velocity = 100, channel = 1): void { this.sendRaw([0x90 | normalizeChannel(channel), note & 0x7f, velocity & 0x7f]); }
  sendNoteOff(note: number, channel = 1): void { this.sendRaw([0x80 | normalizeChannel(channel), note & 0x7f, 0]); }

  allNotesOff(): void {
    if (!this.output) return;
    for (let channel = 0; channel < 16; channel += 1) {
      try { this.output.send([0xb0 | channel, 123, 0]); } catch { break; }
    }
  }

  testOutputNote(durationMs = 280): void {
    this.sendNoteOn(60, 100, 1);
    globalThis.setTimeout(() => this.sendNoteOff(60, 1), durationMs);
  }

  disconnect(): void {
    this.allNotesOff();
    if (this.input) this.input.onmidimessage = null;
    if (this.access) this.access.onstatechange = null;
    this.input = null; this.output = null; this.access = null;
  }

  private handleMessage(message: MIDIMessageEvent): void {
    if (!message.data) return;
    const data = Array.from(message.data);
    this.rawListener?.({ data, timestamp: message.timeStamp });
    const [status = 0, note = 0, velocity = 0] = data;
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (command !== 0x80 && command !== 0x90) return;
    const isNoteOff = command === 0x80 || velocity === 0;
    this.listener?.({ type: isNoteOff ? 'noteoff' : 'noteon', note, velocity, channel, timestamp: message.timeStamp });
  }
}

function normalizeChannel(channel: number): number { return Math.max(0, Math.min(15, Math.round(channel) - 1)); }
