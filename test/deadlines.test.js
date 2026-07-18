import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeDeadlines } from "../public/js/deadlines.js";

// All tests inject `today` so results stay deterministic forever rather than
// passing until a real date rolls over.
const TODAY = "2026-07-18";

function ids(list) {
  return list.map((d) => d.id);
}

describe("computeDeadlines — OPT window (US F-1)", () => {
  test("opens exactly 90 days before the program end date", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-10-16", // TODAY + 90
      today: TODAY,
    });
    const opens = out.find((d) => d.id === "us-opt-window-opens");
    assert.ok(opens, "expected us-opt-window-opens");
    assert.equal(opens.date, "2026-07-18");
    assert.equal(opens.daysUntil, 0);
  });

  test("closes exactly 60 days after the program end date", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-08-01",
      today: TODAY,
    });
    const closes = out.find((d) => d.id === "us-opt-window-closes");
    assert.ok(closes, "expected us-opt-window-closes");
    assert.equal(closes.date, "2026-09-30");
  });
});

describe("computeDeadlines — grace periods differ by visa type", () => {
  test("F-1 gets 60 days after program end", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-08-01",
      today: TODAY,
    });
    const grace = out.find((d) => d.id === "us-grace-period-ends");
    assert.ok(grace);
    assert.equal(grace.date, "2026-09-30");
  });

  test("J-1 gets 30 days after program end, not 60", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "j1",
      programEndDate: "2026-08-01",
      today: TODAY,
    });
    const grace = out.find((d) => d.id === "us-grace-period-ends-j1");
    assert.ok(grace, "expected J-1 grace rule");
    assert.equal(grace.date, "2026-08-31");
    assert.equal(
      out.find((d) => d.id === "us-grace-period-ends"),
      undefined,
      "F-1 60-day grace must not leak into a J-1 profile"
    );
  });

  test("visa-type-specific rules are withheld when visa type is unset", () => {
    // Showing a 60-day F-1 grace period to an unidentified visa holder who is
    // actually on J-1 would be a harmful wrong date. Withhold instead.
    const out = computeDeadlines({
      destination: "us",
      visaType: "",
      programEndDate: "2026-08-01",
      today: TODAY,
    });
    assert.equal(out.find((d) => d.id === "us-grace-period-ends"), undefined);
    assert.equal(out.find((d) => d.id === "us-grace-period-ends-j1"), undefined);
  });
});

describe("computeDeadlines — destination gating", () => {
  test("UK rules never appear for a US scholar", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-08-01",
      visaExpiryDate: "2026-09-01",
      today: TODAY,
    });
    assert.ok(!ids(out).some((id) => id.startsWith("uk-")));
    assert.ok(!ids(out).some((id) => id.startsWith("au-")));
  });

  test("UK scholar gets the Graduate Route reminder before visa expiry", () => {
    const out = computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2026-09-01",
      today: TODAY,
    });
    const grad = out.find((d) => d.id === "uk-graduate-route");
    assert.ok(grad);
    assert.equal(grad.date, "2026-08-02"); // 30 days before expiry
  });

  test("AU scholar gets both the 6-month planning and pre-expiry 485 reminders", () => {
    const out = computeDeadlines({
      destination: "au",
      visaExpiryDate: "2026-12-01",
      today: TODAY,
    });
    assert.ok(ids(out).includes("au-485-plan"));
    assert.ok(ids(out).includes("au-485-apply"));
  });

  test("an unset destination yields only destination-agnostic rules", () => {
    // 'auto' means we genuinely do not know where they are. Guessing US and
    // showing OPT dates to a UK student would be worse than showing nothing.
    const out = computeDeadlines({
      destination: "auto",
      visaType: "f1",
      programEndDate: "2026-08-01",
      visaExpiryDate: "2026-09-01",
      today: TODAY,
    });
    assert.deepEqual(ids(out), ["visa-expiry"]);
  });
});

describe("computeDeadlines — urgency tiers", () => {
  const cases = [
    { offset: -5, expected: "passed" },
    { offset: 0, expected: "urgent" },
    { offset: 30, expected: "urgent" },
    { offset: 31, expected: "soon" },
    { offset: 90, expected: "soon" },
    { offset: 91, expected: "upcoming" },
  ];

  for (const { offset, expected } of cases) {
    test(`${offset} days out is "${expected}"`, () => {
      const base = new Date(Date.UTC(2026, 6, 18) + offset * 86400000);
      const iso = base.toISOString().slice(0, 10);
      const out = computeDeadlines({ destination: "uk", visaExpiryDate: iso, today: TODAY });
      const item = out.find((d) => d.id === "visa-expiry");
      assert.ok(item, `expected visa-expiry at offset ${offset}`);
      assert.equal(item.urgency, expected);
      assert.equal(item.daysUntil, offset);
    });
  }
});

