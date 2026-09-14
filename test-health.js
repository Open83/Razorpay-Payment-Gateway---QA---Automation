const app = require('./src/app.js').default || require('./src/app.js');
const http = require('http');

// Wait a moment for app to start
setTimeout(() => {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET',
    timeout: 2000
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        console.log('✅ Health check passed:', result.status);
        process.exit(0);
      } catch (e) {
        console.error('❌ Health response invalid JSON');
        process.exit(1);
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ Health check failed:', e.message);
    process.exit(1);
  });

  req.end();
}, 1000);
