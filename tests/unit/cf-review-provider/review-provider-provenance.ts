// CF-REVIEW-PROVIDER / HB-133 current-state provenance detector.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectValidationAuthority } from "../../fixtures/validation-authority.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Surface = "source" | "caseCatalog" | "backlog" | "ownerBacklog" | "operatorRunbook" | "policy";

interface ProvenancePin {
  surface: Surface;
  label: string;
  required: readonly string[];
  forbidden: string;
}

interface ProvenanceSurfaces {
  text: Record<Surface, string>;
}

const PINS: readonly ProvenancePin[] = [
  {
    surface: "source",
    label: "production refusal",
    required: [
      "[simulated], provisional interpretation pending real-human ratification",
      "interpretation pending human ratification); refusing before provider construction",
    ],
    forbidden: "rev-2026-08-10 owner ruling",
  },
  {
    surface: "caseCatalog",
    label: "case catalog",
    required: ["provisional interpretation pending human ratification", "not an owner ruling"],
    forbidden: "stakeholder ruling: the review-identity decision controls",
  },
  {
    surface: "backlog",
    label: "HB-133 backlog",
    required: ["pending-ratification simulated interpretation", "this is not an owner ruling"],
    forbidden: "pending-ratification seat ruling",
  },
  {
    surface: "ownerBacklog",
    label: "HB-133 owner backlog",
    required: ["[simulated], provisional interpretation pending human ratification", "not an owner ruling"],
    forbidden: "pending-ratification seat ruling",
  },
  {
    surface: "operatorRunbook",
    label: "operator triage",
    required: [
      "Implemented provisional interpretation — CF-REVIEW-PROVIDER/HB-133",
      "[simulated], provisional, and pending human ratification",
      "explicitly not an owner ruling",
    ],
    forbidden: "Pending-ratification territory — CF-REVIEW-PROVIDER/HB-133 (TODO)",
  },
  {
    surface: "policy",
    label: "validation policy",
    required: [
      "[simulated], provisional interpretation pending human",
      "confirmation — explicitly not an owner ruling",
    ],
    forbidden: "owner ruling [simulated], pending human confirmation",
  },
];

function normalized(value: string): string {
  return value.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
}

function readSurfaces(): ProvenanceSurfaces {
  const read = (...path: string[]): string => readFileSync(join(repoRoot, ...path), "utf8");
  const authority = selectValidationAuthority(repoRoot);
  return {
    text: {
      source: read("src", "loop", "review-provider.ts"),
      caseCatalog: read("validation-design", "case-catalog.md"),
      backlog: read("validation-design", "harness-backlog.md"),
      ownerBacklog: read("validation-design", "owner-backlog.md"),
      operatorRunbook: read("validation-design", "operator-triage-runbook.md"),
      policy:
        authority.kind === "model"
          ? read("validation-design", "migration", "legacy", "validation-policy.yaml")
          : read("validation-design", "validation-policy.yaml"),
    },
  };
}

function auditProvenance(surfaces: ProvenanceSurfaces): string[] {
  const problems: string[] = [];
  for (const pin of PINS) {
    const text = normalized(surfaces.text[pin.surface]);
    for (const required of pin.required) {
      if (!text.includes(normalized(required))) problems.push(`${pin.label} lacks required provenance: ${required}`);
    }
    if (text.includes(normalized(pin.forbidden))) problems.push(`${pin.label} retains false ruling attribution`);
  }
  return problems;
}

function consistentFixture(): ProvenanceSurfaces {
  return {
    text: {
      source: PINS.find((pin) => pin.surface === "source")?.required.join("\n") ?? "",
      caseCatalog: PINS.find((pin) => pin.surface === "caseCatalog")?.required.join("\n") ?? "",
      backlog: PINS.find((pin) => pin.surface === "backlog")?.required.join("\n") ?? "",
      ownerBacklog: PINS.find((pin) => pin.surface === "ownerBacklog")?.required.join("\n") ?? "",
      operatorRunbook: PINS.find((pin) => pin.surface === "operatorRunbook")?.required.join("\n") ?? "",
      policy: PINS.find((pin) => pin.surface === "policy")?.required.join("\n") ?? "",
    },
  };
}

export function registerReviewProviderProvenanceTests(): void {
  describe("CF-REVIEW-PROVIDER — provisional provenance closure", () => {
    it("keeps every current provider-family surface simulated, provisional, and pending-human", () => {
      expect(auditProvenance(readSurfaces())).toEqual([]);
    });

    it("has a non-vacuous consistent fixture", () => {
      expect(auditProvenance(consistentFixture())).toEqual([]);
    });

    it.each(PINS)("seeded false-ruling attribution in $label fires", (pin) => {
      const seeded = consistentFixture();
      seeded.text[pin.surface] = pin.forbidden;
      expect(auditProvenance(seeded)).toContain(`${pin.label} retains false ruling attribution`);
    });
  });
}
