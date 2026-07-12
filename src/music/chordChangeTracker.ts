export interface ChordChangeState {
  expectedIndex: 0 | 1;
  armed: boolean;
  score: number;
}

export function initialChordChangeState(): ChordChangeState {
  return { expectedIndex: 0, armed: true, score: 0 };
}

export function advanceChordChange(state: ChordChangeState, expectedIsExact: boolean): ChordChangeState {
  if (expectedIsExact && state.armed) {
    return { expectedIndex: state.expectedIndex === 0 ? 1 : 0, armed: false, score: state.score + 1 };
  }
  if (!expectedIsExact && !state.armed) return { ...state, armed: true };
  return state;
}
