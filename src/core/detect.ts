/**
 * Deterministic inspection of an incoming request.
 *
 * No LLM involved — these facts drive both the hard-constraint filters and the
 * Input-Token-Count feature.
 */

import { encode } from "gpt-tokenizer";
import type { ChatCompletionRequest, ChatMessage } from "../types.js";

const CHARS_PER_TOKEN = 4;

/** Tokenize with gpt-tokenizer (pure-JS, offline); fall back to a char estimate. */
function tokenCount(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.floor(text.length / CHARS_PER_TOKEN);
  }
}

function texts(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const msg of messages) {
    const content = msg.content;
    if (typeof content === "string") {
      out.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part.text === "string") out.push(part.text);
      }
    }
  }
  return out;
}

export function countInputTokens(req: ChatCompletionRequest): number {
  const messages = req.messages ?? [];
  const parts = texts(messages);
  let total = 0;
  for (const t of parts) total += tokenCount(t);
  return total + 4 * messages.length;
}

function hasImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === "image_url" || p.type === "input_image"),
  );
}

function hasAudio(req: ChatCompletionRequest): boolean {
  if (req.modalities?.includes("audio")) return true;
  return (req.messages ?? []).some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === "input_audio" || p.type === "audio"),
  );
}

function needsStructuredOutput(req: ChatCompletionRequest): boolean {
  const t = req.response_format?.type;
  return t === "json_object" || t === "json_schema";
}

export interface Requirements {
  requiresVision: boolean;
  requiresTools: boolean;
  requiresStructuredOutput: boolean;
  requiresAudio: boolean;
}

export function detectRequirements(req: ChatCompletionRequest): Requirements {
  return {
    requiresVision: hasImage(req.messages ?? []),
    requiresTools: Boolean(
      (req.tools && req.tools.length) || (req.functions && req.functions.length),
    ),
    requiresStructuredOutput: needsStructuredOutput(req),
    requiresAudio: hasAudio(req),
  };
}
