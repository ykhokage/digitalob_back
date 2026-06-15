type CheckRoute = {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  auth?: boolean;
  body?: Record<string, unknown>;
};

type CheckResult = {
  name: string;
  method: string;
  path: string;
  status: string;
  time: string;
  result: string;
  ok: boolean;
  payload?: unknown;
};

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const email = process.env.API_SMOKE_EMAIL || 'admin@incidents64.fun';
const password = process.env.API_SMOKE_PASSWORD || 'Admin12345!';

const routes: CheckRoute[] = [
  { name: 'CURRENT USER', method: 'GET', path: '/auth/me', auth: true },
  { name: 'DASHBOARD SUMMARY', method: 'GET', path: '/dashboard', auth: true },
  { name: 'SERVICES LIST', method: 'GET', path: '/services', auth: true },
  { name: 'SERVICES ARCHITECTURE', method: 'GET', path: '/services/architecture', auth: true },
  { name: 'SLA OVERVIEW', method: 'GET', path: '/services/sla', auth: true },
  { name: 'METRICS LIST', method: 'GET', path: '/metrics', auth: true },
  { name: 'HEALTH CHECKS', method: 'GET', path: '/metrics/checks', auth: true },
  { name: 'INCIDENTS LIST', method: 'GET', path: '/incidents', auth: true },
  { name: 'NOTIFICATION RULES', method: 'GET', path: '/notifications/rules', auth: true },
  { name: 'NOTIFICATION LOG', method: 'GET', path: '/notifications/log', auth: true },
  { name: 'REPORTS LIST', method: 'GET', path: '/reports', auth: true },
  { name: 'REPORT COMPARISON', method: 'GET', path: '/reports/comparison', auth: true },
  { name: 'AUDIT LOG', method: 'GET', path: '/audit', auth: true },
  { name: 'DIAGNOSTICS', method: 'GET', path: '/diagnostics', auth: true },
  { name: 'USER PROFILE', method: 'GET', path: '/users/me/profile', auth: true },
];

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

function pad(value: string, width: number) {
  return value.length >= width ? value.slice(0, width - 1) + '…' : value.padEnd(width, ' ');
}

function separator() {
  return `${'-'.repeat(24)}  ${'-'.repeat(6)}  ${'-'.repeat(32)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(28)}`;
}

function summarize(payload: unknown) {
  if (Array.isArray(payload)) return `${payload.length} item(s)`;
  if (payload && typeof payload === 'object') {
    const keys = Object.keys(payload as Record<string, unknown>);
    if (typeof (payload as any).total === 'number') return `total=${(payload as any).total}`;
    if (Array.isArray((payload as any).items)) return `${(payload as any).items.length} item(s)`;
    return keys.length ? keys.slice(0, 4).join(', ') : 'object';
  }
  if (typeof payload === 'string') return payload.slice(0, 28);
  return 'response received';
}

async function call(route: CheckRoute, token?: string): Promise<CheckResult> {
  const started = Date.now();

  try {
    const response = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: {
        'Content-Type': 'application/json',
        ...(route.auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: route.body ? JSON.stringify(route.body) : undefined,
    });

    const text = await response.text();
    let payload: unknown = text;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    const ok = response.ok;
    const message = ok ? summarize(payload) : ((payload as any)?.message || response.statusText || 'request failed');

    return {
      name: route.name,
      method: route.method,
      path: route.path,
      status: String(response.status),
      time: `${Date.now() - started} ms`,
      result: ok ? `OK: ${message}` : `FAIL: ${message}`,
      ok,
      payload,
    };
  } catch (error: any) {
    return {
      name: route.name,
      method: route.method,
      path: route.path,
      status: 'ERR',
      time: `${Date.now() - started} ms`,
      result: `FAIL: ${error.message || error}`,
      ok: false,
    };
  }
}

function printResult(row: CheckResult) {
  const color = row.ok ? colors.green : colors.red;
  console.log(
    `${pad(row.name, 24)}  ${pad(row.method, 6)}  ${pad(row.path, 32)}  ${color}${pad(row.status, 8)}${colors.reset}  ${pad(row.time, 8)}  ${color}${row.result}${colors.reset}`,
  );
}

async function main() {
  console.log(`${colors.bold}${colors.cyan}API smoke-check: ${baseUrl}${colors.reset}`);
  console.log(`${colors.dim}User: ${email}${colors.reset}\n`);

  const login = await call({
    name: 'AUTH LOGIN',
    method: 'POST',
    path: '/auth/login',
    body: { email, password },
  });

  console.log(`${pad('CHECK', 24)}  ${pad('METHOD', 6)}  ${pad('ROUTE', 32)}  ${pad('STATUS', 8)}  ${pad('TIME', 8)}  RESULT`);
  console.log(separator());
  printResult(login);

  if (!login.ok) {
    console.log(`\n${colors.red}Login failed. Check backend, seed user, email and password.${colors.reset}`);
    process.exit(1);
  }

  const loginResponse = login.payload as any;
  const token = loginResponse?.accessToken;
  if (!token) {
    console.log(`\n${colors.red}Login response does not contain accessToken.${colors.reset}`);
    process.exit(1);
  }

  const results: CheckResult[] = [];
  for (const route of routes) {
    const result = await call(route, token);
    results.push(result);
    printResult(result);
  }

  const passed = [login, ...results].filter((item) => item.ok).length;
  const total = results.length + 1;
  const failed = total - passed;
  const color = failed ? colors.yellow : colors.green;

  console.log(separator());
  console.log(`${color}${colors.bold}Result: ${passed}/${total} checks passed${failed ? `, ${failed} failed` : ''}.${colors.reset}`);

  process.exit(failed ? 1 : 0);
}

main();
