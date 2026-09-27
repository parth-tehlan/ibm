import { z } from 'zod';

const timestamp = z.string().datetime({ offset: true });

// Court payloads are opaque evidence. Validate their envelope without interpreting
// requirement IDs or discarding unfamiliar fields supplied by a court.
export const courtResultSchema = z.object({
  state: z.enum(['not_run', 'running', 'complete', 'error', 'unavailable']),
  collectedAt: timestamp.nullable(),
  sourceGeneratedAt: timestamp.nullable(),
  payload: z.record(z.unknown()).nullable(),
  errors: z.array(z.string()),
}).strict();

export const snapshotSchema = z.object({
  schemaVersion: z.literal(2),
  project: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
  runId: z.string().uuid(),
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: z.number().int().nonnegative(),
  state: z.enum(['running', 'complete', 'interrupted']),
  checkedOutCommit: z.string().nullable(),
  branch: z.string().nullable(),
  workingTreeDirty: z.boolean().nullable(),
  producer: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
  witness: courtResultSchema,
  trustgap: courtResultSchema,
  triage: courtResultSchema,
}).strict();

// The v1 contract is kept local: no dependency on the server's repository-specific
// snapshot module, git checkout, court tooling, or server startup side effects.
const legacySchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  repository: z.string().min(1),
  checkedOutCommit: z.string().nullable(),
  workingTreeDirty: z.boolean().nullable(),
  createdAt: timestamp,
  state: z.enum(['running', 'complete']),
  redline: courtResultSchema,
  splitbrain: courtResultSchema,
  warpath: courtResultSchema,
}).strict();

// Stable synthetic ID for legacy snapshots without a project UUID. Keep the
// algorithm identical to the browser's offline import converter.
function legacyProjectId(name) {
  const bytes = new TextEncoder().encode(`triumph:legacy-project:${name}`);
  const words = [2166136261, 2166136261 ^ 0x9e3779b9, 2166136261 ^ 0x85ebca6b, 2166136261 ^ 0xc2b2ae35];
  for (const byte of bytes) for (let i = 0; i < words.length; i++) words[i] = Math.imul(words[i] ^ byte, 16777619) >>> 0;
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Validate v2 unchanged or migrate a validated v1 snapshot to v2.
 * Legacy provenance: repository -> project.name; name-derived stable project.id;
 * createdAt -> updatedAt; revision 0; branch null; producer legacy-snapshot/1.
 * All three court envelopes and opaque payload evidence are retained.
 */
export function normalizeReport(input) {
  if (input?.schemaVersion === 2) return snapshotSchema.parse(input);
  const old = legacySchema.parse(input);
  return snapshotSchema.parse({
    schemaVersion: 2,
    project: { id: legacyProjectId(old.repository), name: old.repository },
    runId: old.runId,
    createdAt: old.createdAt,
    updatedAt: old.createdAt,
    revision: 0,
    state: old.state,
    checkedOutCommit: old.checkedOutCommit,
    branch: null,
    workingTreeDirty: old.workingTreeDirty,
    producer: { name: 'legacy-snapshot', version: '1' },
    witness: old.redline,
    trustgap: old.splitbrain,
    triage: old.warpath,
  });
}
