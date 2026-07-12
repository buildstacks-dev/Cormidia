import { cpSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, hashManifest, loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";

const input = option("--campaign"); const outRoot = option("--out");
if (!input || !outRoot) throw new Error("usage: pnpm eval:archive -- --campaign <prepared-file> --out <archive-root>");
const manifestPath = resolve(input); const campaign = loadYamlFile(manifestPath) as CampaignManifest; const errors = validateCampaign(campaign); if (errors.length > 0) throw new Error(`invalid_campaign: ${errors.join("; ")}`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); const source = join(root, ".eval-artifacts", campaign.campaign_id);
if (!existsSync(source)) throw new Error("campaign_evidence_not_found");
const destination = resolve(outRoot, `${campaign.campaign_id}-${hashManifest(campaign).slice(7, 15)}`); if (existsSync(destination)) throw new Error("archive_destination_exists");
mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: true, force: false });
const files = listFiles(destination).filter((path) => basename(path) !== "archive-manifest.json");
const archiveManifest = { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hashManifest(campaign), archived_at: new Date().toISOString(), files: Object.fromEntries(files.map((path) => [path.slice(destination.length + 1), `sha256:${hashFile(path)}`])) };
const path = join(destination, "archive-manifest.json"); let fd: number; try { fd = openSync(path, "wx", 0o600); } catch (error) { throw error; } try { writeFileSync(fd, `${JSON.stringify(archiveManifest, null, 2)}\n`, "utf8"); } finally { closeSync(fd); }
console.log(JSON.stringify({ schema_version: 1, campaign_id: campaign.campaign_id, destination, files: files.length, campaign_sha256: archiveManifest.campaign_sha256 }, null, 2));

function option(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function listFiles(root: string): string[] { const found: string[] = []; visit(root); return found.sort(); function visit(dir: string): void { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isSymbolicLink()) throw new Error(`archive_symlink_forbidden: ${path}`); if (entry.isDirectory()) visit(path); else if (entry.isFile() && statSync(path).isFile()) found.push(path); else throw new Error(`archive_special_file_forbidden: ${path}`); } } }
