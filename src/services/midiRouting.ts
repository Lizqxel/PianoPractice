export interface MidiPortIdentity { id: string; name: string }

export function midiLoopWarning(input: MidiPortIdentity | null, output: MidiPortIdentity | null): string | null {
  if (!input || !output) return null;
  const inputName = input.name.trim().toLowerCase();
  const outputName = output.name.trim().toLowerCase();
  if (input.id === output.id || inputName === outputName) return 'MIDI入力と出力に同じポートを選択するとループする可能性があります。別のポートを選んでください。';
  if (inputName.includes('chord sprint out') || outputName.includes('loop') && inputName.includes('loop')) return '仮想MIDI出力をChord Sprintの入力へ戻さないでください。Studio OneのSend ToはNoneに設定します。';
  return null;
}
