import { describe, expect, it } from 'vitest';
import { confirmSpans, leadConfirmed } from './hysteresis';

/**
 * The state machine has two callers — correlation regimes and the band signals
 * — and until this file existed it was tested only through them. That is not
 * the same thing: a caller's tests pin what that caller happens to exercise,
 * and this module's whole purpose is to be shared by callers that do not yet
 * exist.
 */

/** Compact fixtures: 'a'/'b'/'c' are states, one character per observation. */
const from = (pattern: string): string[] => [...pattern];
const stateOf = (item: string): string => item;
const shape = (pattern: string, confirmDays: number) =>
  confirmSpans(from(pattern), stateOf, confirmDays).map(
    (span) => `${span.state}:${span.startIdx}-${span.endIdx}`,
  );

describe('confirmSpans', () => {
  it('is empty for an empty series', () => {
    expect(confirmSpans([], stateOf, 3)).toEqual([]);
  });

  it('is one span for a single observation', () => {
    expect(shape('a', 3)).toEqual(['a:0-0']);
  });

  it('is one span when nothing ever changes', () => {
    expect(shape('aaaaaa', 3)).toEqual(['a:0-5']);
  });

  it('needs exactly confirmDays consecutive readings, not one fewer', () => {
    // Two b's against confirmDays 3: not enough, so the series stays one span.
    expect(shape('aaaabb', 3)).toEqual(['a:0-5']);
    expect(shape('aaaabbb', 3)).toEqual(['a:0-3', 'b:4-6']);
  });

  it('dates the switch at the first confirming reading, not the last', () => {
    // The third b confirms it; the span starts at the first b, index 4.
    const spans = confirmSpans(from('aaaabbb'), stateOf, 3);
    expect(spans[1]?.startIdx).toBe(4);
    expect(spans[1]?.confirmedIdx).toBe(4);
  });

  it('resets a run on any reading back inside the incumbent state', () => {
    // b,b,a,b,b never gives three consecutive b's.
    expect(shape('aaabbabb', 3)).toEqual(['a:0-7']);
  });

  it('resets a run when a third state interrupts it', () => {
    // b,b,c,b,b is not three consecutive b's either — and c's own run is
    // one long, so nothing is confirmed.
    expect(shape('aaabbcbb', 3)).toEqual(['a:0-7']);
  });

  it('handles back-to-back confirmed switches', () => {
    expect(shape('aaabbbccc', 3)).toEqual(['a:0-2', 'b:3-5', 'c:6-8']);
  });

  it('returns to a previous state as a new span, not a resumed one', () => {
    expect(shape('aaabbbaaa', 3)).toEqual(['a:0-2', 'b:3-5', 'a:6-8']);
  });

  it('covers every index exactly once, with no gaps or overlaps', () => {
    // The property that matters for any caller summing observations.
    const pattern = 'aabbbccbbbaaacccbbb';
    const spans = confirmSpans(from(pattern), stateOf, 3);
    expect(spans[0]?.startIdx).toBe(0);
    expect(spans[spans.length - 1]?.endIdx).toBe(pattern.length - 1);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.startIdx).toBe((spans[i - 1]?.endIdx ?? -1) + 1);
    }
  });

  it('switches on every change when confirmDays is 1', () => {
    expect(shape('aabba', 1)).toEqual(['a:0-1', 'b:2-3', 'a:4-4']);
  });

  it('emits confirmedIdx equal to startIdx, for callers to move', () => {
    // classifyRegimes pulls startIdx earlier when it absorbs an unconfirmed
    // opening span, and reads its mean from confirmedIdx. They start equal.
    for (const span of confirmSpans(from('aaabbb'), stateOf, 3)) {
      expect(span.confirmedIdx).toBe(span.startIdx);
    }
  });
});

describe('leadConfirmed', () => {
  const spans = (pattern: string, confirmDays: number) =>
    confirmSpans(from(pattern), stateOf, confirmDays);

  it('is false for an opening span shorter than confirmDays', () => {
    const series = from('abbbb');
    const [lead] = spans('abbbb', 3);
    expect(lead && leadConfirmed(series, lead, stateOf, 3)).toBe(false);
  });

  it('is true when the opening readings all agree with the span', () => {
    const series = from('aaabbb');
    const [lead] = spans('aaabbb', 3);
    expect(lead && leadConfirmed(series, lead, stateOf, 3)).toBe(true);
  });

  it('is false when the span is long but its opening readings are not', () => {
    // This is the case length alone cannot catch: the span is seeded from one
    // reading and runs long, but was never confirmed at its own start.
    // 'abababbbb' with confirmDays 4: the lead 'a' span is long, yet its first
    // four readings are a,b,a,b.
    const series = from('abababaaaa');
    const [lead] = spans('abababaaaa', 4);
    expect(lead?.state).toBe('a');
    expect(lead && lead.endIdx - lead.startIdx + 1).toBeGreaterThanOrEqual(4);
    expect(lead && leadConfirmed(series, lead, stateOf, 4)).toBe(false);
  });

  it('is true for a span of exactly confirmDays agreeing readings', () => {
    const series = from('aaabbbb');
    const [lead] = spans('aaabbbb', 3);
    expect(lead && leadConfirmed(series, lead, stateOf, 3)).toBe(true);
  });
});
