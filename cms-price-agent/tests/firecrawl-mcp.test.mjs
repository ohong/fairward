import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

// Exercise the exact MCP binary configured for Claude, not a reimplementation.
test('configured MCP uses v2 search/map/scrape and never calls Extract', { timeout: 120_000 }, async (t) => {
  const requests = [];
  const page = 'https://hospital.example/prices';
  const mock = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body: JSON.parse(body || '{}') });
    res.setHeader('Content-Type', 'application/json');
    const responses = {
      '/v2/search': { success: true, data: { web: [{ url: page, title: 'Prices', description: 'Hospital prices' }] } },
      '/v2/map': { success: true, links: [{ url: page, title: 'Prices' }] },
      '/v2/scrape': { success: true, data: { markdown: '[Download](https://hospital.example/prices.csv)', links: ['https://hospital.example/prices.csv'], metadata: { sourceURL: page, statusCode: 200 } } },
    };
    res.statusCode = responses[req.url] ? 200 : 500;
    res.end(JSON.stringify(responses[req.url] || { error: 'Unexpected endpoint' }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const config = JSON.parse(await readFile(new URL('../mcp-config.json', import.meta.url), 'utf8')).mcpServers.firecrawl;
  assert.deepEqual(config.args, ['-y', 'firecrawl-mcp@3.39.0']);
  const child = spawn(config.command, config.args, {
    // Do not inherit credentials, cloud mode, proxies, or remote API overrides.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, FIRECRAWL_API_KEY: 'fc-local-test-only', FIRECRAWL_API_URL: `http://127.0.0.1:${mock.address().port}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  t.after(() => { lines.close(); child.kill(); });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const pending = new Map();
  let id = 0;
  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}\n${stderr}`)); }, 90_000);
      pending.set(requestId, (response) => { clearTimeout(timer); response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fairward-compatibility-test', version: '1.0.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list', {});
  assert.ok(!tools.tools.some((tool) => tool.name === 'firecrawl_extract'));
  for (const [name, args, endpoint] of [
    ['firecrawl_search', { query: 'hospital prices', limit: 3 }, '/v2/search'],
    ['firecrawl_map', { url: page, search: 'prices' }, '/v2/map'],
    ['firecrawl_scrape', { url: page, formats: ['markdown', 'links'] }, '/v2/scrape'],
  ]) {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.ok(JSON.stringify(result).includes('hospital.example'), 'Response must preserve returned content');
    const request = requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.path, endpoint);
    for (const [key, value] of Object.entries(args)) assert.deepEqual(request.body[key], value);
  }
  const count = requests.length;
  const retired = await rpc('tools/call', { name: 'firecrawl_extract', arguments: { urls: [page] } });
  assert.equal(retired.isError, true);
  assert.match(JSON.stringify(retired), /deprecated/i);
  assert.equal(requests.length, count, 'Extract must not make an API request');
  assert.deepEqual(requests.map((request) => request.path), ['/v2/search', '/v2/map', '/v2/scrape']);
});
