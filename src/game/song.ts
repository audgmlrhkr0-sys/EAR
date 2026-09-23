/**
 * The song the sea lost. Six phrases in D major, two bars each — every puzzle
 * piece holds exactly one, and only played back in order do they make the
 * whole melody.
 */

export const BPM = 72;
export const BEAT = 60 / BPM;

/** [note name or rest, length in beats] */
export type Note = [string | null, number];
/** [root with octave, quality, length in beats] */
export type Chord = [string, 'maj' | 'min', number];

export type Phrase = {
  title: string;
  line: string;
  color: string;
  melody: Note[];
  chords: Chord[];
};

export const PHRASES: Phrase[] = [
  {
    title: '첫 번째 조각 · 숨',
    line: '누군가, 아직도 숨을 쉬고 있었다.',
    color: '#caa0ab',
    melody: [['F#5', 1], ['A5', 1], ['D6', 1.5], ['C#6', 0.5], ['B5', 1], ['A5', 1], ['F#5', 2]],
    chords: [['D3', 'maj', 4], ['B2', 'min', 4]],
  },
  {
    title: '두 번째 조각 · 물풀',
    line: '오래전 흥얼거리다, 물속으로 삼켜진 노래.',
    color: '#5f8f7f',
    melody: [['G5', 1], ['B5', 1], ['D6', 1], ['E6', 1], ['C#6', 1.5], ['B5', 0.5], ['A5', 2]],
    chords: [['G2', 'maj', 4], ['A2', 'maj', 4]],
  },
  {
    title: '세 번째 조각 · 진주',
    line: '닫힌 조개 속에서도, 노래는 썩지 않았다.',
    color: '#9c8ec2',
    melody: [['F#5', 0.5], ['G5', 0.5], ['A5', 1], ['D6', 1], ['F#6', 1.5], ['E6', 0.5], ['D6', 1], ['C#6', 2]],
    chords: [['D3', 'maj', 4], ['F#2', 'min', 4]],
  },
  {
    title: '네 번째 조각 · 해파리',
    line: '빛이 흔들릴 때마다, 무언가 숫자를 세고 있었다.',
    color: '#6fa0b8',
    melody: [['B5', 1], ['D6', 1], ['G6', 1.5], ['F#6', 0.5], ['E6', 1], ['C#6', 1], ['A5', 2]],
    chords: [['G2', 'maj', 4], ['A2', 'maj', 4]],
  },
  {
    title: '다섯 번째 조각 · 잠긴 기둥',
    line: '가라앉은 것들은 잊지 않는다. 기다릴 뿐.',
    color: '#b6935f',
    melody: [['B5', 1], ['C#6', 0.5], ['D6', 0.5], ['F#6', 2], ['E6', 1], ['D6', 0.5], ['B5', 0.5], ['G5', 2]],
    chords: [['B2', 'min', 4], ['G2', 'maj', 4]],
  },
  {
    title: '여섯 번째 조각 · 고래의 뼈',
    line: '가장 깊은 곳에서, 마지막 음이 아직도 기다리고 있다.',
    color: '#8a4a5c',
    melody: [['E5', 1], ['G5', 1], ['B5', 1], ['D6', 1], ['C#6', 1], ['E6', 1], ['D6', 2]],
    chords: [['E2', 'min', 4], ['A2', 'maj', 2], ['D3', 'maj', 2]],
  },
];

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]!]! + acc;
}

export function midiFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteFreq(name: string): number {
  return midiFreq(noteMidi(name));
}

/** Open add9 voicings an octave above the root — soft, unresolved, watery. */
export function chordFreqs(chord: Chord): number[] {
  const root = noteMidi(chord[0]) + 12;
  const third = chord[1] === 'maj' ? 4 : 3;
  return [0, third, 7, 14].map((iv) => midiFreq(root + iv));
}

/** Harp-like arpeggio tones for a chord, low to high. */
export function arpFreqs(chord: Chord): number[] {
  const root = noteMidi(chord[0]) + 12;
  const third = chord[1] === 'maj' ? 4 : 3;
  return [0, 7, 12, 12 + third + 12].map((iv) => midiFreq(root + iv));
}

export function phraseBeats(p: Phrase): number {
  return p.melody.reduce((s, n) => s + n[1], 0);
}
