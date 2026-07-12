export interface TempoAudioClock {
  readonly currentTime: number;
  scheduleClickAt(time: number, accent: boolean, volume: number): void;
  cancelScheduledClicks(): void;
}

export interface TempoSchedulerCallbacks {
  onCountIn: (remaining: number) => void;
  onChord: (index: number, scheduledTime: number) => void;
}

export class TempoScheduler {
  private intervalId: number | null = null;
  private uiTimers = new Set<number>();
  private nextBeatTime = 0;
  private beat = -4;
  private chordIndex = 0;

  constructor(private readonly audio: TempoAudioClock) {}

  start(bpm: number, beatsPerChord: number, volume: number, callbacks: TempoSchedulerCallbacks): void {
    this.stop();
    const secondsPerBeat = 60 / bpm;
    this.nextBeatTime = this.audio.currentTime + 0.08;
    this.beat = -4;
    this.chordIndex = 0;
    const pump = () => {
      while (this.nextBeatTime < this.audio.currentTime + 0.12) {
        const scheduledBeat = this.beat;
        const scheduledTime = this.nextBeatTime;
        const beatInBar = ((scheduledBeat % 4) + 4) % 4;
        this.audio.scheduleClickAt(scheduledTime, beatInBar === 0, volume);
        if (scheduledBeat < 0) this.scheduleUi(scheduledTime, () => callbacks.onCountIn(Math.abs(scheduledBeat)));
        if (scheduledBeat >= 0 && scheduledBeat % beatsPerChord === 0) {
          const index = this.chordIndex;
          this.scheduleUi(scheduledTime, () => callbacks.onChord(index, scheduledTime));
          this.chordIndex += 1;
        }
        this.beat += 1;
        this.nextBeatTime += secondsPerBeat;
      }
    };
    pump();
    this.intervalId = window.setInterval(pump, 25);
  }

  stop(): void {
    if (this.intervalId !== null) window.clearInterval(this.intervalId);
    this.intervalId = null;
    for (const timer of this.uiTimers) window.clearTimeout(timer);
    this.uiTimers.clear();
    this.audio.cancelScheduledClicks();
  }

  private scheduleUi(time: number, callback: () => void): void {
    const delay = Math.max(0, (time - this.audio.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.uiTimers.delete(timer);
      callback();
    }, delay);
    this.uiTimers.add(timer);
  }
}
