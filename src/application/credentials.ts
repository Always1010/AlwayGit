import { message as localizeMessage, MessageError } from '../i18n/index';
import { createServer, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

type CredentialPrompt = (message: string, password: boolean, signal: AbortSignal) => Promise<string | undefined>;
interface GitHubSession { account: { id: string }; accessToken: string }

/** Command-local GitHub session; other hosts and SSH continue through AskPass. */
export function withGitHubAuthentication(prompt: CredentialPrompt, getSession: () => Promise<GitHubSession | undefined>): CredentialPrompt {
  let session: Promise<GitHubSession | undefined> | undefined;
  return async (message, password, signal) => {
    if (signal.aborted) return undefined;
    const request = /^(Username|Password) for '([^'\r\n]+)':\s*$/i.exec(message);
    let github = false;
    if (request) {
      try {
        const url = new URL(request[2]);
        github = url.protocol === 'https:' && url.hostname === 'github.com' && (!url.port || url.port === '443');
      } catch { /* Non-URL requests use the normal input prompt. */ }
    }
    if (github) {
      // The public authentication API cannot cancel browser UI. Stop waiting on
      // command cancellation and never return a late token to a stopped Git.
      const pending = session ??= getSession();
      let cancel!: () => void;
      const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); signal.addEventListener('abort', cancel, { once: true }); });
      if (signal.aborted) cancel();
      try {
        const authenticated = await Promise.race([pending, cancelled]);
        if (signal.aborted) return undefined;
        if (authenticated) return /^password$/i.test(request![1]) ? authenticated.accessToken : authenticated.account.id;
      } finally { signal.removeEventListener('abort', cancel); }
    }
    return prompt(message, password, signal);
  };
}

/** A per-command loopback bridge. Credentials only live in the request response. */
export async function credentialEnvironment(helper: string, prompt: CredentialPrompt): Promise<{ env: NodeJS.ProcessEnv; cancelPrompts(): void; dispose(): void }> {
  const token = randomBytes(32).toString('hex');
  const sockets = new Set<Socket>();
  const lifetime = new AbortController();
  const server = createServer(socket => {
    if (lifetime.signal.aborted) { socket.destroy(); return; }
    const requestLifetime = new AbortController();
    const cancel = () => { requestLifetime.abort(); if (!socket.destroyed) socket.end(JSON.stringify({ answer: '', cancelled: true }) + '\n'); };
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    sockets.add(socket); socket.setTimeout(600000, () => socket.destroy());
    socket.once('close', () => { requestLifetime.abort(); lifetime.signal.removeEventListener('abort', cancel); sockets.delete(socket); });
    let data = ''; let answered = false;
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      if (answered) return;
      data += chunk.toString('utf8');
      if (data.length > 8192) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      answered = true;
      try {
        const request = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (request.token !== token || typeof request.prompt !== 'string') { socket.destroy(); return; }
        const secret = /password|passphrase|token/i.test(request.prompt);
        const answer = await prompt(request.prompt.slice(0, 4096), secret, requestLifetime.signal);
        if (!requestLifetime.signal.aborted && !socket.destroyed) socket.end(JSON.stringify({ answer: answer ?? '', cancelled: answer === undefined }) + '\n');
      } catch { socket.destroy(); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new MessageError(localizeMessage("credentials.cannotStartGitCredentialPrompt")); }
  const executable = process.platform === 'win32' ? process.execPath.replace(/\\/g, '/') : process.execPath;
  const helperPath = process.platform === 'win32' ? helper.replace(/\\/g, '/') : helper;
  const command = helperPath.replace(/\.cjs$/, '.sh');
  return {
    // Git consults credential helpers before AskPass. Leave their interaction
    // settings intact so browser login can complete before this fallback runs.
    env: { ELECTRON_RUN_AS_NODE: '1', GIT_ASKPASS: command, SSH_ASKPASS: command, SSH_ASKPASS_REQUIRE: 'prefer', DISPLAY: process.env.DISPLAY ?? ':0', ALWAYGIT_NODE: executable, ALWAYGIT_ASKPASS_HELPER: helperPath, ALWAYGIT_ASKPASS_PORT: String(address.port), ALWAYGIT_ASKPASS_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
    cancelPrompts() { lifetime.abort(); },
    dispose() { lifetime.abort(); for (const socket of sockets) socket.destroy(); server.close(); },
  };
}
