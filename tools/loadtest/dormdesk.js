// k6 load test — what a busy evening looks like: tenants opening their room page, bills, facilities and the
// parking page (all READ traffic, so the test leaves no data behind). Run through tools/loadtest/run.sh, which
// compares 1 API server vs all API servers behind Nginx.
//   k6 run -e BASE=https://dormdesk-g02.duckdns.org:10201 -e ROOMS=code1,code2 -e LT_TOKEN=... dormdesk.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'https://dormdesk-g02.duckdns.org:10201';
const ROOMS = (__ENV.ROOMS || '').split(',').filter(Boolean);
const VUS = Number(__ENV.VUS || 30);
const THINK = Number(__ENV.THINK || 1);   // seconds between page views (random 0.5x–1.5x)
// the token makes Nginx skip ONLY the per-IP API limit (all users of the test share one IP); off by default
const params = (name) => ({ headers: { 'X-DD-Loadtest': __ENV.LT_TOKEN || '' }, tags: { name } });

export const options = {
  scenarios: {
    evening: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: VUS },
        { duration: __ENV.HOLD || '60s', target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1500'] },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  const code = ROOMS[Math.floor(Math.random() * ROOMS.length)];
  const pages = ['home', 'bills', 'facilities', 'parking'];
  for (const p of pages) {
    const r = http.get(`${BASE}/api/rooms/${code}/${p}`, params(p));
    check(r, { [`${p} 200`]: (x) => x.status === 200 });
  }
  sleep(THINK * (0.5 + Math.random()));   // think time between page views
}
