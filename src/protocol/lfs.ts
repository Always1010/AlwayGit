import { z } from 'zod';
const pattern = z.string().min(1).max(4096).refine(value => !/[\0\r\n]/.test(value));
export const lfsTrackRequestSchema = z.object({ pattern, literal: z.boolean(), operation: z.enum(['track', 'untrack']) }).strict();
export type LfsTrackRequest = z.infer<typeof lfsTrackRequestSchema>;
export interface LfsTrackPreview { token: string; before: string; after: string; pattern: string; operation: 'track' | 'untrack'; head?: string; branch: string }
export interface LfsFile { path: string; oid: string; size: number; worktree: 'pointer' | 'content' | 'missing' | 'unknown'; localObject: 'available' | 'missing' | 'unknown'; staged: boolean; unstaged: boolean }
export type LfsDestinations = Record<string, { fetch: string; push: string }>;
export interface LfsStatus { available: boolean; version?: string; filterConfigured: boolean; files: LfsFile[]; statusText: string; checkedAt: number; remoteAvailability: 'unknown'; truncated: boolean; destinations: LfsDestinations; head?: string; branch: string }
export const lfsHistoricalRequestSchema = z.object({ revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).refine(value => !/^0+$/.test(value)), path: pattern }).strict();
export type LfsHistoricalRequest = z.infer<typeof lfsHistoricalRequestSchema>;
export interface LfsHistoricalStatus extends LfsHistoricalRequest { oid: string; size: number; localObject: 'available' | 'missing' | 'unknown' }
/** Host-only bytes: the historical-status RPC returns metadata without this property. */
export interface LfsHistoricalObject extends LfsHistoricalStatus { content?: Buffer }
const context = { expectedHead: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/), expectedBranch: z.string().max(4096) };
const remote = pattern.refine(value => !value.startsWith('-'));
const expectedDestination = z.string().regex(/^[a-f0-9]{64}$/);
export const lfsActionSchema = z.union([
  lfsHistoricalRequestSchema.extend({ type: z.literal('lfs.fetchHistorical'), oid: z.string().regex(/^[a-f0-9]{64}$/), remote, expectedDestination }).strict(),
  z.object({ type: z.literal('lfs.track'), token: z.string().uuid() }).strict(),
  z.object({ type: z.literal('lfs.fetch'), remote, expectedDestination, oids: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(1000).optional(), ...context }).strict(),
  z.object({ type: z.literal('lfs.checkout'), ...context }).strict(),
  z.object({ type: z.enum(['lfs.pull', 'lfs.push']), remote, expectedDestination, ...context }).strict(),
]);
export type LfsAction = z.infer<typeof lfsActionSchema>;
