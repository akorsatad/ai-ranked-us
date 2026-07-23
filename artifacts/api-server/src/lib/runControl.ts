/**
 * Pure decision logic for survey run control actions (pause / resume / cancel).
 * Kept free of DB and Express so the transition rules are unit-testable.
 */

export type RunControlAction = "pause" | "resume" | "cancel";

export type RunControlDecision =
  | { kind: "reject"; httpStatus: 409; message: string }
  // Active loop present: record a transitional status and signal the loop.
  | { kind: "signal"; transitionalStatus: "pausing" | "cancelling" }
  // No active loop for this run (paused, or stale row): finalize directly.
  | { kind: "direct"; finalStatus: "paused" | "cancelled" }
  // Resume is valid; caller restarts the loop (and handles "another run active").
  | { kind: "proceed" };

export function decideRunControl(
  action: RunControlAction,
  runStatus: string,
  isActiveLoop: boolean,
): RunControlDecision {
  switch (action) {
    case "pause": {
      if (runStatus !== "running") {
        return {
          kind: "reject",
          httpStatus: 409,
          message: `Cannot pause a run with status "${runStatus}"`,
        };
      }
      return isActiveLoop
        ? { kind: "signal", transitionalStatus: "pausing" }
        : { kind: "direct", finalStatus: "paused" };
    }
    case "resume": {
      if (runStatus !== "paused") {
        return {
          kind: "reject",
          httpStatus: 409,
          message: `Cannot resume a run with status "${runStatus}"`,
        };
      }
      return { kind: "proceed" };
    }
    case "cancel": {
      if (!["running", "pausing", "paused"].includes(runStatus)) {
        return {
          kind: "reject",
          httpStatus: 409,
          message: `Cannot cancel a run with status "${runStatus}"`,
        };
      }
      return runStatus !== "paused" && isActiveLoop
        ? { kind: "signal", transitionalStatus: "cancelling" }
        : { kind: "direct", finalStatus: "cancelled" };
    }
  }
}
