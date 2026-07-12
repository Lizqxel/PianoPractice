import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { CurrentChord } from '../components/CurrentChord';
import { getCurriculumDay } from '../music/curriculum';
import { GuidedChordLearningMode } from '../modes/GuidedChordLearningMode';
import { InversionLessonMode } from '../modes/InversionLessonMode';
import { LessonSessionRouter } from '../modes/LessonSessionRouter';
import type { AudioEngine } from '../services/audioEngine';
import { applyDailySessionResult, loadCurriculum, saveDailySessionResult } from '../services/storage';
import type { CurriculumDayDefinition, KeyboardGuideState } from '../types';

const emptyGuide = (): KeyboardGuideState => ({ guideNotes: [], leftGuideNotes: [], correctActiveNotes: [], extraActiveNotes: [], fingering: {}, spelling: 'flat' });
const fakeAudio = {
  get currentTime() { return Date.now() / 1000; },
  resume: vi.fn(async () => undefined),
  scheduleClickAt: vi.fn(),
  cancelScheduledClicks: vi.fn(),
} as unknown as AudioEngine;

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('カリキュラムルーティング', () => {
  it.each([
    [1, 'guidedChordLearning'], [2, 'guidedChordLearning'], [3, 'guidedChordLearning'], [4, 'inversion'],
    [5, 'bassChord'], [6, 'progression'], [7, 'sprint'], [8, 'guidedChordLearning'], [9, 'slashChord'],
    [10, 'progression'], [11, 'song'], [12, 'sightReading'], [13, 'sprint'], [14, 'mixedTest'],
  ])('Day %iを%s画面へ接続する', (day, lessonType) => {
    render(<LessonSessionRouter day={day as number} notes={[]} splitNote={60} audio={fakeAudio} bpm={80} onBpmChange={vi.fn()} metronomeVolume={55} onMetronomeVolumeChange={vi.fn()} onGuideChange={vi.fn()} onComplete={vi.fn()} onSessionStart={vi.fn()} />);
    expect(screen.getByTestId(`lesson-${lessonType}`)).toBeInTheDocument();
  });
});

describe('仮想鍵盤の独立状態', () => {
  const baseProps = { onNoteOn: vi.fn(), onNoteOff: vi.fn() };
  it('ガイド、正解、余分を別状態で表示する', () => {
    const { rerender } = render(<PianoKeyboard {...baseProps} activeNotes={new Set()} guideNotes={new Set([60])} />);
    expect(screen.getByRole('button', { name: 'C4 MIDI 60' })).toHaveAttribute('data-key-state', 'is-guide');
    rerender(<PianoKeyboard {...baseProps} activeNotes={new Set([60])} guideNotes={new Set([60])} correctActiveNotes={new Set([60])} />);
    expect(screen.getByRole('button', { name: 'C4 MIDI 60' })).toHaveAttribute('data-key-state', 'is-correct');
    rerender(<PianoKeyboard {...baseProps} activeNotes={new Set([61])} guideNotes={new Set([60])} extraActiveNotes={new Set([61])} />);
    expect(screen.getByRole('button', { name: 'C4 MIDI 60' })).toHaveAttribute('data-key-state', 'is-guide');
    expect(screen.getByRole('button', { name: 'C#4 MIDI 61' })).toHaveAttribute('data-key-state', 'is-extra');
  });
});

describe('ガイド学習', () => {
  it('Day 1画面には指定された6コードだけを表示する', () => {
    const { container } = render(<GuidedChordLearningMode definition={getCurriculumDay(1)} notes={[]} splitNote={60} onGuideChange={vi.fn()} onComplete={vi.fn()} />);
    const names = [...container.querySelectorAll('.chord-roster span')].map((element) => element.textContent);
    expect(names).toEqual(['C', 'F', 'G', 'Am', 'Dm', 'Em']);
  });

  it('対象コードをガイドなしで2回正解すると合格する', async () => {
    const definition: CurriculumDayDefinition = { ...getCurriculumDay(1), targets: [{ root: 0, quality: 'major' }], questionCount: 5 };
    const onComplete = vi.fn();
    const stableGuide = vi.fn();
    const renderMode = (notes: number[]) => <GuidedChordLearningMode definition={definition} notes={notes} splitNote={60} onGuideChange={stableGuide} onComplete={onComplete} />;
    const { rerender } = render(renderMode([]));
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await act(async () => { rerender(renderMode([60, 64, 67])); });
      await waitFor(() => expect(screen.getByText('正解！ 音を離して次へ')).toBeInTheDocument());
      await act(async () => { rerender(renderMode([])); });
    }
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ passed: true })));
  });

  it('Day 9のD/F#は左手をF#と表示する', () => {
    const definition: CurriculumDayDefinition = { ...getCurriculumDay(9), targets: [{ root: 2, quality: 'major', bass: 6, spelling: 'sharp' }] };
    render(<GuidedChordLearningMode definition={definition} notes={[]} splitNote={60} onGuideChange={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText('左手：F#')).toBeInTheDocument();
  });
});

describe('転回形と音名表記', () => {
  it('Day 4で指定外の転回形は不正解になる', () => {
    render(<InversionLessonMode definition={getCurriculumDay(4)} notes={[64, 67, 72]} onGuideChange={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText('現在は第1転回形。指定された最低音を確認してください')).toBeInTheDocument();
    expect(screen.queryByText('正解！ 音を離して次へ')).not.toBeInTheDocument();
  });

  it('CurrentChordでD/F#の左手をF#と表示する', () => {
    render(<CurrentChord notes={[54, 62, 66, 69]} splitNote={60} onSplitNoteChange={vi.fn()} />);
    expect(screen.getByText('右手：基本形、左手：F#')).toBeInTheDocument();
  });
});

describe('保存と進行セッション', () => {
  it('不合格時は未完了、合格時は完了になる', () => {
    const failed = applyDailySessionResult([], { day: 6, minutes: 2, accuracy: 50, averageMs: 4000, passed: false });
    expect(failed[0]?.completed).toBe(false);
    const passed = applyDailySessionResult(failed, { day: 6, minutes: 3, accuracy: 90, averageMs: 800, passed: true });
    expect(passed[0]?.completed).toBe(true);
  });

  it('Day 6完走結果をカリキュラム保存形式へ記録する', () => {
    saveDailySessionResult({ day: 6, minutes: 4, accuracy: 88, averageMs: 700, passed: true });
    expect(loadCurriculum()).toContainEqual(expect.objectContaining({ day: 6, completed: true, accuracy: 88 }));
  });

  it('進行開始時にサイドバーのメトロノーム停止コールバックを呼ぶ', async () => {
    const onSessionStart = vi.fn();
    render(<LessonSessionRouter day={6} notes={[]} splitNote={60} audio={fakeAudio} bpm={80} onBpmChange={vi.fn()} metronomeVolume={55} onMetronomeVolumeChange={vi.fn()} onGuideChange={vi.fn()} onComplete={vi.fn()} onSessionStart={onSessionStart} />);
    fireEvent.click(screen.getByRole('button', { name: '4カウントで開始' }));
    await waitFor(() => expect(onSessionStart).toHaveBeenCalledTimes(1));
  });
});
