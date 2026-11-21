import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = join(rootDir, 'backend');
const frontendDir = join(rootDir, 'frontend');
const viteBin = join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const useColor = Boolean(process.stdout.isTTY);
const COLORS = {
  db: useColor ? '\x1b[33m' : '',
  backend: useColor ? '\x1b[32m' : '',
  frontend: useColor ? '\x1b[36m' : '',
  system: useColor ? '\x1b[35m' : '',
  reset: useColor ? '\x1b[0m' : '',
};

function formatPrefix(tag, color) {
  return `${color}[${tag}]${COLORS.reset}`;
}

function logSystem(message) {
  console.log(`${formatPrefix('KANTINFLOW', COLORS.system)} ${message}`);
}

function pipePrefixed(stream, tag, color, target) {
  if (!stream) return;
  let buffer = '';
  const prefix = formatPrefix(tag, color);

  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`${prefix} ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      target.write(`${prefix} ${buffer}\n`);
      buffer = '';
    }
  });
}

function readBackendPort() {
  if (process.env.PORT && /^\d+$/u.test(process.env.PORT)) {
    return process.env.PORT;
  }
  const envPath = join(backendDir, '.env');
  if (!existsSync(envPath)) return '3000';
  try {
    const content = readFileSync(envPath, 'utf8');
    const match = /^\s*PORT\s*=\s*(\d+)/mu.exec(content);
    return match ? match[1] : '3000';
  } catch {
    return '3000';
  }
}

function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ port: Number(port), host });
    const done = (inUse) => {
      socket.destroy();
      resolvePromise(inUse);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function runNpmScript(prefixDir, scriptName, tag) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = isWin ? 'cmd.exe' : npmCmd;
    const args = isWin
      ? ['/d', '/s', '/c', `${npmCmd} --prefix ${prefixDir} run ${scriptName}`]
      : ['--prefix', prefixDir, 'run', scriptName];

    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    pipePrefixed(child.stdout, tag, COLORS.db, process.stdout);
    pipePrefixed(child.stderr, tag, COLORS.db, process.stderr);

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Perintah "${npmCmd} --prefix ${prefixDir} run ${scriptName}" gagal (kode ${code}).`));
    });
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolvePromise();
    };

    child.once('exit', done);
    child.once('close', done);

    try {
      child.kill('SIGTERM');
    } catch {
      // Abaikan jika proses sudah selesai.
    }

    const forceTimer = setTimeout(() => {
      if (settled) return;
      if (isWin && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('close', done);
        killer.on('error', done);
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          // Abaikan error jika proses sudah mati.
        }
        done();
      }
    }, 1500);
    forceTimer.unref?.();
  });
}

async function main() {
  if (!existsSync(join(backendDir, 'node_modules'))) {
    throw new Error('Dependensi backend belum terpasang. Jalankan: npm.cmd --prefix backend install');
  }
  if (!existsSync(viteBin)) {
    throw new Error('Dependensi frontend belum terpasang. Jalankan: npm.cmd --prefix frontend install');
  }

  const backendPort = readBackendPort();
  const frontendPort = process.env.FRONTEND_PORT && /^\d+$/u.test(process.env.FRONTEND_PORT)
    ? process.env.FRONTEND_PORT
    : '5173';

  const [backendBusy, frontendBusyV4, frontendBusyV6] = await Promise.all([
    isPortListening(backendPort, '127.0.0.1'),
    isPortListening(frontendPort, '127.0.0.1'),
    isPortListening(frontendPort, '::1'),
  ]);

  if (backendBusy) {
    throw new Error(
      `Port Backend ${backendPort} sedang dipakai proses lain. Tutup terminal backend lama terlebih dahulu.`,
    );
  }
  if (frontendBusyV4 || frontendBusyV6) {
    throw new Error(
      `Port Frontend ${frontendPort} sedang dipakai proses lain. Tutup terminal frontend lama terlebih dahulu.`,
    );
  }

  let dbStarted = false;
  let shuttingDown = false;
  let backendProc = null;
  let frontendProc = null;

  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    logSystem(`${reason} Menghentikan Frontend, Backend, dan MongoDB...`);
    await Promise.all([
      stopChild(frontendProc),
      stopChild(backendProc),
    ]);

    if (dbStarted) {
      try {
        await runNpmScript('backend', 'db:stop', 'DB');
      } catch (err) {
        console.error(`${formatPrefix('DB', COLORS.db)} Gagal menghentikan MongoDB otomatis: ${err.message}`);
      }
    }

    logSystem('Semua layanan berhenti dengan bersih.');
    process.exit(exitCode);
  }

  process.on('SIGINT', () => { void shutdown('Menerima SIGINT (Ctrl+C).', 0); });
  process.on('SIGTERM', () => { void shutdown('Menerima SIGTERM.', 0); });

  if (isWin && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => { void shutdown('Menerima Ctrl+C.', 0); });
  }

  logSystem('Menyalakan MongoDB lokal (replica set rs0)...');
  await runNpmScript('backend', 'db:start', 'DB');
  dbStarted = true;

  console.log('');
  logSystem('KantinFlow SIM siap dijalankan!');
  logSystem(`Frontend : http://localhost:${frontendPort}`);
  logSystem(`Backend  : http://127.0.0.1:${backendPort}/api/v1`);
  logSystem('Akun Demo: admin@kantinflow.local | petugas@kantinflow.local (password di backend/.env)');
  logSystem('Reset DB : npm.cmd run seed (dari root) | Tekan Ctrl+C untuk berhenti.');
  console.log('');

  backendProc = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'], {
    cwd: backendDir,
    env: { ...process.env, PORT: backendPort },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  pipePrefixed(backendProc.stdout, 'BACKEND', COLORS.backend, process.stdout);
  pipePrefixed(backendProc.stderr, 'BACKEND', COLORS.backend, process.stderr);

  const viteArgs = [viteBin, '--port', frontendPort, '--strictPort'];
  frontendProc = spawn(process.execPath, viteArgs, {
    cwd: frontendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  pipePrefixed(frontendProc.stdout, 'FRONTEND', COLORS.frontend, process.stdout);
  pipePrefixed(frontendProc.stderr, 'FRONTEND', COLORS.frontend, process.stderr);

  backendProc.on('exit', (code, signal) => {
    if (!shuttingDown) {
      void shutdown(`Proses Backend berhenti tak terduga (kode=${code}, signal=${signal}).`, code ?? 1);
    }
  });

  frontendProc.on('exit', (code, signal) => {
    if (!shuttingDown) {
      void shutdown(`Proses Frontend berhenti tak terduga (kode=${code}, signal=${signal}).`, code ?? 1);
    }
  });
}

main().catch((err) => {
  console.error(`${formatPrefix('KANTINFLOW', COLORS.system)} ${err.message}`);
  process.exit(1);
});
