import { useEffect, useMemo, useRef, useState } from 'react';
import { CurrentChord } from './components/CurrentChord';
import { Metronome } from './components/Metronome';
import { MidiPanel } from './components/MidiPanel';
import { PianoKeyboard } from './components/PianoKeyboard';
import { AudioRoutingPanel } from './components/AudioRoutingPanel';
import { HomeMode } from './modes/HomeMode';
import { SprintMode } from './modes/SprintMode';
import { ProgressionMode } from './modes/ProgressionMode';
import { SixtySecondMode } from './modes/SixtySecondMode';
import { SongPracticeMode } from './modes/SongPracticeMode';
import { CurriculumMode } from './modes/CurriculumMode';
import { LessonSessionRouter } from './modes/LessonSessionRouter';
import { emptyKeyboardGuide } from './modes/GuidedChordLearningMode';
import { getCurriculumDay } from './music/curriculum';
import { midiLoopWarning } from './services/midiRouting';
import { hasExternalSound, routeKeyboardNoteOff, routeKeyboardNoteOn } from './services/soundRouter';
import { AudioEngine } from './services/audioEngine';
import { MidiService } from './services/midiService';
import { loadCurriculum, saveDailySessionResult } from './services/storage';
import type { AppMode, KeyboardGuideState, MidiNoteEvent, SoundMode } from './types';

const SOUND_MODE_KEY = 'chord-sprint:sound-mode:v1';
const MIDI_OUTPUT_KEY = 'chord-sprint:midi-output:v1';

const NAV: readonly { mode: AppMode; icon: string; label: string }[] = [
  { mode: 'home', icon: '⌂', label: 'ホーム' },
  { mode: 'sprint', icon: '⌁', label: 'コード瞬発' },
  { mode: 'progression', icon: '↗', label: 'コード進行' },
  { mode: 'sixty', icon: '60', label: '60秒チェンジ' },
  { mode: 'songPractice', icon: '♪', label: '曲で弾く' },
  { mode: 'curriculum', icon: '✓', label: '14日間プラン' },
];

