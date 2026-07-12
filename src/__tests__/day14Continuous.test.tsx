import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurriculumDay } from '../music/curriculum';
import { MixedTestMode } from '../modes/MixedTestMode';
import type { AudioEngine } from '../services/audioEngine';

function audioFixture() {
  const scheduleClickAt = vi.fn();
  return {
    audio: {
      get currentTime() { return performance.now() / 1000; },
      resume: vi.fn(async () => undefined),
      scheduleClickAt,
      cancelScheduledClicks: vi.fn(),
    } as unknown as AudioEngine,
    scheduleClickAt,
  };
}

function props(audio: AudioEngine) {
  return { definition: getCurriculumDay(14), notes: [], splitNote: 60, audio, bpm: 80, onBpmChange: vi.fn(), metronomeVolume: 55, onMetronomeVolumeChange: vi.fn(), onGuideChange: vi.fn(), onComplete: vi.fn(), onSessionStart: vi.fn(), onAllNotesOff: vi.fn() };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Day 14 continuous sections', () => {
  it('runs the four-round progression through the TempoScheduler', async () => {
    const { audio, scheduleClickAt } = audioFixture();
    render(<MixedTestMode {...props(audio)} initialStage="progression" />);
    expect(screen.getByTestId('lesson-progression')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-mixedTest')).toHaveAttribute('data-day14-section', 'progression');
    fireEvent.click(screen.getByRole('button', { name: /4カウントで開始/ }));
    await waitFor(() => expect(scheduleClickAt).toHaveBeenCalled());
  });

  it('creates an eight-bar sight chart then starts it with the TempoScheduler', async () => {
    vi.useFakeTimers();
    const { audio, scheduleClickAt } = audioFixture();
    const { container } = render(<MixedTestMode {...props(audio)} initialStage="sight" />);
    expect(screen.getByTestId('lesson-sightReading')).toBeInTheDocument();
    expect(container.querySelectorAll('.chart-preview b')).toHaveLength(8);
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); });
    expect(scheduleClickAt).toHaveBeenCalled();
  });
});
