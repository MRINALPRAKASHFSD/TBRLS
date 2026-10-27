import type { FastifyPluginAsync } from 'fastify';
import type { RateLimiterService } from '../limiter/rate-limiter-service.js';

export const dashboardRoutes: FastifyPluginAsync<{ limiterService: RateLimiterService }> = async (
  fastify
) => {
  const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TBRLS - Rate Limiter Admin Dashboard & Website Shield</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-sub: #1a2234;
      --border: #26334a;
      --border-focus: #38bdf8;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --primary-dim: rgba(56, 189, 248, 0.12);
      --success: #34d399;
      --success-dim: rgba(52, 211, 153, 0.15);
      --danger: #f87171;
      --danger-dim: rgba(248, 113, 113, 0.15);
      --warning: #fbbf24;
      --warning-dim: rgba(251, 191, 36, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 16px;
    }
    .logo-group h1 { font-size: 1.5rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .logo-group .subtitle { font-size: 0.875rem; color: var(--text-muted); }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: var(--text); background: var(--card-sub); }
    .tab-btn.active {
      color: var(--primary);
      background: var(--primary-dim);
      border-color: rgba(56, 189, 248, 0.3);
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 20px;
    }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); font-weight: 600; }
    .stat-value { font-size: 1.75rem; font-weight: 700; margin-top: 4px; }
    .btn {
      background: var(--primary);
      color: #090d16;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-secondary {
      background: var(--card-sub);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: #222d42; border-color: #3b4b66; }
    .btn-danger { background: var(--danger); color: #090d16; }
    .btn-danger:hover { background: #ef4444; }
    .btn-burst { background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; }
    .btn-burst:hover { opacity: 0.95; }
    input[type="password"], input[type="text"], input[type="number"], select {
      background: #0b1120;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-family: inherit;
      width: 100%;
      transition: border 0.2s;
    }
    input:focus, select:focus { outline: none; border-color: var(--border-focus); }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; text-align: left; }
    th, td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 600; background: rgba(15, 23, 42, 0.4); }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .badge-success { background: var(--success-dim); color: var(--success); border: 1px solid rgba(52, 211, 153, 0.3); }
    .badge-danger { background: var(--danger-dim); color: var(--danger); border: 1px solid rgba(248, 113, 113, 0.3); }
    .badge-warning { background: var(--warning-dim); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.3); }
    .badge-info { background: var(--primary-dim); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.3); }
    .flex { display: flex; align-items: center; gap: 12px; }
    .hidden { display: none !important; }
    .notice { font-size: 0.8rem; color: var(--text-muted); margin-top: 12px; }
    .token-meter-container {
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin: 16px 0;
    }
    .token-bar-track {
      background: #1e293b;
      height: 16px;
      border-radius: 8px;
      overflow: hidden;
      margin: 10px 0 6px;
      position: relative;
    }
    .token-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #38bdf8, #34d399);
      width: 100%;
      border-radius: 8px;
      transition: width 0.3s ease, background-color 0.3s ease;
    }
    .token-bar-fill.depleted {
      background: linear-gradient(90deg, #f87171, #ef4444);
    }
    .pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 100px;
      font-size: 0.75rem;
      background: var(--card-sub);
      color: var(--text-muted);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.15s;
    }
    .pill:hover { color: var(--primary); border-color: var(--primary); }
    .log-terminal {
      background: #070b13;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      max-height: 240px;
      overflow-y: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      color: #cbd5e1;
      display: flex;
      flex-direction: column-reverse;
      gap: 6px;
    }
    .log-line { display: flex; gap: 10px; align-items: flex-start; }
    .log-time { color: var(--text-muted); font-size: 0.72rem; }
    .log-allow { color: var(--success); }
    .log-deny { color: var(--danger); font-weight: 600; }
    .code-box {
      background: #070b13;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-group">
        <h1>TBRLS Admin Dashboard & Website Shield</h1>
        <p class="subtitle">Zero-Code Website Rate Limiter & Distributed Admissions Control</p>
      </div>
      <div id="auth-status-container" class="flex">
        <span id="auth-badge" class="badge badge-warning">Admin Disconnected</span>
        <button id="disconnect-btn" class="btn btn-secondary btn-sm hidden" onclick="disconnect()">Logout</button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <div class="tabs">
      <button class="tab-btn active" id="tab-shield-btn" onclick="switchTab('shield')">🛡️ Instant Website Protector & Tester</button>
      <button class="tab-btn" id="tab-telemetry-btn" onclick="switchTab('telemetry')">📊 Global Telemetry & Policy Control</button>
      <button class="tab-btn" id="tab-guide-btn" onclick="switchTab('guide')">📖 Integration Guide</button>
    </div>

    <!-- TAB 1: WEBSITE SHIELD & TESTER (ZERO-SETUP, NO ADMIN KEY REQUIRED TO TEST) -->
    <div id="section-shield">
      <div class="card">
        <h2 style="font-size: 1.25rem; margin-bottom: 6px;">Protect & Rate-Limit Any Website or API URL</h2>
        <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 18px;">
          Paste any website URL below. TBRLS will act as an intelligent gateway, checking rate-limits in PostgreSQL before forwarding traffic.
        </p>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 12px;">
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 6px;">TARGET WEBSITE OR API LINK</label>
            <input type="text" id="target-url-input" value="https://jsonplaceholder.typicode.com/todos/1" placeholder="https://your-website.com/api/..." />
          </div>
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 6px;">CLIENT IDENTIFIER (IP OR USER)</label>
            <input type="text" id="client-key-input" value="my-website-visitor" placeholder="e.g. user-123 or ip:192.168.1.1" />
          </div>
        </div>

        <!-- Quick preset links -->
        <div class="flex" style="flex-wrap: wrap; margin-bottom: 20px;">
          <span style="font-size: 0.78rem; color: var(--text-muted);">Quick Presets:</span>
          <span class="pill" onclick="setPreset('https://jsonplaceholder.typicode.com/todos/1')">JSONPlaceholder API</span>
          <span class="pill" onclick="setPreset('https://httpbin.org/get')">HTTPBin Echo</span>
          <span class="pill" onclick="setPreset('https://api.weatherapi.com/v1/current.json')">Weather API Demo</span>
        </div>

        <!-- Live Token Battery Meter -->
        <div class="token-meter-container">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="flex">
              <span style="font-weight: 600;">Live Quota Tank:</span>
              <span id="meter-status-badge" class="badge badge-success">Ready (10 Tokens)</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">
              Tokens Remaining: <strong id="tokens-count" style="color: var(--primary);">10</strong> / <span id="tokens-capacity">10</span>
            </div>
          </div>
          <div class="token-bar-track">
            <div id="token-bar" class="token-bar-fill" style="width: 100%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
            <span id="refill-rate-label">Continuous Refill: +2.0 tokens / sec</span>
            <span id="retry-timer-label">No wait active</span>
          </div>
        </div>

        <!-- Action Controls -->
        <div class="flex" style="flex-wrap: wrap; margin-top: 16px;">
          <button class="btn" id="send-one-btn" onclick="sendTestRequest(1)">
            ⚡ Send 1 Request
          </button>
          <button class="btn btn-burst" id="send-burst-btn" onclick="sendBurstRequests(10)">
            🚀 Surge Test (Send 10 Rapid Requests)
          </button>
          <button class="btn btn-secondary" onclick="resetTank()">
            🔄 Reset Token Tank
          </button>
        </div>

        <!-- Live Activity Log -->
        <div style="margin-top: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h3 style="font-size: 0.9rem; font-weight: 600; color: var(--text-muted);">LIVE REQUEST ACTIVITY STREAM</h3>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="clearLogs()">Clear Log</button>
          </div>
          <div id="activity-log" class="log-terminal">
            <div class="log-line">
              <span class="log-time">[Ready]</span>
              <span>Click "Send 1 Request" or "Surge Test" above to simulate traffic against your website link.</span>
            </div>
          </div>
        </div>

        <!-- Generated Zero-Code Shield Link -->
        <div style="margin-top: 24px;">
          <h3 style="font-size: 0.9rem; font-weight: 600; color: var(--text-muted);">YOUR INSTANT ZERO-CODE PROTECTED PROXY LINK</h3>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            Share this URL or use it anywhere. Requests sent to this link are automatically rate-limited by TBRLS before reaching your target website!
          </p>
          <div class="code-box">
            <span id="proxy-url-display" class="mono" style="color: var(--primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 12px;"></span>
            <button class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem;" onclick="copyProxyUrl()">Copy Link</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: GLOBAL TELEMETRY & ADMIN METRICS (Requires ADMIN_API_KEY) -->
    <div id="section-telemetry" class="hidden">
      <!-- Admin Authentication Form -->
      <div id="login-section" class="card">
        <h2 style="font-size: 1.125rem; margin-bottom: 8px;">Admin Telemetry Authentication</h2>
        <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 16px;">
          Enter your <code>ADMIN_API_KEY</code> from <code>.env</code> to inspect database-wide client metrics and rate limit decisions. Credentials are kept strictly in volatile memory.
        </p>
        <div class="flex" style="flex-wrap: wrap;">
          <input type="password" id="admin-key-input" placeholder="Enter ADMIN_API_KEY" autocomplete="off" style="max-width: 320px;" />
          <button class="btn" onclick="connect()">Authenticate & View Live Metrics</button>
        </div>
        <p id="login-error" class="notice hidden" style="color: var(--danger); font-weight: 600;"></p>
      </div>

      <!-- Authenticated Dashboard View -->
      <div id="dashboard-section" class="hidden">
        <!-- High-Level Stats (Last 1 Hour) -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Active Clients (Last 1h)</div>
            <div id="stat-clients" class="stat-value">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Requests (Last 1h)</div>
            <div id="stat-requests" class="stat-value">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Allowed Requests</div>
            <div id="stat-allowed" class="stat-value" style="color: var(--success);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Denied Requests</div>
            <div id="stat-denied" class="stat-value" style="color: var(--danger);">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Denial Rate</div>
            <div id="stat-rate" class="stat-value">0.0%</div>
          </div>
        </div>

        <!-- Live Metrics Table -->
        <div class="card">
          <div class="flex" style="justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap;">
            <h2 style="font-size: 1.125rem;">Recent Request & Denial Rates by Client</h2>
            <div class="flex">
              <input type="text" id="filter-client" placeholder="Filter by Client Key" oninput="debounceFetch()" style="max-width: 220px;" />
              <button class="btn btn-secondary" onclick="fetchMetrics()">Refresh</button>
              <label class="flex" style="font-size: 0.8rem; cursor: pointer;">
                <input type="checkbox" id="auto-refresh-toggle" onchange="toggleAutoRefresh(this.checked)" checked />
                Auto-refresh (10s)
              </label>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Client Identifier</th>
                <th>Minute Window</th>
                <th>Allowed</th>
                <th>Denied</th>
                <th>Total Requests</th>
                <th>Denial Rate</th>
              </tr>
            </thead>
            <tbody id="metrics-table-body">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No metrics loaded</td></tr>
            </tbody>
          </table>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
            <div style="font-size: 0.8rem; color: var(--text-muted);" id="pagination-info">Page 1 of 1</div>
            <div class="flex">
              <button id="prev-page-btn" class="btn btn-secondary" onclick="changePage(-1)" disabled>Previous</button>
              <button id="next-page-btn" class="btn btn-secondary" onclick="changePage(1)" disabled>Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: INTEGRATION GUIDE -->
    <div id="section-guide" class="hidden">
      <div class="card">
        <h2 style="font-size: 1.25rem; margin-bottom: 12px;">How to Connect Any Website or App</h2>
        <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 18px;">
          Choose the integration style that fits your architecture:
        </p>

        <h3 style="font-size: 1rem; color: var(--primary); margin-bottom: 6px;">Option 1: Zero-Code Reverse Proxy (Easiest)</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
          Route traffic through the TBRLS proxy endpoint. It automatically checks rate limits in PostgreSQL and forwards to your website if allowed:
        </p>
        <div class="code-box">
          <span class="mono" style="color: var(--primary);">http://localhost:3005/proxy?target=https://your-website.com&clientKey=user-123</span>
        </div>

        <h3 style="font-size: 1rem; color: var(--primary); margin-top: 24px; margin-bottom: 6px;">Option 2: 5-Line Backend Check (Production Standard)</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
          In your website's API route or middleware, ask TBRLS if the visitor's IP is allowed before processing:
        </p>
        <pre class="code-box mono" style="display: block; white-space: pre; overflow-x: auto; font-size: 0.8rem; line-height: 1.6; color: #e2e8f0;">
const res = await fetch('http://localhost:3005/v1/check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Check-Key': 'tbrls-check-dev-secret-key-change-me'
  },
  body: JSON.stringify({ clientKey: req.ip, cost: 1 })
}).then(r => r.json());