export default function App() {
  const audio = useMemo(() => new AudioEngine(), []);
  const midi = useMemo(() => new MidiService(), []);
  const [mode, setMode] = useState<AppMode>('home');
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [outputDevices, setOutputDevices] = useState<{ id: string; name: string }[]>([]);
  const [selectedMidi, setSelectedMidi] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('');
  const [midiError, setMidiError] = useState<string | null>(null);
  const [volume, setVolume] = useState(35);
  const [focus, setFocus] = useState(false);
  const [splitNote, setSplitNote] = useState(60);
  const [metronomeBpm, setMetronomeBpm] = useState(80);
  const [metronomeRunning, setMetronomeRunning] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(55);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [soundMode, setSoundMode] = useState<SoundMode>(() => {
    const saved = localStorage.getItem(SOUND_MODE_KEY);
    return saved === 'external' || saved === 'both' ? saved : 'internal';
  });
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [keyboardGuide, setKeyboardGuide] = useState<KeyboardGuideState>(emptyKeyboardGuide);
  const activeRef = useRef(activeNotes);
  const soundModeRef = useRef(soundMode);
  activeRef.current = activeNotes;
  soundModeRef.current = soundMode;

  const usesExternal = (mode = soundModeRef.current) => hasExternalSound(mode);
  const allSoundOff = () => { audio.allNotesOff(); midi.allNotesOff(); setActiveNotes(new Set()); };

  const noteOn = (note: number, velocity: number, forwardToOutput = true) => {
    if (note < 0 || note > 127) return;
    setActiveNotes((current) => new Set(current).add(note));
    void routeKeyboardNoteOn(soundModeRef.current, audio, midi, note, velocity, 1, forwardToOutput)?.catch(() => setMidiError('音源を開始できません。ページ上を一度クリックしてから再度お試しください。'));
  };
  const noteOff = (note: number, forwardToOutput = true) => {
    setActiveNotes((current) => { const next = new Set(current); next.delete(note); return next; });
    routeKeyboardNoteOff(soundModeRef.current, audio, midi, note, 1, forwardToOutput);
  };

  useEffect(() => {
    const handle = (event: MidiNoteEvent) => event.type === 'noteon' ? noteOn(event.note, event.velocity, false) : noteOff(event.note, false);
    midi.onNote(handle);
    midi.onRawMessage((event) => { if (usesExternal()) midi.sendRaw(event.data, event.timestamp); });
    midi.onStateChange(() => {
      const nextDevices = midi.inputs().map((input) => ({ id: input.id, name: input.name ?? '名称不明のMIDI機器' }));
      const nextOutputs = midi.outputs().map((output) => ({ id: output.id, name: output.name ?? '名称不明のMIDI出力' }));
      setDevices(nextDevices);
      setOutputDevices(nextOutputs);
      setSelectedMidi((current) => {
        if (current && !nextDevices.some((device) => device.id === current)) {
          allSoundOff();
          setMidiError('使用中のMIDI機器との接続が切れました。USB接続と機器の電源を確認してください。');
          return '';
        }
        return current;
      });
      setSelectedOutput((current) => {
        if (current && !nextOutputs.some((output) => output.id === current)) {
          allSoundOff();
          setMidiError('使用中のMIDI出力との接続が切れました。外部DAWの音が鳴り続けていないか確認してください。');
          return '';
        }
        if (!current) {
          const savedOutput = localStorage.getItem(MIDI_OUTPUT_KEY);
          if (savedOutput && nextOutputs.some((output) => output.id === savedOutput)) {
            try { midi.selectOutput(savedOutput); return savedOutput; } catch { return ''; }
          }
        }
        return current;
      });
    });
    const releaseAll = () => allSoundOff();
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    return () => { window.removeEventListener('blur', releaseAll); window.removeEventListener('pagehide', releaseAll); allSoundOff(); midi.disconnect(); };
  }, [audio, midi]);

  const connectMidi = async () => {
    setMidiError(null);
    try {
      const inputs = await midi.connect();
      const options = inputs.map((input) => ({ id: input.id, name: input.name ?? '名称不明のMIDI機器' }));
      const outputs = midi.outputs().map((output) => ({ id: output.id, name: output.name ?? '名称不明のMIDI出力' }));
      setDevices(options);
      setOutputDevices(outputs);
      if (options.length === 0) {
        setSelectedMidi('');
        setMidiError('MIDI入力機器が見つかりません。USB接続と機器の電源を確認してください。仮想鍵盤はそのまま使えます。');
        if (outputs.length === 0) return;
      }
      const first = options[0];
      if (first) { midi.selectInput(first.id); setSelectedMidi(first.id); }
      const savedOutput = localStorage.getItem(MIDI_OUTPUT_KEY);
      if (savedOutput && outputs.some((output) => output.id === savedOutput)) { midi.selectOutput(savedOutput); setSelectedOutput(savedOutput); }
      await audio.resume();
    } catch (error: unknown) {
      setMidiError(error instanceof Error ? error.message : 'MIDI接続中に不明なエラーが発生しました。');
    }
  };

  const selectMidi = (id: string) => {
    try { midi.selectInput(id); setSelectedMidi(id); setMidiError(null); }
    catch (error: unknown) { setMidiError(error instanceof Error ? error.message : 'MIDI機器を選択できませんでした。'); }
  };

  const selectOutput = (id: string) => {
    try {
      allSoundOff();
      if (!id) { midi.clearOutput(); setSelectedOutput(''); localStorage.removeItem(MIDI_OUTPUT_KEY); return; }
      midi.selectOutput(id); setSelectedOutput(id); localStorage.setItem(MIDI_OUTPUT_KEY, id); setMidiError(null);
    } catch (error: unknown) { setMidiError(error instanceof Error ? error.message : 'MIDI出力を選択できませんでした。'); }
  };

  const changeSoundMode = (next: SoundMode) => {
    if (next !== soundModeRef.current) allSoundOff();
    setSoundMode(next); soundModeRef.current = next; localStorage.setItem(SOUND_MODE_KEY, next);
  };

  const noteArray = useMemo(() => [...activeNotes].sort((a, b) => a - b), [activeNotes]);
  const modeTitle = mode === 'lesson' && activeDay !== null ? `Day ${activeDay} · ${getCurriculumDay(activeDay).title}` : NAV.find((item) => item.mode === mode)?.label ?? 'Chord Sprint';
  const todayDay = loadCurriculum().find((record) => !record.completed)?.day ?? 14;
  const loopWarning = midiLoopWarning(devices.find((device) => device.id === selectedMidi) ?? null, outputDevices.find((device) => device.id === selectedOutput) ?? null);
  const navigate = (nextMode: AppMode) => {
    if (nextMode !== 'lesson') setActiveDay(null);
    setKeyboardGuide(emptyKeyboardGuide());
    allSoundOff();
    setMode(nextMode);
  };

  return (
    <div className={`app-shell ${focus ? 'focus-mode' : ''}`}>
      <aside className="app-sidebar">
        <button className="brand" type="button" onClick={() => navigate('home')}><span className="brand-mark">CS</span><span><strong>Chord Sprint</strong><small>PIANO PRACTICE</small></span></button>
        <nav>{NAV.map((item) => <button className={mode === item.mode || (mode === 'lesson' && item.mode === 'curriculum') ? 'active' : ''} type="button" key={item.mode} onClick={() => navigate(item.mode)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-spacer" />
        <Metronome audio={audio} bpm={metronomeBpm} onBpmChange={setMetronomeBpm} running={metronomeRunning} onRunningChange={setMetronomeRunning} volume={metronomeVolume} onVolumeChange={setMetronomeVolume} enabled={metronomeEnabled} />
        <AudioRoutingPanel mode={soundMode} onModeChange={changeSoundMode} outputs={outputDevices} selectedOutputId={selectedOutput} onOutputChange={selectOutput} outputConnected={Boolean(selectedOutput)} internalVolume={volume} onInternalVolumeChange={(next) => { setVolume(next); audio.setVolume(next / 100); }} metronomeVolume={metronomeVolume} onMetronomeVolumeChange={setMetronomeVolume} metronomeEnabled={metronomeEnabled} onMetronomeEnabledChange={(enabled) => { setMetronomeEnabled(enabled); if (!enabled) setMetronomeRunning(false); }} onTestOutput={() => midi.testOutputNote()} warning={loopWarning} />
      </aside>
      <main>
        <header className="topbar"><div><span className="topbar-caption">PRACTICE /</span><strong>{modeTitle}</strong></div><div className="topbar-actions"><MidiPanel supported={midi.supported} connected={Boolean(selectedMidi)} devices={devices} selectedId={selectedMidi} error={midiError} onConnect={() => void connectMidi()} onSelect={selectMidi} /><button className={`button secondary compact focus-button ${focus ? 'active' : ''}`} type="button" onClick={() => setFocus((value) => !value)}>◎ {focus ? '集中モードを終了' : '集中モード'}</button></div></header>
        <div className="content-area">
          {mode === 'home' && <HomeMode onNavigate={navigate} />}
          {mode === 'sprint' && <SprintMode notes={noteArray} curriculumDay={todayDay} dailySession={false} splitNote={splitNote} onDailyComplete={(result) => { saveDailySessionResult(result); setMode('curriculum'); }} />}
          {mode === 'progression' && <ProgressionMode notes={noteArray} audio={audio} bpm={metronomeBpm} onBpmChange={setMetronomeBpm} onSessionStart={() => { setMetronomeRunning(false); allSoundOff(); }} onAllNotesOff={allSoundOff} metronomeVolume={metronomeEnabled ? metronomeVolume : 0} onMetronomeVolumeChange={setMetronomeVolume} />}
          {mode === 'sixty' && <SixtySecondMode notes={noteArray} onAllNotesOff={allSoundOff} />}
          {mode === 'songPractice' && <SongPracticeMode notes={noteArray} splitNote={splitNote} onGuideChange={setKeyboardGuide} onAllNotesOff={allSoundOff} />}
          {mode === 'curriculum' && <CurriculumMode onStartDay={(day) => { void audio.resume(); setActiveDay(day); setKeyboardGuide(emptyKeyboardGuide()); setMode('lesson'); }} />}
          {mode === 'lesson' && activeDay !== null && <LessonSessionRouter day={activeDay} notes={noteArray} splitNote={splitNote} audio={audio} bpm={metronomeBpm} onBpmChange={setMetronomeBpm} metronomeVolume={metronomeEnabled ? metronomeVolume : 0} onMetronomeVolumeChange={setMetronomeVolume} onGuideChange={setKeyboardGuide} onSessionStart={() => { setMetronomeRunning(false); allSoundOff(); }} onAllNotesOff={allSoundOff} onComplete={(result) => { allSoundOff(); saveDailySessionResult(result); setKeyboardGuide(emptyKeyboardGuide()); setActiveDay(null); setMode('curriculum'); }} />}
        </div>
        {mode !== 'curriculum' && (
          <section className="keyboard-dock"><CurrentChord notes={noteArray} splitNote={splitNote} onSplitNoteChange={setSplitNote} /><PianoKeyboard activeNotes={activeNotes} guideNotes={new Set(keyboardGuide.guideNotes)} leftGuideNotes={new Set(keyboardGuide.leftGuideNotes)} correctActiveNotes={new Set(keyboardGuide.correctActiveNotes)} extraActiveNotes={new Set(keyboardGuide.extraActiveNotes)} fingering={keyboardGuide.fingering} onNoteOn={noteOn} onNoteOff={noteOff} /></section>
        )}
        {focus && <button className="focus-exit" type="button" onClick={() => setFocus(false)}>Esc · 集中モードを終了</button>}
      </main>
    </div>
  );
}
