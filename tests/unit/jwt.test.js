const test = require('node:test');
const assert = require('node:assert/strict');

const { createToken, verifyToken } = require('../../utils/jwt');

test('jwt util creates and verifies valid token', () => {
    const secret = 'unit-secret';
    const token = createToken({
        payload: { sub: 'user-1', type: 'access' },
        secret,
        expiresInSeconds: 120
    });

    const result = verifyToken({ token, secret });
    assert.equal(result.valid, true);
    assert.equal(result.payload.sub, 'user-1');
    assert.equal(result.payload.type, 'access');
});

test('jwt util rejects token with wrong secret', () => {
    const token = createToken({
        payload: { sub: 'user-1' },
        secret: 'secret-a',
        expiresInSeconds: 120
    });

    const result = verifyToken({ token, secret: 'secret-b' });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_signature');
});
