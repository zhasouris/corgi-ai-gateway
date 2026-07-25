/**
 * Generation-parameter compatibility — the temperature routing constraint.
 *
 * A request with a non-default `temperature` must never route to a model that
 * only accepts temperature=1 (the OpenAI o-series), which would 400. Keyed on an
 * explicit `fixedTemperature` catalog flag, NOT the `reasoning` capability —
 * non-OpenAI reasoning models accept a custom temperature.
 */

import { describe, expect, it } from "vitest";
import { detectRequirements } from "../src/core/detect.js";
import { temperatureConstraint } from "../src/core/constraints.js";
import { defaultClassifierResult, type RequestAnalysis } from "../src/types.js";
import { makeModel, makeRequest } from "./helpers.js";

const analysis: RequestAnalysis = {
  inputTokens: 10,
  classifier: defaultClassifierResult(),
  features: {},
  signalProvider: "stub",
};

describe("temperature detection", () => {
  it("flags a non-default temperature (0 or any other value)", () => {
    expect(detectRequirements({ temperature: 0 }).requiresCustomTemperature).toBe(true);
    expect(detectRequirements({ temperature: 0.7 }).requiresCustomTemperature).toBe(true);
  });

  it("does not flag the default (1) or an unset temperature", () => {
    expect(detectRequirements({ temperature: 1 }).requiresCustomTemperature).toBe(false);
    expect(detectRequirements({}).requiresCustomTemperature).toBe(false);
  });
});

describe("temperature constraint", () => {
  const oSeries = makeModel("o4-mini", { caps: ["reasoning"] });
  oSeries.fixedTemperature = true;
  const chat = makeModel("gpt-4.1-nano", {}); // no fixedTemperature
  const otherReasoning = makeModel("deepseek-reasoner", { caps: ["reasoning"] }); // reasoning, not fixed

  it("excludes only fixed-temperature models when a custom temperature is set", () => {
    const req = { ...makeRequest(), requiresCustomTemperature: true };
    expect(temperatureConstraint.admits(oSeries, req, analysis)).toBe(false);
    expect(temperatureConstraint.admits(chat, req, analysis)).toBe(true);
    // a reasoning model that is NOT o-series still accepts a custom temperature.
    expect(temperatureConstraint.admits(otherReasoning, req, analysis)).toBe(true);
  });

  it("admits every model when the temperature is default/unset", () => {
    const req = makeRequest(); // requiresCustomTemperature undefined
    expect(temperatureConstraint.admits(oSeries, req, analysis)).toBe(true);
    expect(temperatureConstraint.admits(chat, req, analysis)).toBe(true);
  });
});
