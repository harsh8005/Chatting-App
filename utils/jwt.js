const crypto = require('crypto');

const base64UrlEncode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const base64UrlDecode = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (value.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
};

const sign = (data, secret) =>
    crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const createToken = ({ payload, secret, expiresInSeconds }) => {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds
    };
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerPart = base64UrlEncode(header);
    const payloadPart = base64UrlEncode(fullPayload);
    const signature = sign(`${headerPart}.${payloadPart}`, secret);
    return `${headerPart}.${payloadPart}.${signature}`;
};

const verifyToken = ({ token, secret }) => {
    if (!token || typeof token !== 'string') return { valid: false, reason: 'missing_token' };
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'invalid_token_format' };

    const [headerPart, payloadPart, signature] = parts;
    const expectedSignature = sign(`${headerPart}.${payloadPart}`, secret);
    if (signature !== expectedSignature) return { valid: false, reason: 'invalid_signature' };

    let payload;
    try {
        payload = base64UrlDecode(payloadPart);
    } catch (error) {
        return { valid: false, reason: 'invalid_payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= payload.exp) return { valid: false, reason: 'token_expired', payload };

    return { valid: true, payload };
};

const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('hex');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

module.exports = {
    createToken,
    verifyToken,
    randomToken,
    sha256
};
