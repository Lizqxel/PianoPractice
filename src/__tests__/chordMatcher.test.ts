import { describe, expect, it } from 'vitest';
import { analyzeChord, detectChord } from '../music/chordMatcher';
import type { ChordTarget } from '../types';

describe('コード判定', () => {
  const cMajor: ChordTarget = { root: 0, quality: 'major' };

  it('基本形のCメジャーを判定する', () => {
    const result = analyzeChord(cMajor, [60, 64, 67]);
    expect(result.isExact).toBe(true);
    expect(result.playedName).toBe('C');
    expect(result.inversion).toBe('基本形');
  });

  it('第1転回形と第2転回形を正解にする', () => {
    expect(analyzeChord(cMajor, [64, 67, 72]).inversion).toBe('第1転回形');
    expect(analyzeChord(cMajor, [55, 60, 64]).inversion).toBe('第2転回形');
    expect(analyzeChord(cMajor, [64, 67, 72]).isExact).toBe(true);
  });

  it('オクターブ重複を無視する', () => {
    expect(analyzeChord(cMajor, [48, 60, 64, 67, 72]).isExact).toBe(true);
  });

  it('不足音と余分な音を返す', () => {
    const result = analyzeChord(cMajor, [60, 62, 64]);
    expect(result.isExact).toBe(false);
    expect(result.missing).toEqual([7]);
    expect(result.extra).toEqual([2]);
  });

  it.each([
    [[60, 63, 66], 'Cdim'],
    [[60, 65, 67], 'Csus4'],
    [[60, 64, 67, 70], 'C7'],
    [[60, 64, 67, 71], 'Cmaj7'],
    [[60, 63, 67, 70], 'Cm7'],
    [[60, 62, 64, 67], 'Cadd9'],
  ] as const)('%s を %s と認識する', (notes, name) => {
    expect(detectChord(notes)?.name).toBe(name);
  });
});
