#!/usr/bin/env node
import http from 'node:http';
import url from 'node:url';

const PORT = 8787;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || req.url;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Codex Flow Local Server',
      version: '1.0.0',
      endpoints: {
        'POST /run': 'Execute agent tasks',
        'GET /health': 'Health check'
      },
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  if (req.method === 'POST' && pathname === '/run') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const { agentId, alias, task } = JSON.parse(body);
        
        // Simulate agent work
        const response = {
          summary: `Task completed by ${agentId} (${alias})`,
          output: {
            agentId,
            alias,
            task: String(task).slice(0, 100),
            status: 'completed',
            timestamp: new Date().toISOString(),
            simulated: true
          }
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON', details: error.message }));
      }
    });
    return;
  }
  
  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
});

server.listen(PORT, () => {
  console.log(`🚀 Codex Flow Server running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   http://127.0.0.1:${PORT}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   GET  /          - Server info`);
  console.log(`   GET  /health    - Health check`);
  console.log(`   POST /run       - Execute agent tasks`);
  console.log(`\n🔧 Test with:`);
  console.log(`   curl http://localhost:${PORT}`);
  console.log(`   curl http://localhost:${PORT}/health`);
  console.log(`\nPress Ctrl+C to stop the server`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});
