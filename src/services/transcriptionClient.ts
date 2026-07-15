import type { LocalServiceStatus, TranscriptionEvent, YouTubeSearchResult } from '../types';

const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a']);

export function validateTranscriptionFile(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!AUDIO_EXTENSIONS.has(extension)) return 'WAV、MP3、FLAC、OGG、M4Aの音声ファイルを選んでください。';
  if (file.size > MAX_AUDIO_BYTES) return '音声ファイルが大きすぎます。250MB以下のファイルを選んでください。';
  if (file.size === 0) return '空の音声ファイルは変換できません。';
  return null;
}

export async function getLocalServiceStatus(): Promise<LocalServiceStatus | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('/api/status', { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const value = await response.json() as LocalServiceStatus;
    return value.status === 'ok' ? value : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await responseMessage(response, 'YouTube検索を利用できません。'));
  const payload = await response.json() as { items?: YouTubeSearchResult[] };
  return payload.items ?? [];
}

export async function transcribeAudio(
  file: File,
  onEvent: (event: TranscriptionEvent) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const validationError = validateTranscriptionFile(file);
  if (validationError) throw new Error(validationError);

  const form = new FormData();
  form.append('file', file, file.name);
  let response: Response;
  try {
    response = await fetch('/api/transcribe', {
      method: 'POST',
      body: form,
      ...(signal ? { signal } : {}),
      headers: { Accept: 'text/event-stream' },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('ローカル変換サービスへ接続できません。ローカル版を起動してから再度お試しください。');
  }
  if (!response.ok) throw new Error(await responseMessage(response, '音声をMIDIへ変換できませんでした。'));
  if (!response.body) throw new Error('変換結果のストリームを読み取れませんでした。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let midiBytes: Uint8Array | null = null;

  const consumeBlock = (block: string) => {
    const data = block.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    const event = JSON.parse(data) as TranscriptionEvent;
    onEvent(event);
    if (event.type === 'midi') midiBytes = decodeBase64(event.data);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  if (!midiBytes) throw new Error('変換は終了しましたがMIDIデータを受け取れませんでした。');
  return midiBytes;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) return localizeServerError(payload.detail);
    }
    const text = await response.text();
    return text && text.length < 300 ? text : fallback;
  } catch {
    return fallback;
  }
}

function localizeServerError(detail: string): string {
  if (detail.includes('could not decode audio file')) return '音声ファイルをデコードできませんでした。ファイルが破損していないか、対応形式かを確認してください。';
  if (detail.includes('server busy')) return '別の変換を終了しています。少し待ってからもう一度お試しください。';
  if (detail.includes('unknown instrument')) return '指定した楽器をMuScriptorが認識できませんでした。楽器の選択を確認してください。';
  return detail;
}
