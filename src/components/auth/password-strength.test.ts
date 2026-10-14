import { describe, expect, it } from "vitest";
import { passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("asks for a password, then for the missing length", () => {
    expect(passwordStrength("")).toMatchObject({ score: 0, tone: "neutral" });
    expect(passwordStrength("short")).toMatchObject({ score: 1, label: "Too short", hint: "Add 5 more characters." });
    expect(passwordStrength("123456789").hint).toBe("Add 1 more character.");
  });

  it("flags common words and keyboard patterns", () => {
    expect(passwordStrength("password12345")).toMatchObject({ score: 2, label: "Easy to guess" });
    expect(passwordStrength("abcdefghijkl")).toMatchObject({ score: 2, label: "Easy to guess" });
    expect(passwordStrength("aaaaaaaaaaaa")).toMatchObject({ score: 2, label: "Easy to guess" });
  });

  it("grades by length and variety", () => {
    expect(passwordStrength("bridgepiers")).toMatchObject({ score: 2, label: "Fair" });
    expect(passwordStrength("bridgepier7s")).toMatchObject({ score: 3, label: "Good" });
    expect(passwordStrength("Bridge-Pier7s")).toMatchObject({ score: 4, label: "Strong" });
    expect(passwordStrength("mango bridge harbor")).toMatchObject({ score: 4, label: "Strong" });
  });
});
