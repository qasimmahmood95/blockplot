/**
 * Confirmation hysteresis: turning a noisy per-observation classification into
 * spans that mean something.
 *
 * A threshold crossing is not a state change. Measured on the committed data,
 * a bare band test gives the 90d volatility series 9 "regimes" in a year and
 * the drawdown series **42** — noise presented as structure, and a headline
 * that would contradict itself every other day. Requiring a candidate to hold
 * for `confirmDays` consecutive observations before it unseats the incumbent
 * collapses those to 4 and 4.
 *
 * The boundary is then dated at the *first* of the confirming observations,
 * because that is when the change began, not when it became certain. The cost
 * is that the final `confirmDays - 1` observations of a series cannot start a
 * span, which is the honest position: a fortnight of data cannot tell you a
 * state has turned.
 *
 * This machine was written for correlation regimes in `regimes.ts` and lived
 * there alone. Volatility bands and drawdown bands need exactly the same
 * treatment, so it moved here rather than being implemented a second time —
 * three copies of a state machine is three places for the off-by-one to differ.
 * `classifyRegimes` is now a caller and keeps its own domain rules (absorbing
 * an unconfirmed opening span, averaging the correlation); nothing about its
 * output changed, which its unedited tests are the proof of.
 */

export interface ConfirmedSpan<S> {
  state: S;
  /**
   * First observation of the span. May be earlier than `confirmedIdx` when a
   * caller extends a span backwards — see `classifyRegimes`.
   */
  startIdx: number;
  /**
   * Where this state was actually confirmed. Equal to `startIdx` as emitted
   * here; callers that absorb a neighbouring span move `startIdx` and leave
   * this alone, so a summary statistic can still be taken over the part of the
   * span that earned the label.
   */
  confirmedIdx: number;
  /** Last observation of the span, inclusive. */
  endIdx: number;
}

/**
 * Split a series into confirmed spans of whatever `stateOf` returns.
 *
 * The series must be in ascending order of whatever its x is — every dataset
 * the pipeline produces is date-ascending. `confirmDays` counts observations,
 * not calendar days; on a daily series they are the same thing, and every
 * series here is daily.
 *
 * The opening span is seeded from the first observation alone, because there is
 * no history to confirm it against. That makes it the one span a caller cannot
 * take at face value: `leadConfirmed` in `regimes.ts` is how that is handled
 * there, and any new caller needs its own answer rather than assuming this
 * function provides one.
 */
export function confirmSpans<T, S extends string>(
  series: readonly T[],
  stateOf: (item: T) => S,
  confirmDays: number,
): ConfirmedSpan<S>[] {
  const first = series[0];
  if (!first) return [];

  const spans: ConfirmedSpan<S>[] = [];
  const emit = (state: S, startIdx: number, endIdx: number): void => {
    if (endIdx >= startIdx) spans.push({ state, startIdx, confirmedIdx: startIdx, endIdx });
  };

  let current = stateOf(first);
  let segmentStart = 0;
  // The candidate trying to unseat `current`, and where its run began.
  let pending: S | null = null;
  let pendingStart = 0;
  let pendingCount = 0;

  for (let i = 1; i < series.length; i++) {
    const item = series[i];
    if (item === undefined) continue;
    const instant = stateOf(item);
    if (instant === current) {
      // A single reading back inside the incumbent state breaks the run:
      // confirmation must be consecutive or it is not confirmation.
      pending = null;
      pendingCount = 0;
      continue;
    }
    if (instant === pending) {
      pendingCount += 1;
    } else {
      pending = instant;
      pendingStart = i;
      pendingCount = 1;
    }
    if (pendingCount >= confirmDays) {
      emit(current, segmentStart, pendingStart - 1);
      current = instant;
      segmentStart = pendingStart;
      pending = null;
      pendingCount = 0;
    }
  }
  emit(current, segmentStart, series.length - 1);
  return spans;
}

/**
 * Whether the opening span was ever actually confirmed.
 *
 * Length alone is not enough. The first span is seeded from a single reading,
 * so a series like [0.9, -0.9, 0, -0.9] yields one long span on the strength of
 * its first value. A leading span counts as confirmed only if its first
 * `confirmDays` readings all agree with its state — the same standard every
 * later switch has to meet.
 */
export function leadConfirmed<T, S extends string>(
  series: readonly T[],
  span: ConfirmedSpan<S>,
  stateOf: (item: T) => S,
  confirmDays: number,
): boolean {
  if (span.endIdx - span.startIdx + 1 < confirmDays) return false;
  for (let i = span.startIdx; i < span.startIdx + confirmDays; i++) {
    const item = series[i];
    if (item === undefined || stateOf(item) !== span.state) return false;
  }
  return true;
}
