const net = require('node:net');
const port = Number(process.env.ALWAYGIT_ASKPASS_PORT);
if (!port || !process.env.ALWAYGIT_ASKPASS_TOKEN) process.exit(1);
const socket = net.createConnection({ host: '127.0.0.1', port });
let response = '';
socket.setTimeout(600000, () => { socket.destroy(); process.exit(1); });
socket.on('error', () => process.exit(1));
socket.on('connect', () => socket.write(JSON.stringify({ token: process.env.ALWAYGIT_ASKPASS_TOKEN, prompt: process.argv.slice(2).join(' ') }) + '\n'));
socket.on('data', chunk => {
  response += chunk.toString('utf8');
  if (response.length > 100000) { socket.destroy(); process.exit(1); }
  if (!response.includes('\n')) return;
  try {
    const result = JSON.parse(response.slice(0, response.indexOf('\n')));
    if (result.cancelled || typeof result.answer !== 'string' || /[\r\n\0]/.test(result.answer)) { socket.destroy(); process.exit(1); }
    process.stdout.write(result.answer + '\n', () => { socket.end(); });
  } catch { socket.destroy(); process.exit(1); }
});
