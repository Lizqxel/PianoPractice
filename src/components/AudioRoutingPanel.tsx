import type { SoundMode } from '../types';

interface MidiOutputOption { id: string; name: string }
interface Props {
  mode: SoundMode;
  onModeChange: (mode: SoundMode) => void;
  outputs: readonly MidiOutputOption[];
  selectedOutputId: string;
  onOutputChange: (id: string) => void;
  outputConnected: boolean;
  internalVolume: number;
  onInternalVolumeChange: (volume: number) => void;
  metronomeVolume: number;
  onMetronomeVolumeChange: (volume: number) => void;
  metronomeEnabled: boolean;
  onMetronomeEnabledChange: (enabled: boolean) => void;
  onTestOutput: () => void;
  warning: string | null;
}

export function AudioRoutingPanel(props: Props) {
  const externalEnabled = props.mode === 'external' || props.mode === 'both';
  return <section className="audio-controls routing-panel">
    <div className="section-title-row"><div><span className="eyebrow">INSTRUMENT</span><h3>音源設定</h3></div><span className={`routing-status ${props.outputConnected ? 'online' : ''}`}>{props.outputConnected ? '出力接続中' : '出力未接続'}</span></div>
    <label className="field-label">音源モード<select aria-label="音源モード" value={props.mode} onChange={(event) => props.onModeChange(event.target.value as SoundMode)}><option value="internal">内蔵音源</option><option value="external">Studio One／外部DAW</option><option value="both">内蔵＋外部の両方</option></select></label>
    <label className="field-label">MIDI出力<select aria-label="MIDI出力機器" value={props.selectedOutputId} disabled={!externalEnabled || props.outputs.length === 0} onChange={(event) => props.onOutputChange(event.target.value)}><option value="">出力を選択</option>{props.outputs.map((output) => <option key={output.id} value={output.id}>{output.name}</option>)}</select></label>
    <label className="range-label">内蔵鍵盤音 <span>{props.internalVolume}%</span></label><input aria-label="内蔵鍵盤音量" type="range" min="0" max="100" value={props.internalVolume} disabled={props.mode === 'external'} onChange={(event) => props.onInternalVolumeChange(Number(event.target.value))} />
    <label className="range-label">メトロノーム音 <span>{props.metronomeVolume}%</span></label><input aria-label="メトロノーム音量" type="range" min="0" max="100" value={props.metronomeVolume} onChange={(event) => props.onMetronomeVolumeChange(Number(event.target.value))} />
    <label className="check-row"><input type="checkbox" checked={props.metronomeEnabled} onChange={(event) => props.onMetronomeEnabledChange(event.target.checked)} />外部DAWモードでも内蔵メトロノームを使う</label>
    <button className="button secondary output-test" type="button" disabled={!externalEnabled || !props.outputConnected} onClick={props.onTestOutput}>C4でMIDI出力をテスト</button>
    {props.warning && <div className="routing-warning" role="alert">{props.warning}</div>}
    <details className="studio-guide"><summary>Studio One 6 接続方法</summary><ol><li>仮想MIDIポート作成ソフトで「Chord Sprint Out」を作る</li><li>MIDI入力に実物のMIDIキーボードを選ぶ</li><li>MIDI出力にChord Sprint Outを選ぶ</li><li>Studio One 6の外部デバイス設定でNew Keyboardを追加</li><li>Receive FromにChord Sprint Outを指定</li><li>Send ToはNoneにする</li><li>Instrument Trackを作成</li><li>好きなピアノ音源とプリセットを選ぶ</li><li>トラックのモニターをONにする</li><li>イヤホンをStudio Oneのオーディオ出力へ接続</li></ol><strong>音源とプリセットの選択はStudio One側で行います。</strong></details>
  </section>;
}
