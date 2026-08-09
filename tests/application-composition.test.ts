import { describe, expect, it } from "vitest";
import { operaiApplication } from "../apps/operai/src/application";
import { studioApplication } from "../apps/studio/src/application";

describe("application composition", () => {
  it("keeps Studio and OperAI state isolated while sharing the same framework locale", () => {
    expect(studioApplication.storageNamespace).not.toBe(operaiApplication.storageNamespace);
    expect(studioApplication.localeMessages).toEqual(operaiApplication.localeMessages);
    expect(studioApplication.localeMessages[studioApplication.titleKey]).toBe("SynAIus Studio");
    expect(operaiApplication.localeMessages[operaiApplication.titleKey]).toBe("SynAIus OperAI");
  });
});
