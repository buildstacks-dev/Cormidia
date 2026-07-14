import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ContextBundle, ContextComponent } from "../runtime/types.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { renderContextBundle } from "../runtime/worktree-context.js";
import { writeLoopFileAtomic } from "./durable.js";
import { efficiencyEpisodeDir, fingerprint } from "./efficiency.js";

export interface ContextManifestComponent {
  component_id: string;
  category: "authority" | "taste" | "role_protocol" | "memory" | "brief" | "template";
  source: string;
  source_sha256: string;
  rendered_bytes: number;
  inclusion_reason: string;
  prior_pass_change: "initial" | "unchanged" | "changed" | "new";
  cache_identity: string;
  requirement: "required" | "optional";
  eviction: "kept" | "evicted";
}

export interface ContextManifest {
  schema_version: 1;
  episode_id: string;
  app: string;
  run_id: string;
  render_sha256: string;
  rendered_bytes: number;
  components: ContextManifestComponent[];
}

type ManifestInputComponent = {
  category: ContextManifestComponent["category"];
  source: string;
  rendered: string;
  inclusionReason: string;
  requirement: "required" | "optional";
  cacheIdentity?: string;
};

export async function writeContextManifest(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  context: ContextBundle;
  brief: string;
  template?: string;
}): Promise<{ manifest: ContextManifest; relativeRef: string }> {
  const previous = await latestContextManifest(input.root, input.episodeId);
  const raw: ManifestInputComponent[] = [
    ...contextComponents(input.context),
    {
      category: "brief" as const,
      source: "loop:assembled-brief",
      rendered: input.brief,
      inclusionReason: "task, criteria, durable artifacts, and current evidence for this pass",
      requirement: "required" as const,
    },
    ...(input.template === undefined
      ? []
      : [{
          category: "template" as const,
          source: "pipeline:versioned-pass-template",
          rendered: input.template,
          inclusionReason: "human-ratified protocol for the selected pass",
          requirement: "required" as const,
        }]),
  ];
  const priorById = new Map(previous?.components.map((component) => [component.component_id, component]));
  const components = raw.map((component): ContextManifestComponent => {
    const sourceHash = sha256(component.rendered);
    const id = sha256(`${component.category}\0${component.source}`).slice(0, 24);
    const prior = priorById.get(id);
    return {
      component_id: id,
      category: component.category,
      source: component.source,
      source_sha256: sourceHash,
      rendered_bytes: Buffer.byteLength(component.rendered, "utf8"),
      inclusion_reason: component.inclusionReason,
      prior_pass_change:
        previous === undefined
          ? "initial"
          : prior === undefined
            ? "new"
            : prior.source_sha256 === sourceHash
              ? "unchanged"
              : "changed",
      cache_identity: component.cacheIdentity ?? sha256(`${component.category}\0${sourceHash}`),
      requirement: component.requirement,
      eviction: "kept",
    };
  }).sort((a, b) => a.component_id.localeCompare(b.component_id));
  const renderedContext = renderContextBundle(input.context);
  const renderFingerprint = fingerprint({
    context: renderedContext,
    brief: input.brief,
    template: input.template ?? null,
  });
  const manifest: ContextManifest = {
    schema_version: 1,
    episode_id: input.episodeId,
    app: input.app,
    run_id: input.runId,
    render_sha256: renderFingerprint,
    rendered_bytes: Buffer.byteLength(
      `${renderedContext}${input.brief}${input.template ?? ""}`,
      "utf8",
    ),
    components,
  };
  const path = join(runPaths(input.root, input.app, input.runId).dir, "context-manifest.json");
  await writeLoopFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const episodeRef = join(efficiencyEpisodeDir(input.root, input.episodeId), "context", `${sha256(input.runId)}.json`);
  await writeLoopFileAtomic(episodeRef, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, relativeRef: "context-manifest.json" };
}

export async function readContextManifest(root: string, app: string, runId: string): Promise<ContextManifest> {
  return JSON.parse(
    await readFile(join(runPaths(root, app, runId).dir, "context-manifest.json"), "utf8"),
  ) as ContextManifest;
}

function contextComponents(context: ContextBundle): ManifestInputComponent[] {
  if (context.components !== undefined) return context.components;
  const fallback: ManifestInputComponent[] = [];
  if (context.authority !== undefined) {
    fallback.push({
      category: "authority",
      source: context.authority.sources.join(" | ") || "unattributed:authority",
      rendered: context.authority.text,
      inclusionReason: "legacy bundle authority; detailed source provenance unavailable",
      requirement: "required",
      cacheIdentity: context.authority.sha256,
    });
  }
  context.taste.forEach((rendered, index) => fallback.push({
    category: "taste",
    source: `unattributed:taste:${index}`,
    rendered,
    inclusionReason: "legacy bundle taste layer; source provenance unavailable",
    requirement: "required",
  }));
  context.memoryExcerpts.forEach((rendered, index) => fallback.push({
    category: "memory",
    source: `unattributed:memory:${index}`,
    rendered,
    inclusionReason: "legacy bundle memory excerpt; source provenance unavailable",
    requirement: "optional",
  }));
  return fallback;
}

async function latestContextManifest(root: string, episodeId: string): Promise<ContextManifest | undefined> {
  const dir = join(efficiencyEpisodeDir(root, episodeId), "context");
  if (!existsSync(dir)) return undefined;
  const manifests: ContextManifest[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      manifests.push(JSON.parse(await readFile(join(dir, file), "utf8")) as ContextManifest);
    } catch {
      // Report diagnostics name corrupt manifests; assembly proceeds from the
      // last readable one and never fabricates prior-pass equality.
    }
  }
  return manifests.sort((a, b) => a.run_id.localeCompare(b.run_id)).at(-1);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
