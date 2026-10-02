import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { panelSession, statusBarPresentation } from '../src/extension/workbench-entry';

describe('Workbench entry presentation', () => {
  it('opens a missing workbench and focuses an existing hidden workbench', () => {
    expect(statusBarPresentation({ open: false, active: false })).toEqual({ visible: true, tooltip: 'Open AlwayGit Workbench' });
    expect(statusBarPresentation({ open: true, active: false })).toEqual({ visible: true, tooltip: 'Show AlwayGit Workbench' });
  });

  it('keeps the launcher available while Workbench is active', () => {
    expect(statusBarPresentation({ open: true, active: true })).toEqual({ visible: true, tooltip: 'Show AlwayGit Workbench' });
  });

  it('contributes a stable Activity Bar Workbench launcher', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      activationEvents?: string[];
      contributes?: {
        viewsContainers?: { activitybar?: Array<{ id?: string }> };
        views?: Record<string, Array<{ id?: string }>>;
      };
    };
    expect(manifest.contributes?.viewsContainers?.activitybar?.some(item => item.id === 'alwaygit')).toBe(true);
    expect(manifest.contributes?.views?.alwaygit?.some(item => item.id === 'alwaygit.workbenchLauncher')).toBe(true);
    expect(manifest.activationEvents).toContain('onView:alwaygit.workbenchLauncher');
  });

  it('creates a blank tab without copying the last repository',()=>{
    expect(panelSession({repoId:'previous',language:'zh-CN'},undefined,true)).toEqual({language:'zh-CN'});
    expect(panelSession({repoId:'previous'},'selected')).toEqual({repoId:'selected'});
  });
});
