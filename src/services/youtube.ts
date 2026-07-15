export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return validId(url.pathname.split('/').filter(Boolean)[0]);
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null;
    if (url.pathname === '/watch') return validId(url.searchParams.get('v'));
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return validId(parts[1]);
  } catch {
    return null;
  }
  return null;
}

function validId(value: string | null | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}
