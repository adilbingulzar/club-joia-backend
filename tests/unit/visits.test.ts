import { describe, expect, it } from "vitest";
import { pageLabel, sourceLabel, visitSeries, visitsCsv } from "@/lib/sales/visits";

const NOW = new Date("2026-11-21T08:00:00Z");

describe("website visits report", () => {
  it("names the website's pages and sources, and keeps unknown ones as they are", () => {
    expect(pageLabel("/")).toBe("Home");
    expect(pageLabel("/preregister")).toBe("Pre-registration");
    expect(pageLabel("/new-page")).toBe("/new-page");
    expect(sourceLabel("linkedin")).toBe("LinkedIn");
    expect(sourceLabel("news.example.org")).toBe("news.example.org");
  });

  it("fills every day of the range, from the first visit to today without one", () => {
    const days = [
      { day: "2026-11-19", visitors: 3, pageViews: 7 },
      { day: "2026-11-21", visitors: 1, pageViews: 1 },
    ];
    expect(visitSeries(days, "", "", NOW).map((d) => [d.day, d.visitors, d.pageViews])).toEqual([
      ["2026-11-19", 3, 7],
      ["2026-11-20", 0, 0],
      ["2026-11-21", 1, 1],
    ]);
    expect(visitSeries(days, "2026-11-20", "2026-11-20", NOW).map((d) => d.visitors)).toEqual([0]);
  });

  it("makes the daily report CSV with a column per source and page that had any", () => {
    const text = visitsCsv([
      { day: "2026-11-20", visitors: 2, pageViews: 5, sources: { instagram: 1, direct: 1 }, pages: { "/": 2, "/tickets": 3 } },
      { day: "2026-11-21", visitors: 1, pageViews: 1, sources: { instagram: 1 }, pages: { "/": 1 } },
    ]);
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe('Day (Dubai),Visitors,Page views,Visitors from Instagram,"Visitors from Direct (typed in, bookmark or app)",Views of Home,Views of Tickets');
    expect(lines[1]).toBe("2026-11-20,2,5,1,1,2,3");
    expect(lines[2]).toBe("2026-11-21,1,1,1,0,1,0");
  });
});
