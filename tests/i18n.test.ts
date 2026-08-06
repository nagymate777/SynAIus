import { describe, expect, it } from "vitest";
import { createTranslator } from "@synaius/i18n";

describe("translations", () => {
  it("replaces named parameters and exposes missing keys", () => {
    const t = createTranslator({ item: "{count} elem" });
    expect(t("item", { count: 3 })).toBe("3 elem");
    expect(t("missing.key")).toBe("missing.key");
  });
});
