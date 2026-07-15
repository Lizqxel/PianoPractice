export interface ChordSourceSearchLink {
  id: 'ufret' | 'chordwiki' | 'gakkime' | 'jtotal' | 'utabon';
  label: string;
  description: string;
  url: string;
}

export function createChordSourceSearchLinks(query: string): ChordSourceSearchLink[] {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const encoded = encodeURIComponent(cleaned);
  return [
    {
      id: 'ufret',
      label: 'U-FRET',
      description: 'ピアノ表示・初心者コード・動画プラス',
      url: `https://www.ufret.jp/search.php?key=${encoded}`,
    },
    siteSearch('chordwiki', 'ChordWiki', 'ChordPro形式の投稿コード譜', 'ja.chordwiki.org', cleaned),
    siteSearch('gakkime', '楽器.me', 'ピアノ／ギターコードと関連動画', 'gakufu.gakki.me', cleaned),
    siteSearch('jtotal', 'J-Total Music', '国内曲のコード譜検索', 'music.j-total.net', cleaned),
    siteSearch('utabon', 'UTABON', 'ギター・ピアノ・ウクレレコード', 'utabon.jp', cleaned),
  ];
}

function siteSearch(
  id: Exclude<ChordSourceSearchLink['id'], 'ufret'>,
  label: string,
  description: string,
  domain: string,
  query: string,
): ChordSourceSearchLink {
  const search = encodeURIComponent(`site:${domain} ${query}`);
  return { id, label, description, url: `https://www.google.com/search?q=${search}` };
}
