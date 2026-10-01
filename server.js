// Addon de test pentru Stremio / Nuvio / Arvio / Wuplay.
// Nu sincronizeaza nimic: doar NOTEAZA ce cere aplicatia.
// Rulare: node server.js   (are nevoie doar de Node.js 18+)

const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 7000;
const LOGS_KEY = process.env.LOGS_KEY || '';
const LOG_FILE = 'requests.jsonl';
const recent = []; // ultimele cereri, pentru pagina /logs

const manifest = {
  id: 'community.request.logger',
  version: '0.1.0',
  name: 'Request Logger (test)',
  description: 'Noteaza ce trimit aplicatiile. Nu sincronizeaza subtitrari.',
  resources: ['subtitles'],
  types: ['movie', 'series', 'other', 'tv', 'channel'],
  catalogs: [],
};

const DUMMY_SRT =
  '1\n00:00:01,000 --> 00:00:06,000\nLogger addon: aplicatia a cerut subtitrarea.\n\n' +
  '2\n00:00:07,000 --> 00:00:12,000\nDaca vezi asta, addonul functioneaza.\n';

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// "videoHash=abc&videoSize=123&filename=x.mkv" -> { videoHash:'abc', ... }
function parseExtra(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[safeDecode(part.slice(0, i))] = safeDecode(part.slice(i + 1));
  }
  return out;
}

function record(req, extraInfo) {
  const h = req.headers;
  const entry = {
    time: new Date().toISOString(),
    method: req.method,
    url: safeDecode(req.url),
    userAgent: h['user-agent'] || null,
    origin: h['origin'] || null,
    referer: h['referer'] || null,
    acceptLanguage: h['accept-language'] || null,
    xForwardedFor: h['x-forwarded-for'] || null,
    clientIp: req.socket.remoteAddress,
    allHeaderNames: Object.keys(h),
    ...extraInfo,
  };
  const line = JSON.stringify(entry);
  console.log(line);
  recent.push(line);
  if (recent.length > 200) recent.shift();
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname;

  if (req.method === 'OPTIONS') {
    // Aplicatiile web trimit intai o cerere "preflight". O notam: daca apare
    // in jurnal dar manifestul nu, problema e la permisiuni/HTTPS, nu la retea.
    record(req, {
      kind: 'preflight',
      privateNetworkRequested: !!req.headers['access-control-request-private-network'],
    });
    const h = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (req.headers['access-control-request-private-network']) {
      h['Access-Control-Allow-Private-Network'] = 'true';
    }
    res.writeHead(204, h);
    return res.end();
  }

  if (path === '/manifest.json') {
    record(req, { kind: 'manifest' });
    return send(res, 200, manifest);
  }

  if (path === '/' || path === '/health') {
    return send(res, 200, 'ok', 'text/plain');
  }

  if (path === '/logs') {
    // Pe un server public, jurnalul se protejeaza cu o cheie (LOGS_KEY).
    if (LOGS_KEY && u.searchParams.get('key') !== LOGS_KEY) {
      return send(res, 401, 'cheie lipsa sau gresita', 'text/plain');
    }
    return send(res, 200, recent.join('\n\n') || '(nicio cerere inca)', 'text/plain');
  }

  if (path === '/dummy.srt') {
    record(req, { kind: 'subtitle-download' });
    return send(res, 200, DUMMY_SRT, 'text/plain');
  }

  // /subtitles/<type>/<id>.json  sau  /subtitles/<type>/<id>/<extra>.json
  const m = path.match(/^\/subtitles\/([^/]+)\/([^/]+?)(?:\/([^/]+?))?\.json$/);
  if (m) {
    const type = safeDecode(m[1]);
    const id = safeDecode(m[2]);
    const extra = parseExtra(m[3] ? m[3] : '');
    // unele aplicatii pun extra in query string
    for (const [k, v] of u.searchParams) extra[k] = v;

    record(req, {
      kind: 'subtitles-request',
      type,
      id,
      extra,
      has: {
        videoHash: 'videoHash' in extra,
        videoSize: 'videoSize' in extra,
        filename: 'filename' in extra,
      },
    });

    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base = `${proto}://${req.headers.host}`;
    return send(res, 200, {
      subtitles: [{ id: 'logger-1', url: `${base}/dummy.srt`, lang: 'eng' }],
    });
  }

  // orice altceva: il notam, poate ne arata ceva neasteptat
  record(req, { kind: 'other' });
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Logger addon pornit pe portul ${PORT}`);
  console.log(`Manifest:  http://127.0.0.1:${PORT}/manifest.json`);
  console.log(`Jurnal:    http://127.0.0.1:${PORT}/logs`);
});
