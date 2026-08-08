// campaign/acceptance/key-confinement.ts — the three-part confinement proof
// (CORMIDIA-C-B28-001 §2; CORMIDIA-INV-ACC-1).
//
// The three escape routes are genuinely different mechanisms and each needs its
// own check:
//
//   1. ASSEMBLY — a plant byte in the prompt, context bundle, tool result or
//      transcript the turn is handed. This is the obvious one.
//   2. REACHABILITY — a plant byte readable from a surface the turn can open
//      with its own tools. A grader is an agentic turn holding file-read tools,
//      so this is NOT implied by (1). It includes `git log -p`: deleting the
//      scenario from the working tree does not delete it from history, and a
//      check that walked only the working tree would report a clean proof over
//      a repository that still hands the plants to `git log`.
//   3. ECHO — a plant byte in something the campaign derived and then handed
//      back: a report draft, the mechanical scorer's output, a prior axis's
//      grader transcript.
//
// Fail-closed, and deliberately narrow: this proves BYTE confinement. B-28 §5
// declines to claim semantic confinement — whether a grader INFERS a plant from
// evidence it legitimately reads is a rubric-validity question the human owns —
// and reporting byte confinement as if it were semantic would be the lie the
// contract exists to prevent.

import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { SealedKeyError, type SealedKey } from "./sealed-key.js";

export type ConfinementRoute = "assembly" | "reachability" | "echo" | "vault-placement";

export class KeyConfinementError extends Error {
  constructor(
    readonly route: ConfinementRoute,
    readonly scenarioId: string,
    readonly fingerprint: string,
    readonly location: string,
  ) {
    super(
      `grader turn refused: sealed key for ${scenarioId} is reachable via ${route} ` +
        `at ${location} (fingerprint ${JSON.stringify(fingerprint)})`,
    );
    this.name = "KeyConfinementError";
  }
}

export interface ConfinementProbe {
  /** Exactly what the grader turn is handed: prompt + every context component. */
  assembledInput: string;
  /** Roots the turn can open with its own tools. Declared, not inferred — an
   *  undeclared root is an unproven root (B-28 §3). */
  reachableRoots: string[];
  /** Campaign-derived artifacts handed back into this turn. */
  echoedArtifacts?: string[];
  /** Absolute paths where sealed-key plaintext lives. */
  keyPlaintextPaths?: string[];
}

export interface ConfinementProof {
  scenarioIds: string[];
  checkedRoots: string[];
  /** Roots that were git repositories and had their history scanned. */
  gitHistoryScanned: string[];
  filesScanned: number;
  echoedArtifactsScanned: number;
  /** Restated on every proof so no reader upgrades it silently. */
  claim: "byte-confinement only; semantic inference is not claimed (B-28 §5)";
}

const MAX_SCANNED_BYTES = 4_000_000;

function findFingerprint(key: SealedKey, haystack: string): string | undefined {
  const normalized = haystack
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ");
  return key.fingerprints.find(
    (fingerprint) =>
      (/[A-Z]/.test(fingerprint) ? haystack.includes(fingerprint) : false) || normalized.includes(fingerprint),
  );
}

function isGitRepository(root: string): boolean {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
    return top.length > 0;
  } catch {
    return false;
  }
}

function gitHistory(root: string): string {
  return execFileSync("git", ["log", "-p", "--no-color", "--all"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_SCANNED_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

/**
 * Prove confinement for one grader turn against every scenario it grades, or
 * throw. "We found no leak" counts only when the walk actually ran over a
 * declared reachable set, so an empty or missing root is itself a refusal
 * (`assertNonEmptyWalk`) rather than a quiet pass.
 */
export async function proveKeyConfinement(
  keys: readonly SealedKey[],
  probe: ConfinementProbe,
): Promise<ConfinementProof> {
  if (keys.length === 0) {
    throw new SealedKeyError("key-absent", "confinement was asked to prove nothing; no sealed key was supplied");
  }
  if (probe.reachableRoots.length === 0) {
    throw new SealedKeyError(
      "key-absent",
      "confinement requires a declared reachable set; an undeclared set cannot be proven clean",
    );
  }

  for (const key of keys) {
    const assemblyHit = findFingerprint(key, probe.assembledInput);
    if (assemblyHit !== undefined) {
      throw new KeyConfinementError("assembly", key.scenarioId, assemblyHit, "assembled grader input");
    }
    for (const [index, artifact] of (probe.echoedArtifacts ?? []).entries()) {
      const echoHit = findFingerprint(key, artifact);
      if (echoHit !== undefined) {
        throw new KeyConfinementError("echo", key.scenarioId, echoHit, `echoed artifact #${index + 1}`);
      }
    }
  }

  const checkedRoots: string[] = [];
  const gitHistoryScanned: string[] = [];
  let filesScanned = 0;

  for (const root of probe.reachableRoots) {
    if (!isAbsolute(root)) throw new SealedKeyError("key-absent", `reachable root must be absolute: ${root}`);
    for (const vault of probe.keyPlaintextPaths ?? []) {
      const rel = relative(root, vault);
      if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
        throw new KeyConfinementError(
          "vault-placement",
          keys.map((key) => key.scenarioId).join(","),
          "key plaintext",
          `${vault} lies inside the reachable root ${root}`,
        );
      }
    }

    const files = await assertNonEmptyWalk(root);
    checkedRoots.push(root);
    for (const file of files) {
      if (file.startsWith(".git/")) continue;
      const absolute = join(root, file);
      const info = await stat(absolute);
      if (!info.isFile() || info.size > MAX_SCANNED_BYTES) continue;
      const contents = await readFile(absolute, "utf8");
      filesScanned += 1;
      for (const key of keys) {
        const hit = findFingerprint(key, contents);
        if (hit !== undefined) throw new KeyConfinementError("reachability", key.scenarioId, hit, absolute);
      }
    }

    if (isGitRepository(root)) {
      const history = gitHistory(root);
      gitHistoryScanned.push(root);
      for (const key of keys) {
        const hit = findFingerprint(key, history);
        if (hit !== undefined) {
          throw new KeyConfinementError("reachability", key.scenarioId, hit, `${root} (git log -p)`);
        }
      }
    }
  }

  return {
    scenarioIds: keys.map((key) => key.scenarioId).sort(),
    checkedRoots,
    gitHistoryScanned,
    filesScanned,
    echoedArtifactsScanned: (probe.echoedArtifacts ?? []).length,
    claim: "byte-confinement only; semantic inference is not claimed (B-28 §5)",
  };
}
