/**
 * Same-origin relay for the price APIs.
 *
 * The travel-planner page calls this function instead of the price APIs
 * directly, because those APIs do not send CORS headers and are blocked
 * by browsers when called from a web page. The function forwards the
 * query to an allow-listed API host and returns the JSON response.
 * The user's API token just passes through; nothing is stored.
 */
const ALLOWED_HOSTS = {
  'api.travelpayouts.com': true,
  'engine.hotellook.com': true
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'method not allowed' }) };
  }

  const params = Object.assign({}, event.queryStringParameters || {});
  const host = params.host;
  const path = params.path || '';
  delete params.host;
  delete params.path;

  if (!ALLOWED_HOSTS[host]) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'host not allowed' }) };
  }
  if (!/^\/[\w\/.\-]*$/.test(path)) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'bad path' }) };
  }

  const qs = new URLSearchParams(params).toString();
  const url = 'https://' + host + path + (qs ? '?' + qs : '');

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.text();
    return { statusCode: res.status, headers, body };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ success: false, error: 'upstream failed: ' + (e && e.message) }) };
  }
};
