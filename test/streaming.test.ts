/**
 * Tent-pole test #15 — streaming is relayed incrementally, not buffered;
 * [DONE] passes through; the stream ends cleanly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config.js";
import { Forwarder } from "../src/providers/forwarder.js";

const enc = new TextEncoder();
const CHUNKS = [
  'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
  "data: [DONE]\n\n",
].map((s) => enc.encode(s));

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const out: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.push(value);
  }
  return out;
}

describe("streaming", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("relays upstream chunks incrementally", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(streamOf(CHUNKS), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    const forwarder = new Forwarder(getConfig());
    const upstream = await forwarder.forward({
      provider: "openai",
      body: { model: "gpt-4.1-nano", messages: [], stream: true },
      incomingHeaders: {},
      stream: true,
    });

    expect(upstream.stream).toBeTruthy();
    const received = await collect(upstream.stream!);

    // More than one chunk => actually streamed, not buffered into one blob.
    expect(received.length).toBeGreaterThanOrEqual(2);
    const joined = Buffer.concat(received).toString("utf-8");
    expect(joined).toContain("[DONE]");
    expect(joined).toBe(CHUNKS.map((c) => Buffer.from(c).toString("utf-8")).join(""));
  });
});
