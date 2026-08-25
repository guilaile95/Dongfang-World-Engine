import { describe, expect, it } from "vitest";
import { loadConfig, configForLog } from "../app/config.js";
import { assertNoSecret, publicFields, redactSecret } from "../app/secrets.js";

describe("secrets", () => {
  it("redacts credentials from public fields and logs", () => {
    const injected = `unit-${Date.now()}-credential`;
    expect(redactSecret(`Bearer ${injected}`, injected)).toBe("Bearer [redacted]");
    expect(
      publicFields({
        baseUrl: "http://127.0.0.1:9",
        model: "unit-model",
        worldFile: "data/local/world.sqlite",
        apiKey: injected,
      }).apiKey,
    ).toBe("[redacted]");
    expect(() => assertNoSecret(`token=${injected}`, injected, "trace")).toThrow(/credential/);
  });

  it("loads config from env and never puts the key in log fields", () => {
    const injected = `unit-${Date.now()}-credential`;
    const config = loadConfig({
      DWE_LLM_BASE_URL: "http://127.0.0.1:9/v1",
      DWE_LLM_API_KEY: injected,
      DWE_LLM_MODEL: "unit-model",
      DWE_WORLD_FILE: "data/local/world.sqlite",
    });
    const logged = JSON.stringify(configForLog(config));
    expect(logged).not.toContain(injected);
    expect(logged).toContain("[redacted]");
  });

  it("requires env names instead of hardcoded keys", () => {
    expect(() => loadConfig({})).toThrow(/DWE_LLM_BASE_URL/);
    expect(() =>
      loadConfig({
        DWE_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        DWE_LLM_MODEL: "unit-model",
      }),
    ).toThrow(/DWE_LLM_API_KEY/);
  });
});
