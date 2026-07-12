import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeChord, analyzeHands } from '../music/chordMatcher';
import { advanceChordChange, initialChordChangeState } from '../music/chordChangeTracker';
import { chordName, chordNameForKey } from '../music/chordDefinitions';
import { getCurriculumDay, targetsForDay } from '../music/curriculum';
import { areTargetsMastered, extractWeakTargets, recordAttempt, targetId } from '../music/performance';
import { sameMidiNotes } from '../music/voicings';
import { TempoScheduler, type TempoAudioClock } from '../services/tempoScheduler';
import type { ChordPerformanceRecord, ChordTarget } from '../types';

describe('14日間学習機能', () => {
  it('Day 1は指定された6コードだけを出題する', () => {
    const names = targetsForDay(1).map(targetId);
    expect(names).toEqual(['0:major:-', '5:major:-', '7:major:-', '9:minor:-', '2:minor:-', '4:minor:-']);
    expect(getCurriculumDay(1).questionCount).toBe(24);
  });

  it('Day 9は分数コードだけを出題する', () => {
    expect(targetsForDay(9).every((target) => target.bass !== undefined)).toBe(true);
  });

  it('Day 3はフラット表記へ固定する', () => {
    expect(targetsForDay(3).filter((target) => target.quality === 'major').map((target) => chordName(target))).toEqual(['Db', 'Eb', 'Gb', 'Ab', 'Bb']);
  });
});

describe('左右手と分数コード', () => {
  it('右手の第1転回形と左手ベースを分けて判定する', () => {
    const result = analyzeHands({ root: 0, quality: 'major', bass: 0 }, [48, 64, 67, 72], 60);
    expect(result.isExact).toBe(true);
    expect(result.rightInversion).toBe('第1転回形');
    expect(result.leftBass).toBe(0);
  });

  it('C/Eの右手コードとベースを個別に判定する', () => {
    const target: ChordTarget = { root: 0, quality: 'major', bass: 4 };
    expect(analyzeHands(target, [52, 60, 64, 67], 60).isExact).toBe(true);
    const wrongBass = analyzeHands(target, [55, 60, 64, 67], 60);
    expect(wrongBass.isExact).toBe(false);
    expect(wrongBass.bassMessage).toBe('正しいベースはE');
    expect(analyzeHands({ root: 2, quality: 'major', bass: 6 }, [55, 62, 66, 69], 60).bassMessage).toBe('正しいベースはF#');
  });
});

describe('滑らかなコードチェンジ', () => {
  it('CからAmへ共通音を残して移動しても1回ずつ数える', () => {
    let state = initialChordChangeState();
    state = advanceChordChange(state, analyzeChord({ root: 0, quality: 'major' }, [60, 64, 67]).isExact);
    expect(state.score).toBe(1);
    state = advanceChordChange(state, analyzeChord({ root: 9, quality: 'minor' }, [60, 64, 67]).isExact);
    expect(state.armed).toBe(true);
    state = advanceChordChange(state, analyzeChord({ root: 9, quality: 'minor' }, [60, 64, 69]).isExact);
    expect(state.score).toBe(2);
    state = advanceChordChange(state, true);
    expect(state.score).toBe(2);
  });
});

describe('コード別成績', () => {
  it('低正解率または遅いコードを苦手として抽出する', () => {
    let records: ChordPerformanceRecord[] = [];
    const c: ChordTarget = { root: 0, quality: 'major' };
    const g: ChordTarget = { root: 7, quality: 'major' };
    records = recordAttempt(records, c, false, 5000);
    records = recordAttempt(records, c, true, 3200);
    records = recordAttempt(records, g, true, 900);
    records = recordAttempt(records, g, true, 1000);
    expect(extractWeakTargets(records)).toEqual([c]);
  });
});

describe('初心者学習の厳密判定', () => {
  it('推奨ボイシングと別オクターブの同じコードを区別する', () => {
    expect(sameMidiNotes([60, 64, 67], [60, 64, 67])).toBe(true);
    expect(sameMidiNotes([72, 76, 79], [60, 64, 67])).toBe(false);
  });

  it('ガイドなし正解が2回あっても直近正解率80%未満なら習得にしない', () => {
    const target: ChordTarget = { root: 0, quality: 'major' };
    const record: ChordPerformanceRecord = {
      id: targetId(target), target, attempts: 10, correct: 2, totalReactionMs: 1800,
      unguidedCorrect: 2, mastered: true, recentResults: [false, false, false, false, false, false, false, false, true, true],
      lastPracticedAt: '2026-07-13T00:00:00.000Z',
    };
    expect(areTargetsMastered([target], [record])).toBe(false);
  });
});

describe('キー別表記', () => {
  it('シャープ系キーとフラット系キーで自然な異名同音を使う', () => {
    expect(chordNameForKey({ root: 6, quality: 'major' }, 2)).toBe('F#');
    expect(chordNameForKey({ root: 3, quality: 'major' }, 10)).toBe('Eb');
  });
});

describe('TempoScheduler cleanup', () => {
  afterEach(() => vi.useRealTimers());

  it('停止時に先読みタイマーと予約クリックを解除する', () => {
    vi.useFakeTimers();
    const clicks: number[] = [];
    let cancellations = 0;
    let transitions = 0;
    const audio: TempoAudioClock = {
      currentTime: 0,
      scheduleClickAt: (time) => clicks.push(time),
      cancelScheduledClicks: () => { cancellations += 1; },
    };
    const scheduler = new TempoScheduler(audio);
    scheduler.start(80, 4, 0.5, { onCountIn: () => { transitions += 1; }, onChord: () => { transitions += 1; } });
    expect(clicks.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(cancellations).toBeGreaterThan(0);
    vi.runAllTimers();
    expect(transitions).toBe(0);
  });
});