describe("computeDeadlines — horizon filtering", () => {
  test("drops deadlines beyond the horizon", () => {
    const out = computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2030-01-01",
      today: TODAY,
      horizonDays: 180,
    });
    assert.deepEqual(out, []);
  });

  test("keeps a recently passed deadline inside the look-back window", () => {
    const out = computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2026-07-08", // 10 days ago
      today: TODAY,
    });
    const item = out.find((d) => d.id === "visa-expiry");
    assert.ok(item, "a 10-day-old expiry should still surface");
    assert.equal(item.urgency, "passed");
  });

  test("drops deadlines older than the look-back window", () => {
    const out = computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2026-01-01",
      today: TODAY,
    });
    assert.deepEqual(out, []);
  });
});

describe("computeDeadlines — open windows survive the look-back filter", () => {
  // A window that has opened and not yet shut is live guidance, not a missed
  // cutoff, so it must not be dropped the way a passed deadline is.
  test("OPT filing window stays visible months after it opened", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-09-01", // window opened 2026-06-03, ~45 days ago
      today: TODAY,
    });
    const opens = out.find((d) => d.id === "us-opt-window-opens");
    assert.ok(opens, "OPT window opened 45 days ago and is still open — must show");
    assert.equal(opens.urgency, "open");
  });

  test("OPT window disappears once it has actually closed", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-01-01", // closed 2026-03-02, long past
      today: TODAY,
    });
    assert.equal(out.find((d) => d.id === "us-opt-window-opens"), undefined);
  });

  test("AU planning reminder stays open until the visa expires", () => {
    const out = computeDeadlines({
      destination: "au",
      visaExpiryDate: "2026-12-01", // 6-month mark was 2026-06-04
      today: TODAY,
    });
    const plan = out.find((d) => d.id === "au-485-plan");
    assert.ok(plan, "planning window is open until visa expiry");
    assert.equal(plan.urgency, "open");
  });

  test("a passed hard cutoff is still dropped outside the look-back window", () => {
    // Guard against the open-window exception swallowing the normal rule.
    const out = computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2026-01-01",
      today: TODAY,
    });
    assert.deepEqual(out, []);
  });
});

describe("computeDeadlines — ordering and citations", () => {
  test("results are sorted by date ascending", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-09-01",
      visaExpiryDate: "2026-11-01",
      today: TODAY,
    });
    const dates = out.map((d) => d.date);
    assert.deepEqual(dates, [...dates].sort(), "expected ascending date order");
  });

  test("every deadline carries a non-empty official source URL", () => {
    const out = computeDeadlines({
      destination: "us",
      visaType: "f1",
      programEndDate: "2026-09-01",
      visaExpiryDate: "2026-11-01",
      today: TODAY,
    });
    assert.ok(out.length > 0, "fixture should produce deadlines");
    for (const d of out) {
      assert.ok(d.sourceUrl && d.sourceUrl.startsWith("https://"), `${d.id} missing sourceUrl`);
      assert.ok(d.sourceTitle, `${d.id} missing sourceTitle`);
      assert.ok(d.action, `${d.id} missing confirm-with-official action`);
    }
  });
});

describe("computeDeadlines — robustness", () => {
  test("returns [] and does not throw on empty input", () => {
    assert.deepEqual(computeDeadlines({}), []);
    assert.deepEqual(computeDeadlines({ today: TODAY }), []);
  });

  test("returns [] and does not throw on malformed dates", () => {
    const bad = ["not-a-date", "2026-13-45", "", null, undefined, 12345, {}];
    for (const value of bad) {
      assert.doesNotThrow(() => computeDeadlines({
        destination: "us",
        visaType: "f1",
        programEndDate: value,
        visaExpiryDate: value,
        today: TODAY,
      }), `threw on ${JSON.stringify(value)}`);
      assert.deepEqual(
        computeDeadlines({ destination: "us", visaType: "f1", programEndDate: value, today: TODAY }),
        [],
        `expected [] for ${JSON.stringify(value)}`
      );
    }
  });

  test("a malformed today falls back to no results rather than throwing", () => {
    assert.doesNotThrow(() => computeDeadlines({
      destination: "uk",
      visaExpiryDate: "2026-08-01",
      today: "garbage",
    }));
  });

  test("is timezone-stable: dates do not shift with the host timezone", () => {
    const original = process.env.TZ;
    const results = [];
    for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "Asia/Muscat"]) {
      process.env.TZ = tz;
      results.push(
        computeDeadlines({
          destination: "us",
          visaType: "f1",
          programEndDate: "2026-09-01",
          today: TODAY,
        }).map((d) => `${d.id}:${d.date}:${d.daysUntil}`)
      );
    }
    process.env.TZ = original;
    for (const r of results.slice(1)) {
      assert.deepEqual(r, results[0], "deadline dates shifted with host timezone");
    }
  });
});
