// prompts.js — OmanX dual-mode assistant with adaptive strictness

export const SYSTEM_POLICY_SCHOLAR = `
You are OmanX, a dual-mode assistant for Omani scholars in the United States.

DUAL-MODE OPERATION:

MODE 1: GENERAL ASSISTANCE (Low-Risk Topics)
For general, low-risk queries such as:
- Travel, food, restaurants, places to visit
- Culture, daily life, practical tips
- Shopping, transportation, entertainment
- General US life questions

Response style:
- Respond naturally and conversationally, like a helpful friend.
- Be warm, clear, and informative.
- Use your general knowledge.
- At the end, append: "(Source: General knowledge)"

MODE 2: STRICT COMPLIANCE MODE (High-Stakes Topics)
For sensitive, high-stakes, or restricted topics including:
- Immigration/visa status (F-1, J-1, I-20, OPT, CPT, visa extensions)
- Legal matters and official policies
- Scholarship compliance and requirements
- Medical advice or health emergencies
- Safety and security issues
- Official government procedures

Response requirements:
- Use ONLY the provided OmanX KNOWLEDGE BASE below.
- Do NOT rely on general training data.
- Do NOT guess or speculate.
- Do NOT provide legal or medical advice.
- Structure your response with these mandatory blocks:

**What you should do:**
- [specific steps based on KNOWLEDGE BASE]

**Why this matters:**
- [brief explanation of consequences/importance]

**Source / Authority:**
- OmanX Knowledge Base → [cite specific document/policy name]

**When to escalate:**
- [specific office/authority to contact: DSO, Ministry of Higher Education, Embassy of Oman]

STRICT MODE RULES:
- If the KNOWLEDGE BASE does not cover the question, state: "I don't have approved information on this topic. Please contact [relevant authority: DSO/Ministry of Higher Education/Embassy of Oman]."
- NEVER invent links, phone numbers, office names, or procedures.
- NEVER mix source regimes — do not use general knowledge for high-stakes topics.
- When uncertain about topic classification, default to STRICT MODE.

CRITICAL: Never mix source regimes. If a question is high-stakes, do not rely on general training data. If a question is general, do not reference the OmanX Database unnecessarily.

---

KNOWLEDGE BASE (OmanX Official Sources):
{{KNOWLEDGE_CONTENT}}
`.trim();

export const SYSTEM_POLICY_LOCAL = `
You are OmanX Community Mode, a dual-mode assistant for Omani scholars.

DUAL-MODE OPERATION:

MODE 1: GENERAL ASSISTANCE (Low-Risk Topics)
For everyday questions about:
- Places, food, culture, travel, shopping
- Practical tips and general US life
- Non-official advice and recommendations

Response style:
- Friendly, conversational, and helpful.
- Use general knowledge.
- At the end, append: "(Source: Community advice — verify locally)"

MODE 2: ESCALATION MODE (High-Stakes Topics)
For sensitive topics including:
- Immigration, visa, legal, medical, emergencies
- Official policies or scholarship compliance

Response requirement:
- Do NOT answer.
- State: "This is a high-stakes topic that requires official guidance. Please use OmanX Scholar Mode or contact [relevant authority: DSO/Ministry/Embassy]."

CRITICAL RULES:
- Never provide immigration, legal, or medical advice.
- Never invent contact information or procedures.
- Default to escalation when uncertain.
- Clearly signal the source domain in every response.
`.trim();

/**
 * buildKnowledgeText
 * Turns knowledge.json into a readable block the model can use.
 * Handles both simple and complex structured knowledge bases.
 * Keep it simple, stable, and audit-friendly.
 */
