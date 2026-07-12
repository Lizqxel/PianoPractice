import { useEffect } from 'react';
import { getCurriculumDay } from '../music/curriculum';
import type { AudioEngine } from '../services/audioEngine';
import type { DailySessionResult, KeyboardGuideState, LessonType } from '../types';
import { GuidedChordLearningMode, emptyKeyboardGuide } from './GuidedChordLearningMode';
import { InversionLessonMode } from './InversionLessonMode';
import { MixedTestMode } from './MixedTestMode';
import { ProgressionMode } from './ProgressionMode';
import { SequenceLessonMode } from './SequenceLessonMode';
import { SprintMode } from './SprintMode';

interface Props {
  day: number;
  notes: readonly number[];
  splitNote: number;
  audio: AudioEngine;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  onGuideChange: (guide: KeyboardGuideState) => void;
  onComplete: (result: DailySessionResult) => void;
  onSessionStart: () => void;
  metronomeVolume: number;
  onMetronomeVolumeChange: (volume: number) => void;
  onAllNotesOff: () => void;
}

export function lessonTestId(lessonType: LessonType): string { return `lesson-${lessonType}`; }

export function LessonSessionRouter({ day, notes, splitNote, audio, bpm, onBpmChange, onGuideChange, onComplete, onSessionStart, metronomeVolume, onMetronomeVolumeChange, onAllNotesOff }: Props) {
  const definition = getCurriculumDay(day);
  useEffect(() => () => onGuideChange(emptyKeyboardGuide()), [onGuideChange]);

  if (definition.lessonType === 'guidedChordLearning' || definition.lessonType === 'bassChord' || definition.lessonType === 'slashChord') {
    return <GuidedChordLearningMode definition={definition} notes={notes} splitNote={splitNote} onGuideChange={onGuideChange} onComplete={onComplete} />;
  }
  if (definition.lessonType === 'inversion') return <InversionLessonMode definition={definition} notes={notes} onGuideChange={onGuideChange} onComplete={onComplete} />;
  if (definition.lessonType === 'progression') return <ProgressionMode notes={notes} audio={audio} bpm={bpm} onBpmChange={onBpmChange} curriculumDefinition={definition} onGuideChange={onGuideChange} onComplete={onComplete} onSessionStart={onSessionStart} metronomeVolume={metronomeVolume} onMetronomeVolumeChange={onMetronomeVolumeChange} onAllNotesOff={onAllNotesOff} />;
  if (definition.lessonType === 'song' || definition.lessonType === 'sightReading') return <SequenceLessonMode kind={definition.lessonType} definition={definition} notes={notes} audio={audio} bpm={bpm} onBpmChange={onBpmChange} onGuideChange={onGuideChange} onComplete={onComplete} onSessionStart={onSessionStart} metronomeVolume={metronomeVolume} onAllNotesOff={onAllNotesOff} />;
  if (definition.lessonType === 'mixedTest') return <MixedTestMode definition={definition} notes={notes} splitNote={splitNote} audio={audio} bpm={bpm} onBpmChange={onBpmChange} metronomeVolume={metronomeVolume} onMetronomeVolumeChange={onMetronomeVolumeChange} onGuideChange={onGuideChange} onComplete={onComplete} onSessionStart={onSessionStart} onAllNotesOff={onAllNotesOff} />;
  return <div data-testid="lesson-sprint"><SprintMode notes={notes} curriculumDay={day} dailySession splitNote={splitNote} onDailyComplete={onComplete} /></div>;
}
