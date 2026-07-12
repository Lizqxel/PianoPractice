interface MidiDeviceOption {
  id: string;
  name: string;
}

interface MidiPanelProps {
  supported: boolean;
  connected: boolean;
  devices: readonly MidiDeviceOption[];
  selectedId: string;
  error: string | null;
  onConnect: () => void;
  onSelect: (id: string) => void;
}

export function MidiPanel({ supported, connected, devices, selectedId, error, onConnect, onSelect }: MidiPanelProps) {
  return (
    <div className="midi-panel">
      <div className={`status-dot ${connected ? 'online' : ''}`} aria-hidden="true" />
      <div className="midi-copy">
        <strong>{connected ? 'MIDI接続中' : 'MIDI未接続'}</strong>
        <span>{connected ? devices.find((item) => item.id === selectedId)?.name : '仮想鍵盤でも練習できます'}</span>
      </div>
      {devices.length > 0 && (
        <select aria-label="MIDI入力機器" value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select>
      )}
      <button className="button secondary compact" type="button" onClick={onConnect} disabled={!supported}>
        {connected ? '再接続' : 'MIDI機器を接続'}
      </button>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  );
}
