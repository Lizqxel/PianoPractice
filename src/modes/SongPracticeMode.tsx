import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalAudioPlayer } from '../components/LocalAudioPlayer';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { analyzeChord, analyzeHands } from '../music/chordMatcher';
import { chordName, chordPitchClasses, keyPrefersFlats, midiNoteName, pitchClassNameForTarget, toPitchClass } from '../music/chordDefinitions';
import { analysisTimeForPlayback, analyzeSongChords, chordForDetail, findChordSegmentIndex } from '../music/songChordAnalysis';
import { parseSongMidi, setSongTrackEnabled } from '../music/songMidi';
import { buildTimedChordChart, chartPreviewLabel } from '../music/timedChordChart';
import { alignUfretChartToSongle, buildUfretVideoPlusChart } from '../music/ufretTiming';
import { bestInversion, fingeringMap, recommendedBassNote } from '../music/voicings';
import { createChordSourceSearchLinks } from '../services/chordSources';
import { loadSongleChordChart, loadSongleChordChartForVideo, searchSongleSongs } from '../services/songle';
import { getLocalServiceStatus, transcribeAudio, validateTranscriptionFile } from '../services/transcriptionClient';
import { loadUfretChordChart, searchUfretSongs } from '../services/ufret';
import { parseYouTubeVideoId } from '../services/youtube';
import { emptyKeyboardGuide } from './GuidedChordLearningMode';
import type {
  ChordSegment,
  ChordChartSource,
  ChordTarget,
  KeyboardGuideState,
  LocalServiceStatus,
  PlaybackController,
  PlaybackSource,
  SongChordDetail,
  SongHandMode,
  SongleSearchResult,
  SongProject,
  SongTrack,
} from '../types';
import type { UfretSearchResult } from '../services/ufret';

interface Props {
  notes: readonly number[];
  splitNote: number;
  onGuideChange: (guide: KeyboardGuideState) => void;
  onAllNotesOff: () => void;
  midiConnected?: boolean;
  midiDeviceName?: string;
}

type SourceKind = 'local' | 'youtube';
type AnalysisKind = 'chart' | 'audio' | 'midi';
type Phase = 'setup' | 'practice';

const DETAIL_KEY = 'chord-sprint:song-detail:v1';
const HAND_KEY = 'chord-sprint:song-hands:v1';
const RATE_KEY = 'chord-sprint:song-rate:v1';
const OFFSET_KEY = 'chord-sprint:song-offset:v1';
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25] as const;

