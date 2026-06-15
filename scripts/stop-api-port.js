const { execSync } = require('node:child_process');

const port = process.env.PORT || '4000';

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function stopWindows() {
  const output = run('netstat -ano -p tcp');
  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !/\bLISTENING\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }

  if (!pids.size) {
    console.log(`Port ${port} is free.`);
    return;
  }

  for (const pid of pids) {
    console.log(`Stopping process ${pid} on port ${port}...`);
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'inherit' });
  }
}

function stopUnix() {
  let output = '';
  try {
    output = run(`lsof -ti tcp:${port}`);
  } catch {
    console.log(`Port ${port} is free.`);
    return;
  }

  const pids = output.split(/\s+/).filter(Boolean);
  if (!pids.length) {
    console.log(`Port ${port} is free.`);
    return;
  }

  for (const pid of pids) {
    console.log(`Stopping process ${pid} on port ${port}...`);
    execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
  }
}

try {
  if (process.platform === 'win32') stopWindows();
  else stopUnix();
} catch (error) {
  console.error(`Could not free port ${port}: ${error.message}`);
  process.exit(1);
}
