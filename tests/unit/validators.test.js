const test = require('node:test');
const assert = require('node:assert/strict');

const { validateEmail, requireFields, sanitizeText } = require('../../utils/validators');

test('validateEmail handles valid and invalid addresses', () => {
    assert.equal(validateEmail('a@b.com'), true);
    assert.equal(validateEmail('bad-email'), false);
});

test('requireFields reports missing fields', () => {
    const result = requireFields({ email: 'x@y.com' }, ['email', 'password']);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['password']);
});

test('sanitizeText trims and max-limits input', () => {
    const value = sanitizeText('   hello world   ', 5);
    assert.equal(value, 'hello');
});
