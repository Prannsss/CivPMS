import { describe, expect, it } from "vitest";
import { greetingName } from "./greeting-name";

describe("greetingName", () => {
  it.each([
    ["Juan Dela Cruz", "Juan"],
    ["  Maria   Santos ", "Maria"],
    ["Engr. Juan Dela Cruz", "Juan"],
    ["ARCH. Maria Santos", "Maria"],
    ["Atty Ana Villanueva", "Ana"],
    ["Ma'am Liza Soberano", "Liza"],
    ["[FOUND] Ian Inspector", "Ian"],
    ["(QA) Paolo Reyes", "Paolo"],
    ["Paolo", "Paolo"],
    ["Engr.", "Engr."],
    ["", ""],
  ])("greets %j as %j", (name, expected) => {
    expect(greetingName(name)).toBe(expected);
  });
});
