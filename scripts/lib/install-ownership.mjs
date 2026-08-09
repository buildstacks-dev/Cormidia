import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { PACKAGED_BINARIES, PACKAGED_SKILLS, resolveProviderSkillHomes } from "./link-artifacts.mjs";

async function observe(path) {
  try {
    const info = await lstat(path);
    const type = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
    const rawLink = type === "symlink" ? await readlink(path) : undefined;
    return {
      type,
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      rawLink,
      resolvedLink: rawLink === undefined ? undefined : resolve(dirname(path), rawLink),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { type: "absent" };
    throw error;
  }
}

async function packageIdentity(root) {
  const entry = await observe(root);
  if (entry.type === "absent") return { state: "absent", entry };
  if (entry.type !== "directory") {
    return { state: "foreign", entry, evidence: `${entry.type} at package root` };
  }
  try {
    const bytes = await readFile(join(root, "package.json"), "utf8");
    const value = JSON.parse(bytes);
    const expectedBins = Object.fromEntries(
      PACKAGED_BINARIES.map((binary) => [binary.name, `./${binary.packagedLauncher}`]),
    );
    const actualBins = value?.bin;
    const validBins =
      actualBins !== null &&
      typeof actualBins === "object" &&
      Object.keys(actualBins).length === Object.keys(expectedBins).length &&
      Object.entries(expectedBins).every(([name, launcher]) => actualBins[name] === launcher);
    const valid = value?.name === "cormidia" && typeof value.version === "string" && validBins;
    if (!valid) {
      return {
        state: "foreign",
        entry,
        evidence: `package.json identity is name=${JSON.stringify(value?.name)} version=${JSON.stringify(value?.version)}`,
      };
    }
    return {
      state: "packaged",
      entry,
      version: value.version,
      evidence: `package.json name=cormidia version=${value.version} bin=${Object.keys(expectedBins).join(",")}`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { state: "foreign", entry, evidence: `unreadable Cormidia package identity: ${reason}` };
  }
}

function packageRootFrom(resolvedLink, suffix) {
  const normalizedSuffix = `${sep}${suffix.split("/").join(sep)}`;
  return resolvedLink.endsWith(normalizedSuffix) ? resolvedLink.slice(0, -normalizedSuffix.length) : undefined;
}

async function otherSourceCheckout(resolvedLink, sourceRoot, sourceSuffixes) {
  for (const suffix of sourceSuffixes) {
    const root = packageRootFrom(resolvedLink, suffix);
    if (root === undefined || resolve(root) === resolve(sourceRoot)) continue;
    if (root.includes(`${sep}node_modules${sep}cormidia`)) continue;
    if ((await observe(resolvedLink)).type === "absent") continue;
    const identity = await packageIdentity(root);
    if (identity.state === "packaged") return { root, version: identity.version };
  }
  return undefined;
}

async function linkArtifact({
  kind,
  label,
  target,
  intendedSource,
  sourceRoot,
  sourceSources,
  sourceSuffixes,
  packageSuffix,
  installedPackage,
}) {
  const entry = await observe(target);
  if (entry.type === "absent") return { kind, label, target, state: "absent", evidence: "path is absent", entry };
  if (entry.type !== "symlink") {
    return {
      kind,
      label,
      target,
      state: "foreign",
      evidence: `${entry.type}; device=${entry.dev} inode=${entry.ino} size=${entry.size}`,
      entry,
    };
  }

  const evidence = `symlink ${entry.rawLink} -> ${entry.resolvedLink}; device=${entry.dev} inode=${entry.ino}`;
  if (entry.resolvedLink === resolve(intendedSource)) {
    const state = installedPackage.state === "foreign" ? "foreign" : "packaged";
    return { kind, label, target, state, evidence: `${evidence}; exact installed Cormidia target`, entry };
  }
  if (sourceSources.some((source) => entry.resolvedLink === resolve(source))) {
    return { kind, label, target, state: "source", evidence: `${evidence}; exact source-checkout target`, entry };
  }

  const ownerRoot = packageRootFrom(entry.resolvedLink, packageSuffix);
  if (ownerRoot !== undefined && ownerRoot.includes(`${sep}node_modules${sep}cormidia`)) {
    const owner = await packageIdentity(ownerRoot);
    if (owner.state === "packaged" || owner.state === "absent") {
      const ownerEvidence =
        owner.state === "packaged"
          ? `Cormidia package ${owner.version} at ${ownerRoot}`
          : `exact Cormidia npm path signature at missing package root ${ownerRoot}`;
      return { kind, label, target, state: "prior-install", evidence: `${evidence}; ${ownerEvidence}`, entry };
    }
  }
  const otherSource = await otherSourceCheckout(entry.resolvedLink, sourceRoot, sourceSuffixes);
  if (otherSource !== undefined) {
    return {
      kind,
      label,
      target,
      state: "foreign",
      evidence:
        `${evidence}; verified other Cormidia source checkout cormidia@${otherSource.version} at ${otherSource.root}; ` +
        "ownership is checkout-scoped because this may be another active dev loop",
      entry,
    };
  }
  return { kind, label, target, state: "foreign", evidence, entry };
}

function binarySources(packageRoot, binary) {
  return [join(packageRoot, binary.localLauncher), ...binary.migrateFrom.map((path) => join(packageRoot, path))];
}

async function nextMoveAsidePath(path) {
  const base = `${path}.before-cormidia`;
  if ((await observe(base)).type === "absent") return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if ((await observe(candidate)).type === "absent") return candidate;
  }
  throw new Error(`cannot find an unused move-aside path for ${path}`);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function inspectInstall({ globalBin, installedRoot, packageRoot, pathDirs, env = process.env }) {
  const installedPackage = await packageIdentity(installedRoot);
  const packageArtifact = {
    kind: "package",
    label: "cormidia package root",
    target: installedRoot,
    state: installedPackage.state,
    evidence: installedPackage.evidence ?? "path is absent",
    entry: installedPackage.entry,
  };
  const artifacts = [packageArtifact];
  const normalizedGlobalBin = resolve(globalBin);
  const beforeGlobal = [];
  for (const directory of [...new Set(pathDirs.map((path) => resolve(path)))]) {
    if (directory === normalizedGlobalBin) break;
    beforeGlobal.push(directory);
  }

  for (const binary of PACKAGED_BINARIES) {
    const intendedSource = join(installedRoot, binary.packagedLauncher);
    const sourceSources = binarySources(packageRoot, binary);
    artifacts.push(
      await linkArtifact({
        kind: "binary",
        label: binary.name,
        target: join(globalBin, binary.name),
        intendedSource,
        sourceRoot: packageRoot,
        sourceSources,
        sourceSuffixes: [binary.localLauncher, ...binary.migrateFrom],
        packageSuffix: binary.packagedLauncher,
        installedPackage,
      }),
    );
    for (const directory of beforeGlobal) {
      const target = join(directory, binary.name);
      const artifact = await linkArtifact({
        kind: "shadow",
        label: `${binary.name} PATH shadow`,
        target,
        intendedSource,
        sourceRoot: packageRoot,
        sourceSources,
        sourceSuffixes: [binary.localLauncher, ...binary.migrateFrom],
        packageSuffix: binary.packagedLauncher,
        installedPackage,
      });
      if (artifact.state !== "absent") artifacts.push(artifact);
    }
  }

  for (const skill of PACKAGED_SKILLS) {
    const intendedSource = join(installedRoot, "agent-skills", skill);
    for (const [provider, home] of resolveProviderSkillHomes(env)) {
      artifacts.push(
        await linkArtifact({
          kind: "skill",
          label: `$${skill} (${provider})`,
          target: join(home, "skills", skill),
          intendedSource,
          sourceRoot: packageRoot,
          sourceSources: [join(packageRoot, "agent-skills", skill)],
          sourceSuffixes: [`agent-skills/${skill}`],
          packageSuffix: `agent-skills/${skill}`,
          installedPackage,
        }),
      );
    }
  }

  const conflicts = artifacts.filter(
    (artifact) => artifact.state === "foreign" || (artifact.kind === "shadow" && artifact.state !== "source"),
  );
  const sourceLinks = artifacts.filter((artifact) => artifact.state === "source");
  const targetArtifacts = artifacts.filter((artifact) => artifact.kind !== "shadow" || artifact.state === "source");
  return {
    package: installedPackage,
    artifacts,
    conflicts,
    sourceLinks,
    targetArtifacts,
    targets: targetArtifacts.map((artifact) => artifact.target),
  };
}

export function installPlanFingerprint(plan) {
  const rows = plan.artifacts.map((artifact) => ({
    path: artifact.target,
    state: artifact.state,
    type: artifact.entry.type,
    dev: artifact.entry.dev,
    ino: artifact.entry.ino,
    rawLink: artifact.entry.rawLink,
  }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function formatInstallConflicts(conflicts) {
  const blocks = [];
  for (const conflict of conflicts) {
    const moveAside = await nextMoveAsidePath(conflict.target);
    blocks.push(
      `path: ${conflict.target}\n` +
        `  owner: unresolved/foreign (Cormidia will not replace it)\n` +
        `  evidence: ${conflict.evidence}\n` +
        `  remediation: inspect it, then move it aside exactly with:\n    mv -- ${shellQuote(conflict.target)} ${shellQuote(moveAside)}`,
    );
  }
  return blocks.join("\n\n");
}

export async function inspectPackagedSkills(packageRoot, env = process.env) {
  const owner = await packageIdentity(packageRoot);
  const artifacts = [];
  for (const skill of PACKAGED_SKILLS) {
    const intendedSource = join(packageRoot, "agent-skills", skill);
    for (const [provider, home] of resolveProviderSkillHomes(env)) {
      artifacts.push(
        await linkArtifact({
          kind: "skill",
          label: `$${skill} (${provider})`,
          target: join(home, "skills", skill),
          intendedSource,
          sourceRoot: packageRoot,
          sourceSources: [],
          sourceSuffixes: [`agent-skills/${skill}`],
          packageSuffix: `agent-skills/${skill}`,
          installedPackage: owner,
        }),
      );
    }
  }
  return { owner, artifacts, conflicts: artifacts.filter((artifact) => artifact.state === "foreign") };
}
