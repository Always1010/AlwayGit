import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';
import type { ShellLaunch } from '../application/terminal-sessions';

// One helper owns one PTY. Exiting the helper also releases native output workers.
let terminal: IPty | undefined;
const send = (message: unknown, done?: () => void) => {
  if (process.connected) process.send!(message as object, () => done?.()); else process.exit(0);
};
process.on('message', (message: { type: string; shell?: ShellLaunch; cwd?: string; cols?: number; rows?: number; data?: string }) => {
  try {
    switch (message.type) {
      case 'start': {
        if (terminal) return;
        const pty = createRequire(__filename)('./terminal-runtime/node-pty') as typeof import('node-pty');
        const shell = message.shell!;
        terminal = pty.spawn(shell.file, shell.args, { cwd: message.cwd!, cols: message.cols!, rows: message.rows!, name: 'xterm-256color', env: shell.env });
        terminal.onData(data => send({ type: 'data', data }));
        terminal.onExit(event => send({ type: 'exit', exitCode: event.exitCode }, () => process.exit(0)));
        break;
      }
      case 'input': terminal?.write(message.data!); break;
      case 'resize': terminal?.resize(message.cols!, message.rows!); break;
      case 'pause': terminal?.pause(); break;
      case 'resume': terminal?.resume(); break;
      case 'kill': terminal?.kill(); break;
    }
  } catch (error) {
    // Native launch errors are provider diagnostics, displayed as terminal output.
    send({ type: 'data', data: `\r\n${error instanceof Error ? error.message : String(error)}\r\n` });
    send({ type: 'exit', exitCode: 1 }, () => process.exit(0));
  }
});
process.on('disconnect', () => { try { terminal?.kill(); } finally { process.exit(0); } });
