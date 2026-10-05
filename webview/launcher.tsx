import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchLocationsDialog } from './WorkbenchLocationsDialog';
import type { HostMessage, RpcRequest } from '../src/protocol/types';
import type { WorkbenchLocations } from '../src/protocol/workbench-host';
import type { Language } from '../src/i18n';

// The launch page only exposes location preferences, never repository or Git RPCs.
const api = window.acquireVsCodeApi!();
let sequence = 0;
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
function request(method: RpcRequest['method'], payload?: unknown): Promise<unknown> {
  const id = `launcher-${++sequence}`;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); api.postMessage({ id, method, payload }); });
}
function LauncherSettings() {
  const [settings, setSettings] = useState<{ locations: WorkbenchLocations; language: Language }>();
  // Install the listener before the ready handshake; native title commands may arrive during load.
  useEffect(() => {
    const receive = ({ data }: MessageEvent<HostMessage>) => {
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'showWorkbenchLocations') setSettings(current => current ?? { locations: data.locations, language: data.language });
      if (data.type === 'response') {
        const call = pending.get(data.id); if (!call) return; pending.delete(data.id);
        if (data.error) call.reject(new Error(data.error.message)); else call.resolve(data.result);
      }
    };
    window.addEventListener('message', receive);
    void request('workbenchLocationsReady').catch(() => {});
    return () => window.removeEventListener('message', receive);
  }, []);
  return settings && <WorkbenchLocationsDialog {...settings} onApply={locations => request('saveWorkbenchLocations', locations)} onClose={() => {
    setSettings(undefined); void request('workbenchLocationsClosed').catch(() => {});
  }}/>;
}
createRoot(document.getElementById('locations-root')!).render(<LauncherSettings/>);