if (res.decision === 'DENY') {
  return reply.status(429).send({ error: 'Rate limit exceeded', retryAfter: res.retryAfter });
}</pre>
      </div>
    </div>
  </div>

  <script>
    let inMemoryAdminKey = '';
    let currentPage = 1;
    let totalPages = 1;
    let autoRefreshTimer = null;
    let debounceTimer = null;

    // Initialize UI on load
    window.addEventListener('DOMContentLoaded', () => {
      updateProxyUrlDisplay();
      document.getElementById('target-url-input').addEventListener('input', updateProxyUrlDisplay);
      document.getElementById('client-key-input').addEventListener('input', updateProxyUrlDisplay);
    });

    function switchTab(tab) {
      document.getElementById('section-shield').classList.add('hidden');
      document.getElementById('section-telemetry').classList.add('hidden');
      document.getElementById('section-guide').classList.add('hidden');

      document.getElementById('tab-shield-btn').classList.remove('active');
      document.getElementById('tab-telemetry-btn').classList.remove('active');
      document.getElementById('tab-guide-btn').classList.remove('active');

      if (tab === 'shield') {
        document.getElementById('section-shield').classList.remove('hidden');
        document.getElementById('tab-shield-btn').classList.add('active');
      } else if (tab === 'telemetry') {
        document.getElementById('section-telemetry').classList.remove('hidden');
        document.getElementById('tab-telemetry-btn').classList.add('active');
      } else if (tab === 'guide') {
        document.getElementById('section-guide').classList.remove('hidden');
        document.getElementById('tab-guide-btn').classList.add('active');
      }
    }

    function setPreset(url) {
      document.getElementById('target-url-input').value = url;
      updateProxyUrlDisplay();
    }

    function updateProxyUrlDisplay() {
      const target = encodeURIComponent(document.getElementById('target-url-input').value.trim() || 'https://jsonplaceholder.typicode.com/todos/1');
      const client = encodeURIComponent(document.getElementById('client-key-input').value.trim() || 'my-website-visitor');
      const url = window.location.origin + '/proxy?target=' + target + '&clientKey=' + client;
      document.getElementById('proxy-url-display').textContent = url;
    }

    function copyProxyUrl() {
      const url = document.getElementById('proxy-url-display').textContent;
      navigator.clipboard.writeText(url).then(() => {
        alert('Copied proxy link to clipboard!');
      });
    }

    function logMessage(isAllow, text) {
      const log = document.getElementById('activity-log');
      const line = document.createElement('div');
      line.className = 'log-line';
      const timeStr = new Date().toLocaleTimeString();
      line.innerHTML = \`
        <span class="log-time">[\${timeStr}]</span>
        <span class="\${isAllow ? 'log-allow' : 'log-deny'}">\${escapeHtml(text)}</span>
      \`;
      log.prepend(line);
    }

    function clearLogs() {
      document.getElementById('activity-log').innerHTML = '';
    }

    function updateMeter(remaining, capacity, isAllow, retryAfter) {
      const tokensCountEl = document.getElementById('tokens-count');
      const tokensCapEl = document.getElementById('tokens-capacity');
      const barEl = document.getElementById('token-bar');
      const badgeEl = document.getElementById('meter-status-badge');
      const timerEl = document.getElementById('retry-timer-label');

      tokensCountEl.textContent = remaining;
      tokensCapEl.textContent = capacity;

      const pct = Math.max(0, Math.min(100, (remaining / capacity) * 100));
      barEl.style.width = pct + '%';

      if (isAllow) {
        barEl.classList.remove('depleted');
        badgeEl.className = 'badge badge-success';
        badgeEl.textContent = 'ALLOWED (200 OK)';
        timerEl.textContent = 'No wait required';
      } else {
        barEl.classList.add('depleted');
        badgeEl.className = 'badge badge-danger';
        badgeEl.textContent = 'BLOCKED (429 Rate Limit Exceeded)';
        timerEl.textContent = 'Retry available in ~' + (retryAfter || 1) + 's';
      }
    }

    async function sendTestRequest(cost = 1) {
      const target = document.getElementById('target-url-input').value.trim();
      const client = document.getElementById('client-key-input').value.trim() || 'website-visitor';

      if (!target) {
        alert('Please enter a target website URL.');
        return;
      }

      try {
        const res = await fetch('/proxy?target=' + encodeURIComponent(target) + '&clientKey=' + encodeURIComponent(client) + '&cost=' + cost + '&format=simulation');
        const data = await res.json();

        if (res.status === 429 || data.decision === 'DENY') {
          updateMeter(0, data.limit || 10, false, data.retryAfter);
          logMessage(false, \`DENY (429) | Quota depleted for \${client} | Retry in \${data.retryAfter || 1}s\`);
        } else if (res.ok) {
          updateMeter(data.remaining, data.limit || 10, true, null);
          logMessage(true, \`ALLOW (200 OK) | \${data.remaining}/\${data.limit} tokens left | \${data.responseTimeMs}ms | Upstream status \${data.targetStatus}\`);
        } else {
          logMessage(false, \`ERROR (\${res.status}) | \${data.message || 'Request failed'}\`);
        }

        // If admin is connected, refresh telemetry
        if (inMemoryAdminKey) fetchDashboardData(false);
      } catch (err) {
        logMessage(false, 'Network Error: ' + err.message);
      }
    }

    async function sendBurstRequests(count = 10) {
      const btn = document.getElementById('send-burst-btn');
      btn.disabled = true;
      btn.textContent = 'Simulating Traffic...';

      for (let i = 1; i <= count; i++) {
        await sendTestRequest(1);
        await new Promise(r => setTimeout(r, 60)); // 60ms rapid interval
      }

      btn.disabled = false;
      btn.textContent = '🚀 Surge Test (Send 10 Rapid Requests)';
    }

    function resetTank() {
      updateMeter(10, 10, true, null);
      logMessage(true, 'Token tank meter reset to default full capacity.');
    }

    // --- Admin Authentication & Telemetry Fetching ---
    function connect() {
      const input = document.getElementById('admin-key-input');
      const errorMsg = document.getElementById('login-error');
      const key = input.value.trim();

      if (!key) {
        errorMsg.textContent = 'Admin API Key cannot be empty.';
        errorMsg.classList.remove('hidden');
        return;
      }

      inMemoryAdminKey = key;
      input.value = '';
      errorMsg.classList.add('hidden');

      fetchDashboardData(true);
    }

    function disconnect() {
      inMemoryAdminKey = '';
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      document.getElementById('login-section').classList.remove('hidden');
      document.getElementById('dashboard-section').classList.add('hidden');
      document.getElementById('disconnect-btn').classList.add('hidden');
      document.getElementById('auth-badge').className = 'badge badge-warning';
      document.getElementById('auth-badge').textContent = 'Admin Disconnected';
      document.getElementById('metrics-table-body').innerHTML = '<tr><td colspan="6" style="text-align: center;">Disconnected</td></tr>';
    }

    async function fetchDashboardData(isInitial = false) {
      if (!inMemoryAdminKey) return;

      try {
        const summaryRes = await fetch('/v1/admin/metrics/summary', {
          headers: { 'X-Admin-Key': inMemoryAdminKey }
        });

        if (summaryRes.status === 401) {
          throw new Error('Invalid ADMIN_API_KEY credentials.');
        }
        if (!summaryRes.ok) {
          throw new Error('Failed to retrieve summary metrics (HTTP ' + summaryRes.status + ')');
        }

        const summary = await summaryRes.json();
        document.getElementById('stat-clients').textContent = summary.activeClientsCount.toLocaleString();
        document.getElementById('stat-requests').textContent = summary.totalRequests.toLocaleString();
        document.getElementById('stat-allowed').textContent = summary.totalAllowed.toLocaleString();
        document.getElementById('stat-denied').textContent = summary.totalDenied.toLocaleString();
        document.getElementById('stat-rate').textContent = summary.denialRatePercent.toFixed(1) + '%';

        await fetchMetrics();

        document.getElementById('login-section').classList.add('hidden');
        document.getElementById('dashboard-section').classList.remove('hidden');
        document.getElementById('disconnect-btn').classList.remove('hidden');
        document.getElementById('auth-badge').className = 'badge badge-success';
        document.getElementById('auth-badge').textContent = 'Admin Connected';

        if (isInitial && document.getElementById('auto-refresh-toggle').checked) {
          toggleAutoRefresh(true);
        }
      } catch (err) {
        disconnect();
        const errorMsg = document.getElementById('login-error');
        errorMsg.textContent = err.message;
        errorMsg.classList.remove('hidden');
      }
    }

    async function fetchMetrics() {
      if (!inMemoryAdminKey) return;

      const clientFilter = document.getElementById('filter-client').value.trim();
      const params = new URLSearchParams({ page: currentPage, limit: 15 });
      if (clientFilter) params.append('clientKey', clientFilter);

      const res = await fetch('/v1/admin/metrics?' + params.toString(), {
        headers: { 'X-Admin-Key': inMemoryAdminKey }
      });

      if (!res.ok) return;

      const data = await res.json();
      totalPages = data.pagination.totalPages;
      currentPage = data.pagination.page;

      const tbody = document.getElementById('metrics-table-body');
      if (!data.metrics || data.metrics.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No rate limit records found</td></tr>';
      } else {
        tbody.innerHTML = data.metrics.map(m => {
          const rate = m.totalRequests > 0 ? ((m.denyCount / m.totalRequests) * 100).toFixed(1) : '0.0';
          const rateBadgeClass = Number(rate) > 20 ? 'badge-danger' : (Number(rate) > 5 ? 'badge-warning' : 'badge-success');
          return \`
            <tr>
              <td><code>\${escapeHtml(m.clientKey)}</code></td>
              <td style="color: var(--text-muted);">\${new Date(m.bucketMinute).toLocaleTimeString()}</td>
              <td style="color: var(--success); font-weight: 600;">\${m.allowCount.toLocaleString()}</td>
              <td style="color: var(--danger); font-weight: 600;">\${m.denyCount.toLocaleString()}</td>
              <td>\${m.totalRequests.toLocaleString()}</td>
              <td><span class="badge \${rateBadgeClass}">\${rate}%</span></td>
            </tr>
          \`;
        }).join('');
      }

      document.getElementById('pagination-info').textContent =
        'Page ' + currentPage + ' of ' + totalPages + ' (' + data.pagination.totalRecords + ' records)';
      document.getElementById('prev-page-btn').disabled = currentPage <= 1;
      document.getElementById('next-page-btn').disabled = currentPage >= totalPages;
    }

    function changePage(delta) {
      const newPage = currentPage + delta;
      if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        fetchMetrics();
      }
    }

    function debounceFetch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentPage = 1;
        fetchMetrics();
      }, 300);
    }

    function toggleAutoRefresh(enabled) {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      if (enabled && inMemoryAdminKey) {
        autoRefreshTimer = setInterval(() => {
          fetchDashboardData(false);
        }, 10000);
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;

  // Serve the dashboard at /admin/dashboard
  fastify.get('/admin/dashboard', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return reply.send(dashboardHtml);
  });

  // Alias /admin to /admin/dashboard
  fastify.get('/admin', async (_request, reply) => {
    return reply.redirect('/admin/dashboard');
  });
};
