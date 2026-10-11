import * as vscode from 'vscode';
import { credentialEnvironment, withGitHubAuthentication } from '../application/credentials';
import { hostText, preferredLanguage } from '../application/language';

/** Shared authentication for network actions and embedded terminal shells. */
export function createGitCredentialEnvironment(helper: string, cacheSession = true) {
  return credentialEnvironment(helper,
    withGitHubAuthentication(async (message, password, signal) => {
      const cancellation = new vscode.CancellationTokenSource(), cancel = () => cancellation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      try { return await vscode.window.showInputBox({ title: hostText(preferredLanguage(), "extension.alwayGitGitAuthentication"), prompt: message, password, ignoreFocusOut: true }, cancellation.token); }
      finally { signal.removeEventListener('abort', cancel); cancellation.dispose(); }
    }, async () => {
      if (!vscode.workspace.getConfiguration('github').get<boolean>('gitAuthentication', true)
        || !vscode.workspace.getConfiguration('git').get<boolean>('useIntegratedAskPass', true)) return undefined;
      try {
        // Match VS Code's GitHub Git credential provider so existing login
        // sessions can be reused locally and through Remote SSH.
        return await vscode.authentication.getSession('github', ['repo', 'workflow', 'user:email', 'read:user'], { createIfNone: true });
      } catch (error) {
        if (error instanceof Error && /^No authentication provider\b/i.test(error.message)) return undefined;
        throw error; // Denied/cancelled login must not trigger another prompt.
      }
    }, { cacheSession }));
}
