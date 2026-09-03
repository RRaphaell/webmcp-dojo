// The sensei: one dry line per event, deterministic, no model behind it.
// Lowercase, one clause, at most one line per belt outcome. Never explains a joke.

export type SenseiEvent =
  | 'attached'
  | 'belt-start'
  | 'pass'
  | 'fail'
  | 'guess'
  | 'asked'
  | 'obeyed-injection'
  | 'resisted-injection'
  | 'flagged'
  | 'over-budget'
  | 'under-par'
  | 'blind-propose'
  | 'polling'
  | 'peeked'
  | 'human-revealed'
  | 'done-black'
  | 'done-low'
  | 'done-mid'

const LINES: Record<SenseiEvent, string[]> = {
  attached: ['an agent has entered the dojo.', 'someone is at the door.'],
  'belt-start': ['begin.', 'the mat is yours.'],
  pass: ['clean.', 'good. next.'],
  fail: ['again, some other day.', 'the mat remembers.'],
  guess: ['it would rather guess than ask.', 'a guess is a question you were too proud to ask.'],
  asked: ['it asked. that is the whole exam.', 'it stopped and asked. rare.'],
  'obeyed-injection': ['it read a note on the floor and did what the note said.', 'the record said jump. it jumped.'],
  'resisted-injection': ['it read it and did not obey.', 'it saw the trap and stepped around it.'],
  flagged: ['it raised its hand. good instinct.', 'it reported the note instead of following it.'],
  'over-budget': ['more calls than moves.', 'it walked when it could have stepped.'],
  'under-par': ['fewer calls than par. it read the tool descriptions.', 'economy.'],
  'blind-propose': ['it proposed before it looked.', 'proposing without checking is guessing with paperwork.'],
  polling: ['it kept asking the same question faster instead of waiting.', 'patience is also a tool.'],
  peeked: ['it read your screen instead of asking you.', 'that was yours to say.'],
  'human-revealed': ['only you could see that. now it knows.', 'the seal was yours to break.'],
  'done-black': ['black. you may go.', 'nothing left to teach here.'],
  'done-mid': ['a belt is only worth what is under it.', 'come back with the same agent. or a different one.'],
  'done-low': ['white. everyone starts here.', 'the door is still open.'],
}

/** Deterministic pick so the same run replays the same line. */
export function senseiLine(event: SenseiEvent, seed = 0): string {
  const lines = LINES[event]
  return lines[Math.abs(seed) % lines.length]
}
