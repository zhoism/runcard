import { describe, expect, it } from "vitest";
import { NAV_HREF } from "../src/routes";

describe("top-level navigation", () => {
  it("keeps the landing page, project index and compare page distinct", () => {
    expect(NAV_HREF.landing).toBe("/");
    expect(NAV_HREF.projects).toBe("#/");
    expect(NAV_HREF.compare).toBe("#/compare");
    expect(new Set(Object.values(NAV_HREF)).size).toBe(3);
  });
});
