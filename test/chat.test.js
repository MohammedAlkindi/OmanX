import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectDestination, isCompliance, searchKB } from "../api/chat.js";

describe("detectDestination", () => {
  test("defaults to US when no destination signals are present", () => {
    assert.equal(detectDestination("", "Where can I find cheap groceries near campus?"), "us");
  });

  test("detects UK from explicit UK-specific terms", () => {
    assert.equal(detectDestination("", "My UKVI student route visa is expiring soon."), "uk");
    assert.equal(detectDestination("", "I need to check my BRP and tier 4 conditions."), "uk");
  });

  test("detects AU from explicit AU-specific terms", () => {
    assert.equal(detectDestination("", "Does my subclass 500 visa let me work part-time?"), "au");
    assert.equal(detectDestination("", "My OSHC coverage renewal is due."), "au");
  });

  test("reads destination signals from userContext as well as message", () => {
    assert.equal(detectDestination("Study destination: Australia.", "Can I keep working?"), "au");
  });

  test("is case-insensitive", () => {
    assert.equal(detectDestination("", "MY UKVI STUDENT ROUTE IS EXPIRING"), "uk");
  });

  test("UK terms take priority when both UK and AU terms are present", () => {
    // detectDestination checks UK triggers before AU triggers, so a message
    // mentioning both should resolve to UK, not AU.
    assert.equal(detectDestination("", "Comparing UKVI student route vs subclass 500 rules."), "uk");
  });
});

describe("isCompliance", () => {
  test("returns false for empty or missing input", () => {
    assert.equal(isCompliance(""), false);
    assert.equal(isCompliance(undefined), false);
  });

  test("returns false for an everyday, non-compliance question", () => {
    assert.equal(isCompliance("What's a good place to eat near campus this weekend?"), false);
  });

  test("returns true for messages containing compliance vocabulary", () => {
    assert.equal(isCompliance("Can I work off-campus on my F-1 visa?"), true);
    assert.equal(isCompliance("My scholarship funding was cut, what do I do?"), true);
    assert.equal(isCompliance("Do I need insurance for a hospital visit?"), true);
  });

  test("matches UK- and AU-specific compliance vocabulary", () => {
    assert.equal(isCompliance("My UKVI student route conditions changed."), true);
    assert.equal(isCompliance("Is OSHC required for my subclass 500 visa?"), true);
  });

  test("is case-insensitive", () => {
    assert.equal(isCompliance("WHAT ABOUT MY VISA STATUS?"), true);
  });
});

describe("searchKB", () => {
  const kb = {
    metadata: { version: "test" },
    documents: [
      { id: "VISA-1", title: "F-1 Visa Work Rules", summary: "Rules for off-campus employment and OPT authorization for F-1 students." },
      { id: "HOUSING-1", title: "Off-Campus Housing Guide", summary: "Tips for finding apartments, comparing leases, and budgeting for rent near campus." },
    ],
  };

  test("returns an empty array when the knowledge base is missing", () => {
    assert.deepEqual(searchKB(null, "visa question"), []);
  });

  test("returns an empty array when there are no documents", () => {
    assert.deepEqual(searchKB({ metadata: {}, documents: [] }, "visa question"), []);
  });

  test("keyword phase matches explicit compliance vocabulary shared by query and document", () => {
    const results = searchKB(kb, "Can I keep my OPT work authorization on an F-1 visa?");
    assert.ok(results.length > 0);
    assert.equal(results[0].id, "VISA-1");
  });

  test("keyword phase does not match documents with no shared compliance vocabulary", () => {
    const results = searchKB(kb, "Can I keep my OPT work authorization on an F-1 visa?");
    assert.ok(!results.some((r) => r.id === "HOUSING-1"));
  });

  test("TF-IDF fallback surfaces a relevant document for a paraphrased query with no trigger words", () => {
    // "budgeting for rent" and "apartments" overlap with HOUSING-1's content
    // but contain no COMPLIANCE_TRIGGERS terms, so phase 1 finds nothing and
    // phase 2 (TF-IDF) should still surface the housing document.
    const results = searchKB(kb, "How should I budget for rent when comparing apartments?");
    assert.ok(results.some((r) => r.id === "HOUSING-1"));
  });

  test("supports the legacy flat-object knowledge base format", () => {
    const legacyKb = {
      metadata: { version: "legacy" },
      "VISA-LEGACY": { title: "Visa Rules", content: "F-1 visa OPT work authorization details." },
    };
    const results = searchKB(legacyKb, "What are the F-1 visa OPT rules?");
    assert.ok(results.some((r) => r.id === "VISA-LEGACY"));
  });

  test("caps results at 3 documents", () => {
    const manyDocs = {
      documents: Array.from({ length: 6 }, (_, i) => ({
        id: `VISA-${i}`,
        summary: "F-1 visa OPT work authorization rules.",
      })),
    };
    const results = searchKB(manyDocs, "What are my F-1 visa OPT options?");
    assert.ok(results.length <= 3);
  });
});
