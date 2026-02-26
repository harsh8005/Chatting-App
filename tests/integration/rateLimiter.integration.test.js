const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const { rateLimit } = require('../../middlewares/rateLimiter');

const hit = (port, path) =>
    new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'GET'
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );
        req.on('error', reject);
        req.end();
    });

test('rate limiter blocks requests after max threshold', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 2000, max: 2 }));
    app.get('/limited', (req, res) => res.status(200).send('ok'));

    const server = app.listen(0);
    const port = server.address().port;

    try {
        const first = await hit(port, '/limited');
        const second = await hit(port, '/limited');
        const third = await hit(port, '/limited');

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(third.status, 429);
    } finally {
        server.close();
    }
});
