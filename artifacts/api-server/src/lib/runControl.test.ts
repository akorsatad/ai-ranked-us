import { describe, it, expect } from "vitest";
import { decideRunControl } from "./runControl";

describe("decideRunControl — pause", () => {
  it("signals an active running loop (running → pausing)", () => {
    expect(decideRunControl("pause", "running", true)).toEqual({
      kind: "signal",
      transitionalStatus: "pausing",
    });
  });

  it("pauses a stale running row directly when no loop is active", () => {
    expect(decideRunControl("pause", "running", false)).toEqual({
      kind: "direct",
      finalStatus: "paused",
    });
  });

  it.each(["pausing", "paused", "cancelling", "cancelled", "completed", "failed", "partial"])(
    "rejects pausing a %s run",
    (status) => {
      const d = decideRunControl("pause", status, true);
      expect(d.kind).toBe("reject");
    },
  );
});

describe("decideRunControl — resume", () => {
  it("allows resuming a paused run (paused → running)", () => {
    expect(decideRunControl("resume", "paused", false)).toEqual({ kind: "proceed" });
  });

  it.each(["running", "pausing", "cancelling", "cancelled", "completed", "failed", "partial"])(
    "rejects resuming a %s run",
    (status) => {
      const d = decideRunControl("resume", status, false);
      expect(d.kind).toBe("reject");
    },
  );
});

describe("decideRunControl — cancel", () => {
  it("signals an active running loop (running → cancelling)", () => {
    expect(decideRunControl("cancel", "running", true)).toEqual({
      kind: "signal",
      transitionalStatus: "cancelling",
    });
  });

  it("signals an active pausing loop (pausing → cancelling)", () => {
    expect(decideRunControl("cancel", "pausing", true)).toEqual({
      kind: "signal",
      transitionalStatus: "cancelling",
    });
  });

  it("cancels a paused run directly (paused → cancelled)", () => {
    expect(decideRunControl("cancel", "paused", false)).toEqual({
      kind: "direct",
      finalStatus: "cancelled",
    });
  });

  it("cancels a stale running row directly when no loop is active", () => {
    expect(decideRunControl("cancel", "running", false)).toEqual({
      kind: "direct",
      finalStatus: "cancelled",
    });
  });

  it.each(["cancelling", "cancelled", "completed", "failed", "partial"])(
    "rejects cancelling a %s run",
    (status) => {
      const d = decideRunControl("cancel", status, false);
      expect(d.kind).toBe("reject");
    },
  );
});