export function SongPracticeMode({ notes, splitNote, onGuideChange, onAllNotesOff, midiConnected = false, midiDeviceName = '' }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [sourceKind, setSourceKind] = useState<SourceKind>('youtube');
  const [analysisKind, setAnalysisKind] = useState<AnalysisKind>('chart');
  const [localAudio, setLocalAudio] = useState<File | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState('');
  const [analysisAudio, setAnalysisAudio] = useState<File | null>(null);
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeSource, setYoutubeSource] = useState<Extract<PlaybackSource, { kind: 'youtube' }> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SongleSearchResult[]>([]);
  const [ufretSearchResults, setUfretSearchResults] = useState<UfretSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingSongId, setImportingSongId] = useState<number | null>(null);
  const [importingUfretUrl, setImportingUfretUrl] = useState<string | null>(null);
  const [chordQuery, setChordQuery] = useState('');
  const [chartText, setChartText] = useState('');
  const [chartBpm, setChartBpm] = useState(100);
  const [chartBeatsPerBar, setChartBeatsPerBar] = useState(4);
  const [chartSourceUrl, setChartSourceUrl] = useState('');
  const [serviceStatus, setServiceStatus] = useState<LocalServiceStatus | null | undefined>(undefined);
  const [tracks, setTracks] = useState<SongTrack[]>([]);
  const [midiBytes, setMidiBytes] = useState<Uint8Array | undefined>();
  const [midiDuration, setMidiDuration] = useState(0);
  const [midiName, setMidiName] = useState('');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<SongProject | null>(null);
  const [detail, setDetail] = useState<SongChordDetail>(() => localStorage.getItem(DETAIL_KEY) === 'faithful' ? 'faithful' : 'simple');
  const [handMode, setHandMode] = useState<SongHandMode>(() => localStorage.getItem(HAND_KEY) === 'both' ? 'both' : 'right');
  const [rate, setRate] = useState(() => {
    const saved = Number(localStorage.getItem(RATE_KEY));
    return RATE_OPTIONS.includes(saved as typeof RATE_OPTIONS[number]) ? saved : 1;
  });
  const [syncOffset, setSyncOffset] = useState(() => Number(localStorage.getItem(OFFSET_KEY)) || 0);
  const [availableRates, setAvailableRates] = useState<readonly number[]>([1]);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [hitVersion, setHitVersion] = useState(0);
  const playbackRef = useRef<PlaybackController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hitsRef = useRef(new Set<number>());

  const detectedChords = useMemo(() => analyzeSongChords(tracks, midiDuration), [midiDuration, tracks]);
  const chartResult = useMemo(
    () => buildTimedChordChart(chartText, chartBpm, chartBeatsPerBar),
    [chartBeatsPerBar, chartBpm, chartText],
  );
  const chordSourceLinks = useMemo(() => createChordSourceSearchLinks(chordQuery), [chordQuery]);

  useEffect(() => {
    let active = true;
    void getLocalServiceStatus().then((status) => { if (active) setServiceStatus(status); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (localAudioUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(localAudioUrl);
    onGuideChange(emptyKeyboardGuide());
    playbackRef.current?.pause();
  }, [localAudioUrl, onGuideChange]);

  const openPractice = (nextProject: SongProject) => {
    hitsRef.current = new Set();
    setSuccessCount(0);
    setHitVersion((value) => value + 1);
    setCurrentTime(0);
    setLoopA(null);
    setLoopB(null);
    setProject(nextProject);
    setPhase('practice');
    setPlayerReady(false);
    setPlaying(false);
    onAllNotesOff();
  };

  useEffect(() => {
    localStorage.setItem(DETAIL_KEY, detail);
    localStorage.setItem(HAND_KEY, handMode);
    localStorage.setItem(RATE_KEY, String(rate));
    localStorage.setItem(OFFSET_KEY, String(syncOffset));
  }, [detail, handMode, rate, syncOffset]);

  useEffect(() => {
    if (phase !== 'practice') return undefined;
    let frame = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      const controller = playbackRef.current;
      if (controller && now - lastPaint >= 50) {
        let time = controller.getCurrentTime();
        if (loopA !== null && loopB !== null && time >= loopB) {
          controller.seek(loopA);
          time = loopA;
        }
        setCurrentTime(time);
        lastPaint = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [loopA, loopB, phase]);

  const analysisTime = analysisTimeForPlayback(currentTime, syncOffset);
  const currentIndex = project ? findChordSegmentIndex(project.chords, analysisTime) : -1;
  const currentSegment = project?.chords[currentIndex] ?? null;
  const currentTarget = chordForDetail(currentSegment, detail);
  const currentHit = currentIndex >= 0 && hitsRef.current.has(currentIndex);
  void hitVersion;

  const guideVoicings = useMemo(() => {
    if (!project) return [] as { right: number[]; bass: number | null }[];
    let previous: number[] = [];
    return project.chords.map((segment) => {
      const target = chordForDetail(segment, detail);
      if (!target) return { right: [], bass: null };
      const chordOnly: ChordTarget = {
        root: target.root,
        quality: target.quality,
        ...(target.spelling ? { spelling: target.spelling } : {}),
      };
      const voicing = bestInversion(previous, chordOnly);
      previous = voicing.notes;
      return { right: voicing.notes, bass: recommendedBassNote({ ...target, bass: target.bass ?? target.root }) };
    });
  }, [detail, project]);

  const performance = useMemo(() => {
    if (!currentTarget) return { exact: false, extraCount: 0, missing: [], extra: [], bassMessage: null };
    if (handMode === 'both') {
      const withBass = { ...currentTarget, bass: currentTarget.bass ?? currentTarget.root };
      const result = analyzeHands(withBass, notes, splitNote);
      return {
        exact: result.isExact,
        extraCount: result.rightHand.extra.length + (result.bassCorrect || result.leftBass === null ? 0 : 1),
        missing: result.rightHand.missing,
        extra: result.rightHand.extra,
        bassMessage: result.bassMessage,
      };
    }
    const result = analyzeChord(currentTarget, notes);
    return { exact: result.isExact, extraCount: result.extra.length, missing: result.missing, extra: result.extra, bassMessage: null };
  }, [currentTarget, handMode, notes, splitNote]);

  useEffect(() => {
    if (!performance.exact || currentIndex < 0 || !currentTarget || hitsRef.current.has(currentIndex)) return;
    hitsRef.current.add(currentIndex);
    setSuccessCount(hitsRef.current.size);
    setHitVersion((value) => value + 1);
  }, [currentIndex, currentTarget, performance.exact]);

  useEffect(() => {
    if (phase !== 'practice' || !project || currentIndex < 0 || !currentTarget) {
      onGuideChange(emptyKeyboardGuide());
      return;
    }
    const voicing = guideVoicings[currentIndex] ?? { right: [], bass: null };
    const chordPcs = chordPitchClasses(currentTarget);
    const expectedBass = currentTarget.bass ?? currentTarget.root;
    const correctActiveNotes = notes.filter((note) => {
      if (handMode === 'both' && note < splitNote) return toPitchClass(note) === expectedBass;
      return chordPcs.includes(toPitchClass(note));
    });
    const extraActiveNotes = notes.filter((note) => {
      if (handMode === 'both' && note < splitNote) return toPitchClass(note) !== expectedBass;
      return !chordPcs.includes(toPitchClass(note));
    });
    onGuideChange({
      guideNotes: voicing.right,
      leftGuideNotes: handMode === 'both' && voicing.bass !== null ? [voicing.bass] : [],
      correctActiveNotes,
      extraActiveNotes,
      fingering: fingeringMap(voicing.right),
      spelling: currentTarget.spelling ?? (keyPrefersFlats(currentTarget.root) ? 'flat' : 'sharp'),
    });
  }, [currentIndex, currentTarget, guideVoicings, handMode, notes, onGuideChange, phase, project, splitNote]);

  const setLocalFile = (file: File | null) => {
    if (localAudioUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(localAudioUrl);
    setLocalAudio(file);
    setAnalysisAudio(null);
    setTracks([]);
    setMidiBytes(undefined);
    if (!file) { setLocalAudioUrl(''); return; }
    const validation = validateTranscriptionFile(file);
    if (validation) { setError(validation); setLocalAudio(null); setLocalAudioUrl(''); return; }
    setError(null);
    setChordQuery((current) => current || stripExtension(file.name));
    setLocalAudioUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '');
  };

  const chooseYouTubeFromInput = () => {
    const videoId = parseYouTubeVideoId(youtubeInput);
    if (!videoId) { setError('YouTubeのURLまたは11文字の動画IDを確認してください。'); return; }
    setYoutubeSource({ kind: 'youtube', videoId, title: 'YouTube動画' });
    setError(null);
    setTracks([]);
    setMidiBytes(undefined);
  };

  const performSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearching(true);
    setError(null);
    try {
      const [songleResult, ufretResult] = await Promise.allSettled([
        searchSongleSongs(query),
        searchUfretSongs(query),
      ]);
      const songleItems = songleResult.status === 'fulfilled' ? songleResult.value : [];
      const ufretItems = ufretResult.status === 'fulfilled' ? ufretResult.value : [];
      setSearchResults(songleItems);
      setUfretSearchResults(ufretItems);
      if (songleItems.length === 0 && ufretItems.length === 0) {
        const failure = songleResult.status === 'rejected' ? songleResult.reason : null;
        setError(failure instanceof Error ? failure.message : 'コード譜の候補が見つかりませんでした。曲名とアーティスト名を変えてお試しください。');
      }
    }
    catch (searchError) { setError(searchError instanceof Error ? searchError.message : '曲の検索に失敗しました。'); }
    finally { setSearching(false); }
  };

  const chooseSongleResult = async (result: SongleSearchResult) => {
    setImportingSongId(result.id);
    setError(null);
    try {
      const chart = await loadSongleChordChart(result);
      const playback: Extract<PlaybackSource, { kind: 'youtube' }> = {
        kind: 'youtube',
        videoId: result.videoId,
        title: result.title,
        channelTitle: result.artist,
        duration: result.duration,
      };
      setSourceKind('youtube');
      setAnalysisKind('chart');
      setYoutubeSource(playback);
      setYoutubeInput(result.youtubeUrl);
      setChordQuery(`${result.title} ${result.artist}`);
      setChartSourceUrl(result.songleUrl);
      setTracks([]);
      setMidiBytes(undefined);
      openPractice({
        title: result.title,
        playback,
        tracks: [],
        chords: chart.segments,
        duration: chart.duration,
        chordSource: { label: 'Songle', url: result.songleUrl },
      });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'コード譜の取得に失敗しました。');
    } finally {
      setImportingSongId(null);
    }
  };

  const chooseUfretResult = async (result: UfretSearchResult) => {
    setImportingUfretUrl(result.url);
    setError(null);
    try {
      const imported = await loadUfretChordChart(result.url);
      const parsedChart = buildTimedChordChart(imported.chartText, imported.bpm, 4);
      if (parsedChart.invalidTokens.length > 0 || parsedChart.segments.length === 0) {
        throw new Error(`読み取れないU-FRETコードがあります: ${parsedChart.invalidTokens.join('、')}`);
      }
      const importedYoutube = imported.youtubeVideoId ? {
        kind: 'youtube' as const,
        videoId: imported.youtubeVideoId,
        title: imported.title,
        channelTitle: imported.artist,
      } : null;
      const playback: PlaybackSource | null = sourceKind === 'local' && localAudio && localAudioUrl
        ? { kind: 'local', name: localAudio.name, url: localAudioUrl }
        : youtubeSource ?? importedYoutube;
      if (!playback) throw new Error('先に同期させるYouTube動画を選んでください。');
      if (playback.kind !== 'youtube') {
        throw new Error('U-FRETコード譜の自動同期にはYouTube動画を選んでください。手元音源は「AI解析」から自動解析できます。');
      }

      let chart = buildUfretVideoPlusChart(imported, playback.videoId);
      let timingLabel = 'U-FRET 動画プラス';
      if (!chart) {
        const songleReference = await loadSongleChordChartForVideo(playback.videoId);
        chart = alignUfretChartToSongle(imported, songleReference);
        timingLabel = 'U-FRET＋Songle同期';
      }

      setAnalysisKind('chart');
      setChartText(imported.chartText);
      setChartBpm(imported.bpm);
      setChartBeatsPerBar(4);
      setChartSourceUrl(imported.url);
      setChordQuery(`${imported.title} ${imported.artist}`);
      setDetail('faithful');
      setSourceKind('youtube');
      setYoutubeSource(playback);
      setYoutubeInput(`https://www.youtube.com/watch?v=${playback.videoId}`);
      openPractice({
        title: imported.title,
        playback,
        tracks: [],
        chords: chart.segments,
        duration: chart.duration,
        chordSource: { label: timingLabel, url: imported.timing?.sourceUrl ?? imported.url },
      });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'U-FRETコード譜の取り込みに失敗しました。');
    } finally {
      setImportingUfretUrl(null);
    }
  };

  const loadAnalysis = async () => {
    const sourceReady = sourceKind === 'local' ? Boolean(localAudio) : Boolean(youtubeSource);
    if (!sourceReady) { setError('先に原曲を選んでください。'); return; }
    const audioFile = sourceKind === 'local' ? localAudio : analysisAudio;
    if (analysisKind === 'audio' && !audioFile) { setError('コード解析に使う音声ファイルを選んでください。'); return; }
    if (analysisKind === 'midi' && !midiFile) { setError('コード解析に使うMIDIファイルを選んでください。'); return; }

    setError(null);
    setProgress({ completed: 0, total: 0 });
    try {
      let bytes: Uint8Array;
      if (analysisKind === 'audio') {
        if (!serviceStatus) throw new Error('MP3自動変換にはローカル版の起動が必要です。MIDI読込はこのまま利用できます。');
        abortRef.current = new AbortController();
        setTranscribing(true);
        bytes = await transcribeAudio(audioFile!, (event) => {
          if (event.type === 'progress') setProgress({ completed: event.completed, total: event.total });
        }, abortRef.current.signal);
      } else {
        bytes = new Uint8Array(await midiFile!.arrayBuffer());
      }
      const parsed = parseSongMidi(bytes);
      if (parsed.tracks.length === 0) throw new Error('MIDI内に演奏ノートが見つかりませんでした。');
      setTracks(parsed.tracks);
      setMidiDuration(parsed.duration);
      setMidiName(parsed.name);
      setMidiBytes(bytes);
    } catch (analysisError) {
      if (analysisError instanceof DOMException && analysisError.name === 'AbortError') setError('変換をキャンセルしました。');
      else setError(analysisError instanceof Error ? analysisError.message : 'コード解析に失敗しました。');
    } finally {
      setTranscribing(false);
      abortRef.current = null;
    }
  };

  const startPractice = () => {
    const playback: PlaybackSource | null = sourceKind === 'local' && localAudio && localAudioUrl
      ? { kind: 'local', name: localAudio.name, url: localAudioUrl }
      : sourceKind === 'youtube' ? youtubeSource : null;
    if (!playback) { setError('原曲を読み込めませんでした。もう一度選び直してください。'); return; }
    const practiceChords = analysisKind === 'chart' ? chartResult.segments : detectedChords;
    if (analysisKind === 'chart' && chartResult.invalidTokens.length > 0) {
      setError(`読めないコードがあります: ${chartResult.invalidTokens.join('、')}`);
      return;
    }
    if (practiceChords.length === 0 || practiceChords.every((segment) => segment.faithful === null)) {
      setError(analysisKind === 'chart' ? '練習するコードを入力してください。' : '安定したコードを検出できませんでした。解析トラックを変更してください。');
      return;
    }
    const chordSource = analysisKind === 'chart' && chartSourceUrl.trim() ? createChartSource(chartSourceUrl) : undefined;
    if (analysisKind === 'chart' && chartSourceUrl.trim() && !chordSource) {
      setError('参照元には http:// または https:// のURLを入力してください。');
      return;
    }
    const nextProject: SongProject = {
      title: playback.kind === 'local' ? stripExtension(playback.name) : playback.title || midiName || 'YouTube練習曲',
      playback,
      tracks: analysisKind === 'chart' ? [] : tracks,
      chords: practiceChords,
      duration: analysisKind === 'chart' ? chartResult.duration : midiDuration,
      ...(midiBytes ? { midiBytes } : {}),
      ...(chordSource ? { chordSource } : {}),
    };
    openPractice(nextProject);
  };

  const handlePlayerReady = useCallback((rates: readonly number[], duration: number) => {
    const usable = rates.length > 0 ? rates : [1];
    setAvailableRates(usable);
    setMediaDuration(duration);
    setPlayerReady(true);
    const nextRate = usable.includes(rate) ? rate : 1;
    setRate(nextRate);
    playbackRef.current?.setRate(nextRate);
  }, [rate]);

  const handlePlayingChange = useCallback((value: boolean) => setPlaying(value), []);
  const handlePlayerError = useCallback((message: string) => {
    setError(message);
    setPlayerReady(false);
    setPlaying(false);
  }, []);

  const togglePlay = () => {
    if (!playerReady) return;
    if (playbackRef.current?.isPlaying()) playbackRef.current.pause();
    else void playbackRef.current?.play();
  };

  const changeRate = (nextRate: number) => {
    if (!availableRates.includes(nextRate)) return;
    setRate(nextRate);
    playbackRef.current?.setRate(nextRate);
  };

  const seek = (time: number) => {
    playbackRef.current?.seek(Math.max(0, Math.min(time, effectiveDuration(project, mediaDuration))));
    setCurrentTime(Math.max(0, time));
    onAllNotesOff();
  };

  const goBackToSetup = () => {
    playbackRef.current?.pause();
    onAllNotesOff();
    onGuideChange(emptyKeyboardGuide());
    setProject(null);
    setPhase('setup');
  };

  const downloadMidi = () => {
    if (!midiBytes) return;
    const blob = new Blob([new Uint8Array(midiBytes)], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${stripExtension(midiName || project?.title || 'transcription')}.mid`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (phase === 'setup') {
    return (
      <SongSetup
        sourceKind={sourceKind}
        setSourceKind={(kind) => { setSourceKind(kind); setTracks([]); setMidiBytes(undefined); setError(null); }}
        analysisKind={analysisKind}
        setAnalysisKind={(kind) => { setAnalysisKind(kind); setTracks([]); setMidiBytes(undefined); setError(null); }}
        localAudio={localAudio}
        setLocalFile={setLocalFile}
        youtubeInput={youtubeInput}
        setYoutubeInput={setYoutubeInput}
        youtubeSource={youtubeSource}
        chooseYouTubeFromInput={chooseYouTubeFromInput}
        searchQuery={searchQuery}
        setSearchQuery={(value) => { setSearchQuery(value); setChordQuery(value); }}
        performSearch={() => void performSearch()}
        searching={searching}
        importingSongId={importingSongId}
        searchResults={searchResults}
        chooseSearchResult={(result) => void chooseSongleResult(result)}
        ufretSearchResults={ufretSearchResults}
        importingUfretUrl={importingUfretUrl}
        chooseUfretResult={(result) => void chooseUfretResult(result)}
        importUfretUrl={() => void chooseUfretResult({ title: '', artist: '', version: '', url: chartSourceUrl })}
        chordQuery={chordQuery}
        setChordQuery={setChordQuery}
        chordSourceLinks={chordSourceLinks}
        chartText={chartText}
        setChartText={setChartText}
        chartBpm={chartBpm}
        setChartBpm={setChartBpm}
        chartBeatsPerBar={chartBeatsPerBar}
        setChartBeatsPerBar={setChartBeatsPerBar}
        chartSourceUrl={chartSourceUrl}
        setChartSourceUrl={setChartSourceUrl}
        chartResult={chartResult}
        serviceStatus={serviceStatus}
        analysisAudio={analysisAudio}
        setAnalysisAudio={(file) => { setAnalysisAudio(file); setTracks([]); setMidiBytes(undefined); setError(null); }}
        midiFile={midiFile}
        setMidiFile={(file) => { setMidiFile(file); setTracks([]); setMidiBytes(undefined); setError(null); }}
        loadAnalysis={() => void loadAnalysis()}
        transcribing={transcribing}
        progress={progress}
        cancelTranscription={() => abortRef.current?.abort()}
        tracks={tracks}
        toggleTrack={(id, enabled) => setTracks((current) => setSongTrackEnabled(current, id, enabled))}
        chords={detectedChords}
        midiBytes={midiBytes}
        downloadMidi={downloadMidi}
        startPractice={startPractice}
        error={error}
      />
    );
  }

  if (!project) return null;
  const duration = effectiveDuration(project, mediaDuration);
  const nextSegment = project.chords[currentIndex + 1] ?? null;
  const afterNextSegment = project.chords[currentIndex + 2] ?? null;
  const segmentProgress = currentSegment ? Math.max(0, Math.min(1, (analysisTime - currentSegment.start) / Math.max(0.001, currentSegment.end - currentSegment.start))) : 0;
  const elapsedIndexes = project.chords.flatMap((segment, index) => segment.start <= analysisTime && chordForDetail(segment, detail) ? [index] : []);
  const elapsedSuccesses = elapsedIndexes.filter((index) => hitsRef.current.has(index)).length;
  const accuracy = elapsedIndexes.length > 0 ? Math.round((elapsedSuccesses / elapsedIndexes.length) * 100) : 0;
  const streak = consecutiveHits(project.chords, currentIndex, hitsRef.current, detail);
  const expectedNoteLabels = currentTarget
    ? chordPitchClasses(currentTarget).map((pitch) => pitchClassNameForTarget(pitch, currentTarget))
    : [];
  const playedNoteLabels = notes.map(midiNoteName);
  const midiFeedbackParts = currentTarget ? [
    performance.missing.length > 0
      ? `不足 ${performance.missing.map((pitch) => pitchClassNameForTarget(pitch, currentTarget)).join('・')}`
      : '',
    performance.extra.length > 0
      ? `余分 ${performance.extra.map((pitch) => pitchClassNameForTarget(pitch, currentTarget)).join('・')}`
      : '',
    performance.bassMessage ?? '',
  ].filter(Boolean) : [];
  const midiProofMessage = !currentTarget
    ? 'コード区間を待っています'
    : performance.exact
      ? '入力音がコードと一致'
      : notes.length === 0
        ? '鍵盤でコードを弾くと判定します'
        : midiFeedbackParts.join(' / ') || '押さえ方を確認してください';

  return (
    <div className="song-practice-page" data-testid="song-practice-mode">
      <div className="song-practice-heading">
        <div><span className="mode-kicker">PLAY WITH THE ORIGINAL</span><h2>{project.title}</h2></div>
        <div className="song-heading-actions">
          {project.chordSource && <a className="button secondary compact" href={project.chordSource.url} target="_blank" rel="noreferrer">参照コード譜を開く ↗</a>}
          {midiBytes && <button className="button secondary compact" type="button" onClick={downloadMidi}>MIDI保存</button>}
          <button className="button secondary compact" type="button" onClick={goBackToSetup}>曲を変更</button>
        </div>
      </div>

      {error && <div className="song-alert" role="alert">{error}</div>}
      <div className="song-practice-grid">
        <section className="song-player-panel">
          {project.playback.kind === 'youtube'
            ? <YouTubePlayer ref={playbackRef} videoId={project.playback.videoId} {...(project.playback.title ? { title: project.playback.title } : {})} onReady={handlePlayerReady} onPlayingChange={handlePlayingChange} onError={handlePlayerError} />
            : <LocalAudioPlayer ref={playbackRef} url={project.playback.url} title={project.playback.name} onReady={handlePlayerReady} onPlayingChange={handlePlayingChange} onError={handlePlayerError} />}
          <div className="transport-time"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
          <input className="song-seek" aria-label="原曲の再生位置" type="range" min="0" max={Math.max(1, duration)} step="0.05" value={Math.min(currentTime, Math.max(1, duration))} onChange={(event) => seek(Number(event.target.value))} />
          <div className="transport-controls">
            <button type="button" aria-label="曲頭へ戻る" onClick={() => seek(0)}>↶</button>
            <button type="button" onClick={() => seek(currentTime - 5)}>−5</button>
            <button className="transport-play" type="button" disabled={!playerReady} aria-label={playing ? '一時停止' : '再生'} onClick={togglePlay}>{playing ? 'Ⅱ' : '▶'}</button>
            <button type="button" onClick={() => seek(currentTime + 5)}>+5</button>
            <button type="button" className={loopA !== null || loopB !== null ? 'active' : ''} onClick={() => { setLoopA(null); setLoopB(null); }}>A–B解除</button>
          </div>
          <div className="loop-controls">
            <button type="button" className={loopA !== null ? 'active' : ''} onClick={() => { setLoopA(currentTime); if (loopB !== null && loopB <= currentTime) setLoopB(null); }}>A {loopA === null ? 'を設定' : formatTime(loopA)}</button>
            <button type="button" className={loopB !== null ? 'active' : ''} onClick={() => { if (loopA === null || currentTime <= loopA) setError('先にA地点を設定し、Aより後でB地点を設定してください。'); else { setLoopB(currentTime); setError(null); } }}>B {loopB === null ? 'を設定' : formatTime(loopB)}</button>
          </div>
        </section>

        <section className={`song-chord-stage ${currentHit ? 'correct' : ''}`}>
          <div className="song-chord-meta"><span>{currentSegment ? `${formatTime(currentSegment.start)} – ${formatTime(currentSegment.end)}` : '準備中'}</span><span>{currentHit ? 'MIDIで確認済み' : performance.extraCount > 0 ? `余分な音 ${performance.extraCount}` : '原曲に重ねて弾く'}</span></div>
          <div className="song-chord-queue">
            <div className="song-current-chord"><span>現在</span><strong>{currentTarget ? chordName(currentTarget) : 'N.C.'}</strong><small>{performance.exact ? '✓ MIDI MATCH' : handMode === 'both' ? '右手コード＋左手ベース' : '右手コード'}</small></div>
            <div><span>次</span><strong>{segmentName(nextSegment, detail)}</strong></div>
            <div><span>その次</span><strong>{segmentName(afterNextSegment, detail)}</strong></div>
          </div>
          <div className={`song-midi-proof ${performance.exact ? 'correct' : notes.length > 0 ? 'mismatch' : ''}`} aria-live="polite">
            <div className="song-midi-proof-head"><span><i /> MIDI CHECK</span><strong>{midiConnected ? midiDeviceName || 'MIDIキーボード接続中' : '画面鍵盤でも確認可能'}</strong></div>
            <div className="song-midi-note-grid"><span>必要音 <b>{expectedNoteLabels.join(' · ') || '—'}</b></span><span>入力音 <b>{playedNoteLabels.join(' · ') || '—'}</b></span></div>
            <p>{midiProofMessage}</p>
          </div>
          <div className="song-segment-progress"><i style={{ transform: `scaleX(${segmentProgress})` }} /></div>
          <div className="song-score-strip"><div><span>成功</span><strong>{successCount}</strong></div><div><span>正確さ</span><strong>{accuracy}%</strong></div><div><span>連続</span><strong>{streak}</strong></div></div>
        </section>
      </div>

      <ChordScoreView
        segments={project.chords}
        currentIndex={currentIndex}
        detail={detail}
        analysisTime={analysisTime}
        onSeek={(time) => seek(time + syncOffset)}
        source={project.chordSource}
      />

      <section className="tap-sync-panel active" aria-label="動画とコード譜の自動同期">
        <div className="tap-sync-copy"><span className="mode-kicker">AUTO SYNC</span><strong>動画の実時間と同期済み</strong><p>{project.chordSource?.label.includes('Songle') ? '選択したYouTubeのSongle解析時刻へU-FRETコード列を自動整列しました。' : 'U-FRET動画プラスの拍マップをそのまま取り込みました。'} コード時刻の手入力は不要です。</p></div>
      </section>

      <section className="song-practice-settings">
        <div><span>コード</span><div className="segmented"><button type="button" className={detail === 'simple' ? 'active' : ''} onClick={() => setDetail('simple')}>簡単</button><button type="button" className={detail === 'faithful' ? 'active' : ''} onClick={() => setDetail('faithful')}>原曲寄り</button></div></div>
        <div><span>手</span><div className="segmented"><button type="button" className={handMode === 'right' ? 'active' : ''} onClick={() => setHandMode('right')}>右手</button><button type="button" className={handMode === 'both' ? 'active' : ''} onClick={() => setHandMode('both')}>両手</button></div></div>
        <div className="rate-settings"><span>速度</span><div>{RATE_OPTIONS.map((option) => <button type="button" key={option} className={rate === option ? 'active' : ''} disabled={!availableRates.includes(option)} onClick={() => changeRate(option)}>{Math.round(option * 100)}%</button>)}</div></div>
        <div className="sync-settings"><span>同期補正 <b>{syncOffset >= 0 ? '+' : ''}{syncOffset.toFixed(1)}秒</b></span><div><button type="button" onClick={() => setSyncOffset((value) => value - 1)}>−1</button><button type="button" onClick={() => setSyncOffset((value) => value - 0.1)}>−0.1</button><button type="button" onClick={() => setSyncOffset(0)}>0</button><button type="button" onClick={() => setSyncOffset((value) => value + 0.1)}>+0.1</button><button type="button" onClick={() => setSyncOffset((value) => value + 1)}>+1</button></div></div>
        <button className="button secondary align-button" type="button" onClick={() => { const first = project.chords.find((segment) => chordForDetail(segment, detail)); if (first) setSyncOffset(currentTime - first.start); }}>現在位置を最初のコードに合わせる</button>
      </section>
    </div>
  );
}

interface SetupProps {
  sourceKind: SourceKind;
  setSourceKind: (kind: SourceKind) => void;
  analysisKind: AnalysisKind;
  setAnalysisKind: (kind: AnalysisKind) => void;
  localAudio: File | null;
  setLocalFile: (file: File | null) => void;
  youtubeInput: string;
  setYoutubeInput: (value: string) => void;
  youtubeSource: Extract<PlaybackSource, { kind: 'youtube' }> | null;
  chooseYouTubeFromInput: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  performSearch: () => void;
  searching: boolean;
  importingSongId: number | null;
  searchResults: readonly SongleSearchResult[];
  chooseSearchResult: (result: SongleSearchResult) => void;
  ufretSearchResults: readonly UfretSearchResult[];
  importingUfretUrl: string | null;
  chooseUfretResult: (result: UfretSearchResult) => void;
  importUfretUrl: () => void;
  chordQuery: string;
  setChordQuery: (value: string) => void;
  chordSourceLinks: ReturnType<typeof createChordSourceSearchLinks>;
  chartText: string;
  setChartText: (value: string) => void;
  chartBpm: number;
  setChartBpm: (value: number) => void;
  chartBeatsPerBar: number;
  setChartBeatsPerBar: (value: number) => void;
  chartSourceUrl: string;
  setChartSourceUrl: (value: string) => void;
  chartResult: ReturnType<typeof buildTimedChordChart>;
  serviceStatus: LocalServiceStatus | null | undefined;
  analysisAudio: File | null;
  setAnalysisAudio: (file: File | null) => void;
  midiFile: File | null;
  setMidiFile: (file: File | null) => void;
  loadAnalysis: () => void;
  transcribing: boolean;
  progress: { completed: number; total: number };
  cancelTranscription: () => void;
  tracks: readonly SongTrack[];
  toggleTrack: (id: string, enabled: boolean) => void;
  chords: readonly ChordSegment[];
  midiBytes: Uint8Array | undefined;
  downloadMidi: () => void;
  startPractice: () => void;
  error: string | null;
}

function SongSetup(props: SetupProps) {
  const sourceReady = props.sourceKind === 'local' ? Boolean(props.localAudio) : Boolean(props.youtubeSource);
  const analysisReady = props.analysisKind === 'chart'
    ? props.chartResult.segments.some((segment) => segment.faithful) && props.chartResult.invalidTokens.length === 0
    : props.analysisKind === 'audio'
      ? props.sourceKind === 'local' ? Boolean(props.localAudio) : Boolean(props.analysisAudio)
      : Boolean(props.midiFile);
  const progressRatio = props.progress.total > 0 ? props.progress.completed / props.progress.total : 0;
  const ufretSearch = createChordSourceSearchLinks(props.searchQuery).find((source) => source.id === 'ufret');
  return (
    <div className="song-setup-page" data-testid="song-practice-setup">
      <header className="song-setup-header"><span className="mode-kicker">PLAY WITH A SONG</span><h2>好きな曲を、コード練習に。</h2><p>原曲を再生しながら、コード譜・現在のコード・鍵盤の押さえ方を同じ画面で追いかけます。</p></header>
      {props.error && <div className="song-alert" role="alert">{props.error}</div>}
      <div className="song-setup-grid">
        <section className="song-setup-card">
          <div className="setup-step"><b>1</b><div><span>原曲を選ぶ</span><small>練習中に実際に聴く音源</small></div></div>
          <div className="source-tabs"><button type="button" className={props.sourceKind === 'local' ? 'active' : ''} onClick={() => props.setSourceKind('local')}>手元の音声</button><button type="button" className={props.sourceKind === 'youtube' ? 'active' : ''} onClick={() => props.setSourceKind('youtube')}>YouTube</button></div>
          {props.sourceKind === 'local' ? (
            <label className={`song-drop ${props.localAudio ? 'selected' : ''}`}><input aria-label="原曲の音声ファイル" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*" onChange={(event) => props.setLocalFile(event.target.files?.[0] ?? null)} /><strong>{props.localAudio?.name ?? 'MP3 / WAVを選択'}</strong><span>{props.localAudio ? 'この音声を原曲と解析の両方に使います' : 'ファイルは外部へ送信されません'}</span></label>
          ) : (
            <div className="youtube-setup">
              <label>URLを貼る<div><input aria-label="YouTube URL" value={props.youtubeInput} placeholder="https://www.youtube.com/watch?v=..." onChange={(event) => props.setYoutubeInput(event.target.value)} /><button type="button" onClick={props.chooseYouTubeFromInput}>選択</button></div></label>
              {props.youtubeSource && <div className="selected-youtube"><span>選択中</span><strong>{props.youtubeSource.title}</strong><small>{props.youtubeSource.videoId}</small></div>}
              <form onSubmit={(event) => { event.preventDefault(); props.performSearch(); }}><label>タイトルでコード検索<div><input aria-label="タイトルでコード検索" value={props.searchQuery} placeholder="曲名 アーティスト" onChange={(event) => props.setSearchQuery(event.target.value)} /><button type="submit" disabled={props.searching || !props.searchQuery.trim()}>{props.searching ? '検索中' : '検索'}</button></div></label></form>
              {ufretSearch && <a className="ufret-search-shortcut" href={ufretSearch.url} target="_blank" rel="noreferrer"><span>U-FRETでコード譜を確認</span><strong>{props.searchQuery}</strong><b>検索結果を開く ↗</b></a>}
              <p className="setup-note songle-credit">候補を選ぶと、YouTube動画とコード時刻を自動で読み込んで練習を開始します。解析結果提供：<a href="https://songle.jp/" target="_blank" rel="noreferrer">Songle ↗</a></p>
              {props.ufretSearchResults.length > 0 && <div className="ufret-import-results"><div className="ufret-results-heading"><span>U-FRET コード譜</span><small>コード記号を自動転記</small></div>{props.ufretSearchResults.map((result) => <button type="button" key={result.url} disabled={props.importingUfretUrl !== null} onClick={() => props.chooseUfretResult(result)}><span><strong>{result.title}</strong><small>{result.artist} · {result.version}</small></span><b>{props.importingUfretUrl === result.url ? '転記中…' : '取り込んで開始 →'}</b></button>)}</div>}
              {props.searchResults.length > 0 && <div className="youtube-results songle-results">{props.searchResults.map((result) => <button type="button" key={result.id} disabled={props.importingSongId !== null} onClick={() => props.chooseSearchResult(result)}><img src={result.thumbnailUrl} alt="" /><span><strong>{result.title}</strong><small>{result.artist} · {formatDuration(result.duration)}</small></span><b>{props.importingSongId === result.id ? 'コード読込中…' : '選んで開始 →'}</b></button>)}</div>}
            </div>
          )}
        </section>

        <section className="song-setup-card">
          <div className="setup-step"><b>2</b><div><span>コード譜を取り込む</span><small>U-FRETの検索結果／曲URLからコード記号を直接転記</small></div></div>
          <div className="source-tabs three"><button type="button" className={props.analysisKind === 'chart' ? 'active' : ''} onClick={() => props.setAnalysisKind('chart')}>コード譜</button><button type="button" className={props.analysisKind === 'audio' ? 'active' : ''} onClick={() => props.setAnalysisKind('audio')}>AI解析</button><button type="button" className={props.analysisKind === 'midi' ? 'active' : ''} onClick={() => props.setAnalysisKind('midi')}>MIDI</button></div>
          {props.analysisKind === 'chart' ? (
            <div className="chart-setup">
              <label className="chart-field">曲名・アーティスト名<input aria-label="コード譜サイト検索" value={props.chordQuery} placeholder="曲名 アーティスト" onChange={(event) => props.setChordQuery(event.target.value)} /></label>
              {props.chordSourceLinks.length > 0 && <div className="chord-source-links">{props.chordSourceLinks.map((source) => <a className={source.id === 'ufret' ? 'primary-source' : ''} key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.label}</strong><small>{source.description}</small><span>探す ↗</span></a>)}</div>}
              <p className="setup-note">検索候補の「取り込んで開始」または曲ページURLの「コードを転記」を使います。歌詞は持ち込まず、コード記号・並び・参照元だけを保存します。</p>
              <label className="chart-field">取り込んだコード進行（確認・微調整）<textarea aria-label="曲のコード譜" value={props.chartText} placeholder="U-FRETの検索候補または曲URLから自動転記されます" onChange={(event) => props.setChartText(event.target.value)} /></label>
              <div className="chart-timing-fields">
                <label>BPM<input aria-label="コード譜BPM" type="number" min="30" max="300" value={props.chartBpm} onChange={(event) => props.setChartBpm(Number(event.target.value))} /></label>
                <label>1小節の拍数<input aria-label="1小節の拍数" type="number" min="1" max="12" value={props.chartBeatsPerBar} onChange={(event) => props.setChartBeatsPerBar(Number(event.target.value))} /></label>
              </div>
              <label className="chart-field">U-FRET曲ページURL<div className="ufret-url-import"><input aria-label="参照コード譜URL" type="url" value={props.chartSourceUrl} placeholder="https://www.ufret.jp/song.php?data=..." onChange={(event) => props.setChartSourceUrl(event.target.value)} /><button type="button" disabled={!props.chartSourceUrl.trim() || props.importingUfretUrl !== null} onClick={props.importUfretUrl}>{props.importingUfretUrl ? '転記中…' : 'コードを転記'}</button></div></label>
              {props.chartResult.invalidTokens.length > 0 && <p className="chart-parse-error">読めないコード: {props.chartResult.invalidTokens.join('、')}</p>}
              {props.chartResult.segments.length > 0 && <div className="chart-mini-preview" aria-label="コード譜プレビュー">{props.chartResult.segments.slice(0, 16).map((segment, index) => <span key={`${segment.start}-${index}`}><small>{segment.measure}</small><strong>{chartPreviewLabel(segment)}</strong></span>)}</div>}
              <button className="button primary song-analyze-button" type="button" disabled={!sourceReady || !analysisReady} onClick={props.startPractice}>このコード譜で練習を始める →</button>
            </div>
          ) : (
            <>
              {props.analysisKind === 'audio' ? (
                props.sourceKind === 'local'
                  ? <div className="same-audio-card"><span>原曲と同じファイルを使用</span><strong>{props.localAudio?.name ?? '先に原曲を選んでください'}</strong></div>
                  : <label className={`song-drop compact ${props.analysisAudio ? 'selected' : ''}`}><input aria-label="解析用の音声ファイル" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,audio/*" onChange={(event) => props.setAnalysisAudio(event.target.files?.[0] ?? null)} /><strong>{props.analysisAudio?.name ?? '対応するMP3 / WAVを選択'}</strong><span>YouTubeから音声を取得することはありません</span></label>
              ) : <label className={`song-drop compact ${props.midiFile ? 'selected' : ''}`}><input aria-label="解析用のMIDIファイル" type="file" accept=".mid,.midi,audio/midi" onChange={(event) => props.setMidiFile(event.target.files?.[0] ?? null)} /><strong>{props.midiFile?.name ?? 'MIDIファイルを選択'}</strong><span>MuScriptorなどで作ったMIDIを使えます</span></label>}
              <div className="local-service-state"><i className={props.serviceStatus ? 'online' : ''} /><span>{props.serviceStatus === undefined ? 'ローカル変換を確認中' : props.serviceStatus ? `${props.serviceStatus.model} · ${props.serviceStatus.device}${props.serviceStatus.cudaAvailable ? ' · CUDA' : ''}` : '公開版：MIDI読込のみ利用可能'}</span></div>
              {props.transcribing ? <div className="transcription-progress"><div><span>AIが楽器別MIDIを作成中</span><strong>{props.progress.total > 0 ? `${props.progress.completed}/${props.progress.total}` : '準備中'}</strong></div><div className="progress-line"><i style={{ transform: `scaleX(${progressRatio})` }} /></div><button type="button" onClick={props.cancelTranscription}>キャンセル</button></div>
                : <button className="button primary song-analyze-button" type="button" disabled={!sourceReady || !analysisReady} onClick={props.loadAnalysis}>{props.analysisKind === 'audio' ? 'MIDI化してコードを作る' : 'MIDIからコードを作る'}</button>}
            </>
          )}
        </section>
      </div>

      {props.analysisKind !== 'chart' && props.tracks.length > 0 && <section className="track-review-panel"><div className="track-review-head"><div><span className="mode-kicker">ANALYSIS READY</span><h3>解析に使う楽器を確認</h3><p>ドラムとボーカルは既定で外しています。変更するとコード列をすぐ作り直します。</p></div><div><strong>{props.chords.filter((segment) => segment.faithful).length}</strong><span>コード区間</span></div></div><div className="track-list">{props.tracks.map((track) => <label key={track.id} className={track.enabled ? 'enabled' : ''}><input type="checkbox" checked={track.enabled} onChange={(event) => props.toggleTrack(track.id, event.target.checked)} /><span><strong>{track.name}</strong><small>{track.instrument} · {track.notes.length} notes</small></span>{track.isDrum && <i>DRUM</i>}{track.isVoice && <i>VOICE</i>}</label>)}</div><div className="track-review-actions">{props.midiBytes && <button className="button secondary" type="button" onClick={props.downloadMidi}>生成MIDIを保存</button>}<button className="button primary" type="button" disabled={props.chords.every((segment) => !segment.faithful)} onClick={props.startPractice}>このコードで練習を始める →</button></div></section>}
    </div>
  );
}

interface ChordScoreViewProps {
  segments: readonly ChordSegment[];
  currentIndex: number;
  detail: SongChordDetail;
  analysisTime: number;
  onSeek: (time: number) => void;
  source: ChordChartSource | undefined;
}

function ChordScoreView({ segments, currentIndex, detail, analysisTime, onSeek, source }: ChordScoreViewProps) {
  const railActiveRef = useRef<HTMLButtonElement | null>(null);
  const measures = useMemo(() => groupScoreMeasures(segments), [segments]);

  useEffect(() => {
    railActiveRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }, [currentIndex]);

  return (
    <section className="song-chart-panel" aria-label="曲のコード譜">
      <div className="song-chart-head">
        <div><span className="mode-kicker">FOLLOWING THE VIDEO</span><h3>コード譜</h3><p>動画のシークに追従します。小節を押すと、その位置へ移動します。</p></div>
        {source && <a href={source.url} target="_blank" rel="noreferrer"><span>参照元</span><strong>{source.label}</strong><b>↗</b></a>}
      </div>
      <div className="song-chord-rail-frame">
        <span className="song-chord-playhead" aria-hidden="true" />
        <div className="song-chord-rail" aria-label="動画追従コード列">
          {segments.map((segment, index) => {
            const target = chordForDetail(segment, detail);
            const active = index === currentIndex;
            const progress = active ? Math.max(0, Math.min(1, (analysisTime - segment.start) / Math.max(0.001, segment.end - segment.start))) : 0;
            return (
              <button
                type="button"
                key={`rail-${segment.start}-${index}`}
                ref={active ? railActiveRef : undefined}
                className={`${active ? 'active' : ''} ${index < currentIndex ? 'past' : ''}`.trim()}
                aria-current={active ? 'true' : undefined}
                aria-label={`${segment.measure ?? index + 1}小節 ${target ? chordName(target) : 'N.C.'} ${formatTime(segment.start)}`}
                onClick={() => onSeek(segment.start)}
              >
                <small>M{segment.measure ?? Math.floor(index / 4) + 1}</small>
                <strong>{target ? chordName(target) : 'N.C.'}</strong>
                <span>{formatTime(segment.start)}</span>
                {active && <i style={{ transform: `scaleX(${progress})` }} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="song-score-overview-head"><span>曲全体</span><small>小節単位でジャンプ</small></div>
      <div className="song-chart-scroll">
        <div className="song-chart-measures">
          {measures.map((measure) => {
            const activeMeasure = measure.cells.some((cell) => cell.index === currentIndex);
            return (
              <div className={`song-chart-measure ${activeMeasure ? 'active' : ''}`} key={measure.number}>
                <span className="song-measure-number">{measure.number}</span>
                <div style={{ gridTemplateColumns: `repeat(${Math.min(4, measure.cells.length)}, minmax(0, 1fr))` }}>
                  {measure.cells.map(({ segment, index }) => {
                    const target = chordForDetail(segment, detail);
                    const active = index === currentIndex;
                    const progress = active ? Math.max(0, Math.min(1, (analysisTime - segment.start) / Math.max(0.001, segment.end - segment.start))) : 0;
                    return (
                      <button
                        type="button"
                        key={`${segment.start}-${index}`}
                        className={active ? 'active' : ''}
                        aria-current={active ? 'true' : undefined}
                        aria-label={`${measure.number}小節 ${target ? chordName(target) : 'N.C.'} ${formatTime(segment.start)}`}
                        onClick={() => onSeek(segment.start)}
                      >
                        <small>{formatTime(segment.start)}</small>
                        <strong>{target ? chordName(target) : 'N.C.'}</strong>
                        {active && <i style={{ transform: `scaleX(${progress})` }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function groupScoreMeasures(segments: readonly ChordSegment[]) {
  const measures: { number: number; cells: { segment: ChordSegment; index: number }[] }[] = [];
  segments.forEach((segment, index) => {
    const number = segment.measure ?? Math.floor(index / 4) + 1;
    let measure = measures.at(-1);
    if (!measure || measure.number !== number) {
      measure = { number, cells: [] };
      measures.push(measure);
    }
    measure.cells.push({ segment, index });
  });
  return measures;
}

function createChartSource(raw: string): ChordChartSource | undefined {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const labels: Record<string, string> = {
      'www.ufret.jp': 'U-FRET',
      'ufret.jp': 'U-FRET',
      'ja.chordwiki.org': 'ChordWiki',
      'gakufu.gakki.me': '楽器.me',
      'music.j-total.net': 'J-Total Music',
      'utabon.jp': 'UTABON',
      'www.utabon.jp': 'UTABON',
    };
    return { label: labels[url.hostname] ?? url.hostname, url: url.toString() };
  } catch {
    return undefined;
  }
}

function segmentName(segment: ChordSegment | null, detail: SongChordDetail): string {
  const target = chordForDetail(segment, detail);
  return target ? chordName(target) : 'N.C.';
}

function effectiveDuration(project: SongProject | null, mediaDuration: number): number {
  return Math.max(1, mediaDuration || 0, project?.duration ?? 0);
}

function consecutiveHits(segments: readonly ChordSegment[], currentIndex: number, hits: ReadonlySet<number>, detail: SongChordDetail): number {
  let streak = 0;
  for (let index = currentIndex; index >= 0; index -= 1) {
    if (!chordForDetail(segments[index], detail)) continue;
    if (!hits.has(index)) break;
    streak += 1;
  }
  return streak;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '時間不明';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
