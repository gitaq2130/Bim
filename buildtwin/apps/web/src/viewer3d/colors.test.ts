import { describe, expect, it } from "vitest";
import { colorForState, STATE_COLORS, STATE_LABELS_KO } from "./colors";
import { OBJECT_STATES, type ObjectState } from "./types";

describe("colors", () => {
  it("every ObjectState has a colour and a Korean label", () => {
    for (const st of OBJECT_STATES) {
      expect(STATE_COLORS[st]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(STATE_LABELS_KO[st]).toBeTruthy();
    }
    expect(Object.keys(STATE_COLORS).sort()).toEqual([...OBJECT_STATES].sort());
  });

  it("matches the agent contract colour map", () => {
    const expected: Record<ObjectState, string> = {
      PLANNED: "#9E9E9E",
      REPORTED: "#FFD600",
      IN_PROGRESS: "#FFD600",
      ESTIMATED_DONE: "#AEEA00",
      CONFIRMED: "#00C853",
      MISMATCH: "#D50000",
      UNVERIFIABLE: "#AA00FF",
      INSPECTION_REQUESTED: "#FF6D00",
    };
    expect(STATE_COLORS).toEqual(expected);
  });

  it("falls back to PLANNED for unknown/undefined", () => {
    expect(colorForState(undefined)).toBe(STATE_COLORS.PLANNED);
    expect(colorForState(null)).toBe(STATE_COLORS.PLANNED);
    expect(colorForState("CONFIRMED")).toBe("#00C853");
  });
});
