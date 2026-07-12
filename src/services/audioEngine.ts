interface Voice {
  sine: OscillatorNode;
  triangle: OscillatorNode;
  gain: GainNode;
  startedAt: number;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>();
  private scheduledClicks = new Set<OscillatorNode>();
  private volume = 0.35;
  private muted = false;
  readonly maxVoices = 16;

  get currentTime(): number {
    if (this.context?.state === 'running') return this.context.currentTime;
    return (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;
  }

  async resume(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      await Promise.race([
        this.context.resume(),
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250)),
      ]);
    }
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.01);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  async noteOn(note: number, velocity: number): Promise<void> {
    await this.resume();
    if (!this.context || !this.master) return;
    this.noteOff(note);
    if (this.voices.size >= this.maxVoices) {
      const oldest = [...this.voices.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
      if (oldest) this.stopVoice(oldest[0], oldest[1], 0.025);
    }
    const now = this.context.currentTime;
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const gain = this.context.createGain();
    const sine = this.context.createOscillator();
    const triangle = this.context.createOscillator();
    sine.type = 'sine';
    triangle.type = 'triangle';
    sine.frequency.value = frequency;
    triangle.frequency.value = frequency;
    const level = 0.08 + (velocity / 127) * 0.12;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(level * 0.72, now + 0.09);
    sine.connect(gain);
    triangle.connect(gain);
    gain.connect(this.master);
    sine.start(now);
    triangle.start(now);
    this.voices.set(note, { sine, triangle, gain, startedAt: now });
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (voice) this.stopVoice(note, voice, 0.16);
  }

  allNotesOff(): void {
    for (const [note, voice] of this.voices) this.stopVoice(note, voice, 0.03);
  }

  async click(accent = false, volume = 0.5): Promise<void> {
    await this.resume();
    if (!this.context || !this.master) return;
    this.scheduleClickAt(this.context.currentTime, accent, volume);
  }

  scheduleClickAt(time: number, accent = false, volume = 0.5): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const now = Math.max(time, this.context.currentTime);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(Math.max(0.001, volume * 0.22), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.scheduledClicks.add(oscillator);
    oscillator.onended = () => this.scheduledClicks.delete(oscillator);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
  }

  cancelScheduledClicks(): void {
    for (const oscillator of this.scheduledClicks) {
      try { oscillator.stop(); } catch { /* Already stopped by the audio timeline. */ }
    }
    this.scheduledClicks.clear();
  }

  private stopVoice(note: number, voice: Voice, release: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.005, release / 4));
    const stopAt = now + release;
    voice.sine.stop(stopAt);
    voice.triangle.stop(stopAt);
    this.voices.delete(note);
  }
}
