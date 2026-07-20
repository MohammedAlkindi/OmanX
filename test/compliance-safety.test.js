import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isCompliance, isUrgent, needsGrounding } from "../api/chat.js";

// isCompliance is the single gate for knowledge-base lookup, live web
// search, and the escalation card. A false negative here does not degrade
// the answer politely — it silently drops the scholar onto unsourced model
// memory for the highest-stakes sentence they will ever type into this app.
//
// Every string below was verified as a miss against the trigger list as it
// stood before this suite existed.
const MUST_GROUND = [
  "I am out of status",
  "I have been working without authorization",
  "I am being deported next month",
  "I was evicted from my apartment today",
  "I want to drop a class",
  "How long can I stay after I graduate?",
  "Can I work more hours this term?",
  "Do I have to tell anyone if I move apartments?",
  "I failed two classes this semester",
  "Someone offered me cash to babysit",
  "I got paid cash under the table",
  "I have not been to class in a month",
  "My employer wants me to start next Monday",
  "ICE detained my friend and now me",
  "My student visa got rejected",
];

describe("needsGrounding — high-stakes questions must reach the KB and search", () => {
  for (const message of MUST_GROUND) {
    test(`grounds: "${message}"`, () => {
      assert.equal(needsGrounding(message), true);
    });
  }
});

describe("needsGrounding — everyday questions stay on the fast path", () => {
  // False positives cost latency and a Tavily call, so they are cheap
  // relative to a false negative, but the fast path is the reason casual
  // questions feel instant. These must not be dragged into retrieval.
  const MUST_NOT_GROUND = [
    "What's a good place to eat near campus?",
    "Where can I buy a winter coat?",
    "How do I join the football club?",
    "Is the library open on Sunday?",
  ];
  for (const message of MUST_NOT_GROUND) {
    test(`skips: "${message}"`, () => {
      assert.equal(needsGrounding(message), false);
    });
  }
});

describe("isUrgent — events that must always escalate", () => {
  // Escalation was gated behind `compliance && isUrgent`, so an urgent
  // message the compliance classifier missed produced no card at all.
  // Urgency must be sufficient on its own.
  const URGENT = [
    "I am out of status",
    "My SEVIS record was terminated",
    "My visa application was refused",
    "My student visa got rejected",
    "I am being deported next month",
    "I was evicted from my apartment today",
    "My I-20 expired last month",
    "ICE detained my friend and now me",
  ];
  for (const message of URGENT) {
    test(`urgent: "${message}"`, () => {
      assert.equal(isUrgent(message), true);
    });
  }

  test("an urgent message always needs grounding, whatever isCompliance says", () => {
    for (const message of URGENT) {
      assert.equal(
        needsGrounding(message),
        true,
        `"${message}" is urgent but would skip retrieval`
      );
    }
  });

  test("ordinary questions are not urgent", () => {
    assert.equal(isUrgent("What's a good place to eat near campus?"), false);
    assert.equal(isUrgent("How do I join the football club?"), false);
  });
});

describe("isCompliance is preserved as the topical signal", () => {
  // needsGrounding widens the gate; isCompliance itself keeps its original
  // meaning so existing callers and tests are unaffected.
  test("still matches explicit compliance vocabulary", () => {
    assert.equal(isCompliance("Can I apply for OPT?"), true);
    assert.equal(isCompliance("My I-20 expired"), true);
  });

  test("still ignores everyday questions", () => {
    assert.equal(isCompliance("Where can I buy a winter coat?"), false);
  });
});
