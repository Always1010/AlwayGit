import type { ActionBlocker } from '../src/protocol/types';

export class RpcError extends Error {
  constructor(message: string, public code?: string, public details?: ActionBlocker) { super(message); this.name = 'RpcError'; }
}
