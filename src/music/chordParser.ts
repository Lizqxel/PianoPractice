import { parseRoot } from './chordDefinitions';
import type { ChordQuality, ChordTarget } from '../types';

export function parseChordSymbol(symbol: string): ChordTarget | null {
  const cleaned = symbol.trim().replaceAll('♭', 'b').replaceAll('♯', '#');
  const match = /^([A-G](?:#|b)?)(mMaj7|mM7|m7-5|m7b5|maj7|M7|m7|sus2|sus4|add9|dim|aug|m6|m|6|7)?(?:\/([A-G](?:#|b)?))?$/.exec(cleaned);
  if (!match) return null;
  const rootName = match[1]!;
  const suffix = match[2] ?? '';
  const quality: ChordQuality = suffix === ''
    ? 'major'
    : suffix === 'm'
      ? 'minor'
      : suffix === 'M7'
        ? 'maj7'
        : suffix === 'm7-5'
          ? 'm7b5'
        : suffix === 'mM7'
          ? 'mMaj7'
          : suffix as ChordQuality;
  const target: ChordTarget = { root: parseRoot(rootName), quality, spelling: rootName.includes('b') ? 'flat' : 'sharp' };
  if (match[3]) target.bass = parseRoot(match[3]);
  return target;
}

export function parseChordChart(text: string): ChordTarget[] {
  return text.split(/[|,\s]+/).map(parseChordSymbol).filter((target): target is ChordTarget => target !== null);
}
