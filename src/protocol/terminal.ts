import { z } from 'zod';

export const terminalSizeSchema = z.object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) });
export const terminalCreateSchema = terminalSizeSchema.extend({ shell: z.enum(['default', 'powershell', 'cmd', 'bash']).default('default') }).strict();
export const terminalIdSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const terminalInputSchema = terminalIdSchema.extend({ data: z.string().min(1).max(65536) }).strict();
export const terminalResizeSchema = terminalIdSchema.extend(terminalSizeSchema.shape).strict();
export const terminalAckSchema = terminalIdSchema.extend({ sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
export const terminalRenameSchema = terminalIdSchema.extend({ title: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/) }).strict();
export type TerminalShell = z.infer<typeof terminalCreateSchema>['shell'];
export interface TerminalSession {
  id: string; repoId: string; cwd: string; title: string; shell: TerminalShell;
  status: 'running' | 'exited'; exitCode?: number;
}
export interface TerminalSnapshot extends TerminalSession { output: string; sequence: number }
export type TerminalEvent =
  | { type: 'terminalOutput'; sessionId: string; sequence: number; data: string }
  | { type: 'terminalUpdated'; session: TerminalSession }
  | { type: 'terminalClosed'; sessionId: string }
  | { type: 'terminalRequested' };