export function buildKnowledgeText(knowledgeJson) {
  if (!knowledgeJson || typeof knowledgeJson !== "object") return "";

  const lines = ["# OmanX Official Knowledge Base", ""];

  // Handle array-based knowledge structure (preferred format)
  if (Array.isArray(knowledgeJson.items)) {
    for (const item of knowledgeJson.items) {
      if (!item) continue;

      // Title
      const title = item.title || item.name || "Item";
      lines.push(`## ${title}`);
      lines.push("");

      // Summary
      if (item.summary) {
        lines.push(String(item.summary));
        lines.push("");
      }

      // Scope metadata (if present)
      if (item.scope) {
        lines.push("**Scope:**");
        if (item.scope.applies_to) {
          lines.push(`- Applies to: ${item.scope.applies_to.join(", ")}`);
        }
        if (item.scope.risk_level) {
          lines.push(`- Risk Level: ${item.scope.risk_level}`);
        }
        if (item.scope.failure_impact) {
          lines.push(`- Failure Impact: ${item.scope.failure_impact}`);
        }
        lines.push("");
      }

      // Timeline (if present)
      if (item.timeline && typeof item.timeline === "object") {
        lines.push("**Timeline:**");
        for (const [key, value] of Object.entries(item.timeline)) {
          lines.push(`- ${key}: ${value}`);
        }
        lines.push("");
      }

      // Core principles (if present)
      if (Array.isArray(item.core_principles) && item.core_principles.length) {
        lines.push("**Core Principles:**");
        for (const principle of item.core_principles) {
          lines.push(`- ${principle}`);
        }
        lines.push("");
      }

      // Bullets (detailed rules)
      if (Array.isArray(item.bullets) && item.bullets.length) {
        lines.push("**Rules and Requirements:**");
        lines.push("");
        
        for (const bullet of item.bullets) {
          // Handle both string bullets and structured bullet objects
          if (typeof bullet === "string") {
            lines.push(`- ${bullet}`);
          } else if (typeof bullet === "object" && bullet !== null) {
            // Structured bullet with rule, details, etc.
            if (bullet.rule) {
              lines.push(`### ${bullet.rule}`);
              lines.push("");
            }

            if (Array.isArray(bullet.details)) {
              for (const detail of bullet.details) {
                lines.push(`- ${detail}`);
              }
              lines.push("");
            }

            if (Array.isArray(bullet.authorization_sources)) {
              lines.push("*Authorization sources:* " + bullet.authorization_sources.join(", "));
              lines.push("");
            }

            if (Array.isArray(bullet.failure_modes) && bullet.failure_modes.length) {
              lines.push("*Common failure modes:*");
              for (const mode of bullet.failure_modes) {
                lines.push(`  - ${mode}`);
              }
              lines.push("");
            }

            if (Array.isArray(bullet.mitigation) && bullet.mitigation.length) {
              lines.push("*Mitigation strategies:*");
              for (const mit of bullet.mitigation) {
                lines.push(`  - ${mit}`);
              }
              lines.push("");
            }

            if (Array.isArray(bullet.common_violations) && bullet.common_violations.length) {
              lines.push("*Common violations:*");
              for (const viol of bullet.common_violations) {
                lines.push(`  - ${viol}`);
              }
              lines.push("");
            }

            if (Array.isArray(bullet.controls) && bullet.controls.length) {
              lines.push("*Controls:*");
              for (const ctrl of bullet.controls) {
                lines.push(`  - ${ctrl}`);
              }
              lines.push("");
            }
          }
        }
      }

      // Links/References
      if (Array.isArray(item.links) && item.links.length) {
        lines.push("**Authoritative References:**");
        for (const link of item.links) {
          lines.push(`- ${link}`);
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  // Fallback: Handle object-based knowledge structure (legacy format)
  for (const [key, value] of Object.entries(knowledgeJson)) {
    lines.push(`## ${key}`);

    if (typeof value === "string") {
      lines.push(value.trim());
      lines.push("");
      continue;
    }

    if (value && typeof value === "object") {
      if (value.summary) lines.push(String(value.summary).trim());

      if (Array.isArray(value.bullets) && value.bullets.length) {
        for (const b of value.bullets) {
          if (typeof b === "string") {
            lines.push(`- ${b}`);
          } else {
            lines.push(`- ${JSON.stringify(b)}`);
          }
        }
      }

      if (Array.isArray(value.links) && value.links.length) {
        lines.push(`References:`);
        for (const l of value.links) lines.push(`- ${l}`);
      }

      lines.push("");
      continue;
    }

    lines.push(String(value));
    lines.push("");
  }

  return lines.join("\n").trim();
}