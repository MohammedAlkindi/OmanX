import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getClientIp, getRateLimitKey, sanitizeSessionId } from "../api/_rate-limit.js";

// `remoteAddress: null` models a request with no usable socket address.
// Passing `undefined` would silently re-apply the default parameter.
function req({ headers = {}, remoteAddress = "203.0.113.10" } = {}) {
  return { headers, socket: { remoteAddress: remoteAddress ?? undefined } };
}

describe("getRateLimitKey — anonymous bucketing", () => {
  // The anonymous quota is the only thing standing between the public
  // internet and metered Claude spend. sessionId arrives in the request
  // body, so if it can select the bucket, an abuser rotates it and the
  // quota is unbounded.
  test("a rotating client sessionId cannot mint a fresh bucket", () => {
    const r = req();
    const first = getRateLimitKey(r, "aaaaaaaaaaaaaaaa");
    const second = getRateLimitKey(r, "bbbbbbbbbbbbbbbb");
    const third = getRateLimitKey(r, "");
    assert.equal(first, second, "different sessionIds from one IP must share a bucket");
    assert.equal(first, third, "dropping the sessionId must not change the bucket either");
  });

  test("distinct IPs still get distinct buckets", () => {
    const a = getRateLimitKey(req({ headers: { "x-forwarded-for": "198.51.100.1" } }), "s1");
    const b = getRateLimitKey(req({ headers: { "x-forwarded-for": "198.51.100.2" } }), "s1");
    assert.notEqual(a, b);
  });

  test("the key never embeds the raw IP or sessionId", () => {
    const key = getRateLimitKey(req({ headers: { "x-forwarded-for": "198.51.100.7" } }), "session-abc");
    assert.ok(!key.includes("198.51.100.7"), "raw IP must be hashed");
    assert.ok(!key.includes("session-abc"), "raw sessionId must not appear");
  });

  test("falls back to the session bucket only when no IP is available", () => {
    const anonymous = req({ headers: {}, remoteAddress: null });
    const withSession = getRateLimitKey(anonymous, "cccccccccccccccc");
    const withoutSession = getRateLimitKey(anonymous, "");
    assert.ok(withSession.startsWith("session:"), "should bucket by session when IP is unknown");
    assert.equal(withoutSession, "ip:unknown");
  });
});

describe("getClientIp — proxy header trust", () => {
  // x-forwarded-for is client-writable. Vercel sets x-vercel-forwarded-for
  // at its edge and it cannot be spoofed by the caller, so it must win.
  test("prefers the platform-set header over a spoofed x-forwarded-for", () => {
    const ip = getClientIp(req({
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-vercel-forwarded-for": "198.51.100.9",
      },
    }));
    assert.equal(ip, "198.51.100.9");
  });

  test("falls back to x-forwarded-for when no platform header is present", () => {
    assert.equal(getClientIp(req({ headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" } })), "198.51.100.4");
  });

  test("falls back to the socket address when no proxy headers are present", () => {
    assert.equal(getClientIp(req({ headers: {} })), "203.0.113.10");
  });

  test("returns 'unknown' rather than throwing when nothing identifies the caller", () => {
    assert.equal(getClientIp({ headers: {} }), "unknown");
  });
});

describe("sanitizeSessionId", () => {
  test("strips characters outside the safe alphabet and caps length", () => {
    assert.equal(sanitizeSessionId("abc-123"), "abc-123");
    assert.equal(sanitizeSessionId("abc<script>"), "abcscript");
    assert.equal(sanitizeSessionId("x".repeat(200)).length, 64);
  });

  test("returns an empty string for non-string input", () => {
    assert.equal(sanitizeSessionId(undefined), "");
    assert.equal(sanitizeSessionId(42), "");
  });
});
