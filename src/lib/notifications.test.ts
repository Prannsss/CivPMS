import { describe, expect, it } from "vitest";
import { isNotificationRow, normalizeTimestamp, safeNotificationLink, toNotificationRecord } from "./notifications";

describe("safeNotificationLink", () => {
  it("follows same-app paths only", () => {
    expect(safeNotificationLink("/projects/1")).toBe("/projects/1");
    expect(safeNotificationLink("//evil.example/x")).toBeNull();
    expect(safeNotificationLink("/\\evil.example")).toBeNull();
    expect(safeNotificationLink("https://evil.example")).toBeNull();
    expect(safeNotificationLink(null)).toBeNull();
  });
});

describe("normalizeTimestamp", () => {
  it("formats PostgREST and Realtime timestamps the same way", () => {
    expect(normalizeTimestamp("2026-10-13T06:30:02.560533+00:00")).toBe("2026-10-13T06:30:02.560Z");
    expect(normalizeTimestamp("2026-10-13 14:30:02.56+08")).toBe("2026-10-13T06:30:02.560Z");
    expect(normalizeTimestamp("not a date")).toBe("not a date");
  });
});

describe("toNotificationRecord", () => {
  it("maps a row and reads the payload snapshot", () => {
    const record = toNotificationRecord({
      id: "n1",
      type: "project_status_changed",
      title: "Cebu is now On-Hold",
      body: "  ",
      link: "https://evil.example",
      project_id: null,
      payload: { project_id: "p1", project_name: "Cebu", to: "on_hold" },
      read_at: null,
      created_at: "2026-10-13T06:30:02.560533+00:00",
    });
    expect(record).toEqual({
      id: "n1",
      type: "project_status_changed",
      title: "Cebu is now On-Hold",
      body: null,
      link: null,
      projectId: "p1",
      projectName: "Cebu",
      statusTo: "on_hold",
      readAt: null,
      createdAt: "2026-10-13T06:30:02.560Z",
    });
  });

  it("tolerates a missing or non-object payload", () => {
    const record = toNotificationRecord({
      id: "n2",
      type: "member_joined",
      title: "Paolo joined",
      body: "Paolo Reyes joined Dela Cruz Builders.",
      link: "/",
      project_id: "p9",
      payload: null,
      read_at: "2026-10-13T07:00:00+00:00",
      created_at: "2026-10-13T06:00:00+00:00",
    });
    expect(record.projectId).toBe("p9");
    expect(record.projectName).toBeNull();
    expect(record.readAt).toBe("2026-10-13T07:00:00.000Z");
  });
});

describe("isNotificationRow", () => {
  it("accepts Realtime records with the required columns only", () => {
    expect(isNotificationRow({ id: "n1", type: "x", title: "t", created_at: "2026-10-13T06:00:00Z" })).toBe(true);
    expect(isNotificationRow({ id: "n1", type: "x" })).toBe(false);
    expect(isNotificationRow(null)).toBe(false);
    expect(isNotificationRow([])).toBe(false);
  });
});
