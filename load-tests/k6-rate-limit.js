import { check } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics to track rate check outcomes and performance
const allowDecisions = new Counter('rate_check_allow_count');
const denyDecisions = new Counter('rate_check_deny_count');
const checkLatency = new Trend('rate_check_latency_ms');

export const options = {
  scenarios: {
    constant_rate: {
      executor: 'constant-arrival-rate',
      rate: 550, // 550 requests per second target (exceeds >=500 RPS requirement)
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 60,
      maxVUs: 200,
    },
  },
  thresholds: {
    // 95% of requests should complete within 30ms
    http_req_duration: ['p(95)<30', 'p(99)<60'],
    // HTTP failures should be zero (checks returning ALLOW or DENY are both 200 OK)
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

// Pool of 25 distinct client keys to simulate realistic multi-tenant traffic
const CLIENT_KEYS = Array.from({ length: 25 }, (_, i) => `client-load-test-${i + 1}`);

export default function () {
  const randomKey = CLIENT_KEYS[Math.floor(Math.random() * CLIENT_KEYS.length)];

  const payload = JSON.stringify({
    clientKey: randomKey,
    cost: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'RateCheck' },
  };

  const res = http.post(`${BASE_URL}/v1/check`, payload, params);

  checkLatency.add(res.timings.duration);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has ratelimit-limit header': (r) => r.headers['Ratelimit-Limit'] !== undefined,
    'has ratelimit-remaining header': (r) => r.headers['Ratelimit-Remaining'] !== undefined,
    'has ratelimit-reset header': (r) => r.headers['Ratelimit-Reset'] !== undefined,
  });

  if (ok && res.status === 200) {
    try {
      const data = JSON.parse(res.body);
      if (data.decision === 'ALLOW') {
        allowDecisions.add(1);
      } else if (data.decision === 'DENY') {
        denyDecisions.add(1);
      }
    } catch {
      // JSON parse error handled by k6 check
    }
  }
}
