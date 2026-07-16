export interface UfretSearchResult {
  title: string;
  artist: string;
  url: string;
  version: string;
}

export interface UfretChordImport extends UfretSearchResult {
  chartText: string;
  bpm: number;
  chordCount: number;
  youtubeVideoId?: string;
  timing?: UfretTimingMap;
}

export interface UfretTimingMap {
  sourceUrl: string;
  youtubeVideoId: string;
  bpm: number;
  startChord: number;
  chordChange: string;
  tempoChanges: string[];
}

const BUNDLED_CHARTS: readonly UfretChordImport[] = [
  {
    title: '常夜燈',
    artist: 'PEOPLE1',
    url: 'https://www.ufret.jp/song.php?data=69641',
    version: '通常ver',
    bpm: 99,
    chordCount: 202,
    youtubeVideoId: 'OZpv_AcPCKg',
    timing: {
      sourceUrl: 'https://www.ufret.jp/song.php?data=71624',
      youtubeVideoId: 'OZpv_AcPCKg',
      bpm: 99,
      startChord: 2.675,
      chordChange: '0990099990900990990099990900990990099990900999909009999090099909900999099909009900999099999990900090909090000090009090909090909090999099009999090099990900999909009909900999909009909900999909009909900999909009999090099990900999099009990999090099009990999999909000909090900000900090909099009090909990900090909090000090009090909099909000909090900000900090909090000090009090909000009000909090990090909099909900999909009999009099990900',
      tempoChanges: [],
    },
    chartText: 'Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb | Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb | Eb Em7-5 F | D7 Gm Bb | Eb Em7-5 F D7 | Bb D7 F#dim Gm Fm | Eb Bb C7 Dm F F/A | Bb D7 F#dim Gm Fm | Eb Bb Eb Bb | Eb Bb F7 | Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb | Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb | Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb | Eb Em7-5 F | D7 Gm Bb | Eb Em7-5 F D7 | Bb D7 F#dim Gm Fm | Eb Bb C7 Dm F F/A | Bb D7 F#dim Gm Fm | Eb Bb Eb Bb | Eb Bb F7 | Bb D7 F#dim Gm Fm | Eb Bb C7 Dm F F/A | Bb D7 F#dim Gm Bb7 | Eb Bb F7 | Bb D7 F#dim Gm Fm | Eb Bb C7 Dm F F/A | Bb D7 F#dim Gm Fm | Eb Bb F7 Eb/G G#dim F/A | Bb D7 F#dim Gm Fm | Eb Bb C7 Dm F F/A | Bb D7 F#dim Gm Bb7 | Eb Bb Eb Bb | Eb Bb F7 | Bb F Gm | Eb Bb F/C | Bb D7 Gm | Eb Am7-5 Bb',
  },
];

export async function searchUfretSongs(query: string, signal?: AbortSignal): Promise<UfretSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const bundled = BUNDLED_CHARTS.filter((chart) => matchesQuery(chart, normalized));
  try {
    const response = await fetch(`/api/ufret/search?q=${encodeURIComponent(normalized)}`, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return bundled;
    const payload = await response.json() as { items?: UfretSearchResult[] };
    return deduplicate([...bundled, ...(payload.items ?? [])]);
  } catch {
    return bundled;
  }
}

export async function loadUfretChordChart(url: string, signal?: AbortSignal): Promise<UfretChordImport> {
  const normalizedUrl = normalizeUfretSongUrl(url);
  const bundled = BUNDLED_CHARTS.find((chart) => chart.url === normalizedUrl);
  if (bundled) return { ...bundled };

  let response: Response;
  try {
    response = await fetch(`/api/ufret/import?url=${encodeURIComponent(normalizedUrl)}`, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new Error('U-FRETコード譜を取得できませんでした。ローカル版を起動して再度お試しください。');
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('このU-FRETコード譜はまだ公開版に収録されていません。ローカル版ではURLから直接取得できます。');
  }
  const value = await response.json() as UfretChordImport;
  if (!value.chartText || !value.title || !value.artist || value.chordCount <= 0) {
    throw new Error('U-FRETページからコード記号を読み取れませんでした。');
  }
  return value;
}

export function normalizeUfretSongUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\./, '');
    const data = url.searchParams.get('data');
    if (url.protocol !== 'https:' || host !== 'ufret.jp' || url.pathname !== '/song.php' || !data || !/^\d+$/.test(data)) throw new Error();
    return `https://www.ufret.jp/song.php?data=${data}`;
  } catch {
    throw new Error('U-FRETの曲ページURL（song.php?data=...）を入力してください。');
  }
}

function matchesQuery(chart: UfretChordImport, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${chart.title} ${chart.artist}`.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

function deduplicate(items: readonly UfretSearchResult[]): UfretSearchResult[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
