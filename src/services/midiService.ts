import type { MidiNoteEvent } from '../types';

export class MidiService {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private listener: ((event: MidiNoteEvent) => void) | null = null;
  private stateListener: (() => void) | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async connect(): Promise<MIDIInput[]> {
    if (!this.supported) {
      throw new Error('このブラウザはWeb MIDI APIに対応していません。ChromeまたはEdgeを使用してください。');
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.stateListener?.();
      return this.inputs();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        throw new Error('MIDIへのアクセスが拒否されました。ブラウザのサイト設定でMIDI権限を許可してください。');
      }
      throw new Error('MIDI機器へ接続できませんでした。機器を接続し、ページを再読み込みしてください。');
    }
  }

  inputs(): MIDIInput[] {
    return this.access ? Array.from(this.access.inputs.values()) : [];
  }

  selectInput(id: string): void {
    const next = this.access?.inputs.get(id);
    if (!next) throw new Error('選択したMIDI入力が見つかりません。再接続してください。');
    if (this.input) this.input.onmidimessage = null;
    this.input = next;
    this.input.onmidimessage = (message) => this.handleMessage(message);
  }

  onNote(listener: (event: MidiNoteEvent) => void): void {
    this.listener = listener;
  }

  onStateChange(listener: () => void): void {
    this.stateListener = listener;
  }

  disconnect(): void {
    if (this.input) this.input.onmidimessage = null;
    if (this.access) this.access.onstatechange = null;
    this.input = null;
    this.access = null;
  }

  private handleMessage(message: MIDIMessageEvent): void {
    if (!message.data) return;
    const [status = 0, note = 0, velocity = 0] = Array.from(message.data);
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (command !== 0x80 && command !== 0x90) return;
    const isNoteOff = command === 0x80 || velocity === 0;
    this.listener?.({
      type: isNoteOff ? 'noteoff' : 'noteon',
      note,
      velocity,
      channel,
      timestamp: message.timeStamp,
    });
  }
}
