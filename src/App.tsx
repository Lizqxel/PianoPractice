import { useEffect, useMemo, useRef, useState } from 'react';
import { CurrentChord } from './components/CurrentChord';
import { Metronome } from './components/Metronome';
import { MidiPanel } from './components/MidiPanel';
import { PianoKeyboard } from './components/PianoKeyboard';
import { HomeMode } from './modes/HomeMode';
import { SprintMode } from './modes/SprintMode';
import { ProgressionMode } from './modes/ProgressionMode';
import { SixtySecondMode } from './modes/SixtySecondMode';
import { CurriculumMode } from './modes/CurriculumMode';
import { AudioEngine } from './services/audioEngine';
import { MidiService } from './services/midiService';
import type { AppMode, MidiNoteEvent } from './types';

const NAV: readonly { mode: AppMode; icon: string; label: string }[] = [
  { mode: 'home', icon: '⌂', label: 'ホーム' },
  { mode: 'sprint', icon: '⌁', label: 'コード瞬発' },
  { mode: 'progression', icon: '↗', label: 'コード進行' },
  { mode: 'sixty', icon: '60', label: '60秒チェンジ' },
  { mode: 'curriculum', icon: '✓', label: '14日間プラン' },
];

export default function App() {
  const audio = useMemo(() => new AudioEngine(), []);
  const midi = useMemo(() => new MidiService(), []);
  const [mode, setMode] = useState<AppMode>('home');
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [selectedMidi, setSelectedMidi] = useState('');
  const [midiError, setMidiError] = useState<string | null>(null);
  const [volume, setVolume] = useState(35);
  const [muted, setMuted] = useState(false);
  const [focus, setFocus] = useState(false);
  const activeRef = useRef(activeNotes);
  activeRef.current = activeNotes;

  const noteOn = (note: number, velocity: number) => {
    if (note < 0 || note > 127) return;
    setActiveNotes((current) => new Set(current).add(note));
    void audio.noteOn(note, velocity).catch(() => setMidiError('音源を開始できません。ページ上を一度クリックしてから再度お試しください。'));
  };
  const noteOff = (note: number) => {
    setActiveNotes((current) => { const next = new Set(current); next.delete(note); return next; });
    audio.noteOff(note);
  };

  useEffect(() => {
    const handle = (event: MidiNoteEvent) => event.type === 'noteon' ? noteOn(event.note, event.velocity) : noteOff(event.note);
    midi.onNote(handle);
    midi.onStateChange(() => {
      const nextDevices = midi.inputs().map((input) => ({ id: input.id, name: input.name ?? '名称不明のMIDI機器' }));
      setDevices(nextDevices);
      setSelectedMidi((current) => {
        if (current && !nextDevices.some((device) => device.id === current)) {
          audio.allNotesOff();
          setActiveNotes(new Set());
          setMidiError('使用中のMIDI機器との接続が切れました。USB接続と機器の電源を確認してください。');
          return '';
        }
        return current;
      });
    });
    const releaseAll = () => { audio.allNotesOff(); setActiveNotes(new Set()); };
    window.addEventListener('blur', releaseAll);
    return () => { window.removeEventListener('blur', releaseAll); midi.disconnect(); audio.allNotesOff(); };
  }, [audio, midi]);

  const connectMidi = async () => {
    setMidiError(null);
    try {
      const inputs = await midi.connect();
      const options = inputs.map((input) => ({ id: input.id, name: input.name ?? '名称不明のMIDI機器' }));
      setDevices(options);
      if (options.length === 0) {
        setSelectedMidi('');
        setMidiError('MIDI入力機器が見つかりません。USB接続と機器の電源を確認してください。仮想鍵盤はそのまま使えます。');
        return;
      }
      const first = options[0]!;
      midi.selectInput(first.id);
      setSelectedMidi(first.id);
      await audio.resume();
    } catch (error: unknown) {
      setMidiError(error instanceof Error ? error.message : 'MIDI接続中に不明なエラーが発生しました。');
    }
  };

  const selectMidi = (id: string) => {
    try { midi.selectInput(id); setSelectedMidi(id); setMidiError(null); }
    catch (error: unknown) { setMidiError(error instanceof Error ? error.message : 'MIDI機器を選択できませんでした。'); }
  };

  const noteArray = [...activeNotes].sort((a, b) => a - b);
  const modeTitle = NAV.find((item) => item.mode === mode)?.label ?? 'Chord Sprint';

  return (
    <div className={`app-shell ${focus ? 'focus-mode' : ''}`}>
      <aside className="app-sidebar">
        <button className="brand" type="button" onClick={() => setMode('home')}><span className="brand-mark">CS</span><span><strong>Chord Sprint</strong><small>PIANO PRACTICE</small></span></button>
        <nav>{NAV.map((item) => <button className={mode === item.mode ? 'active' : ''} type="button" key={item.mode} onClick={() => setMode(item.mode)}><i>{item.icon}</i><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-spacer" />
        <Metronome audio={audio} />
        <section className="audio-controls"><div className="section-title-row"><div><span className="eyebrow">INSTRUMENT</span><h3>ピアノ音源</h3></div><button className={`icon-toggle ${muted ? 'muted' : ''}`} type="button" onClick={() => { const next = !muted; setMuted(next); audio.setMuted(next); }} aria-label={muted ? 'ミュート解除' : 'ミュート'}>{muted ? '×' : '◖'}</button></div><label className="range-label">音量 <span>{volume}%</span></label><input type="range" min="0" max="100" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); audio.setVolume(next / 100); }} /></section>
      </aside>
      <main>
        <header className="topbar"><div><span className="topbar-caption">PRACTICE /</span><strong>{modeTitle}</strong></div><div className="topbar-actions"><MidiPanel supported={midi.supported} connected={Boolean(selectedMidi)} devices={devices} selectedId={selectedMidi} error={midiError} onConnect={() => void connectMidi()} onSelect={selectMidi} /><button className={`button secondary compact focus-button ${focus ? 'active' : ''}`} type="button" onClick={() => setFocus((value) => !value)}>◎ {focus ? '集中モードを終了' : '集中モード'}</button></div></header>
        <div className="content-area">
          {mode === 'home' && <HomeMode onNavigate={setMode} />}
          {mode === 'sprint' && <SprintMode notes={noteArray} />}
          {mode === 'progression' && <ProgressionMode notes={noteArray} />}
          {mode === 'sixty' && <SixtySecondMode notes={noteArray} />}
          {mode === 'curriculum' && <CurriculumMode />}
        </div>
        {mode !== 'curriculum' && (
          <section className="keyboard-dock"><CurrentChord notes={noteArray} /><PianoKeyboard activeNotes={activeNotes} onNoteOn={noteOn} onNoteOff={noteOff} /></section>
        )}
        {focus && <button className="focus-exit" type="button" onClick={() => setFocus(false)}>Esc · 集中モードを終了</button>}
      </main>
    </div>
  );
}
