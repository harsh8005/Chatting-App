const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const sanitizeText = (value, max = 2000) => {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, max);
};

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

const requireFields = (body, fields) => {
    const missing = fields.filter((field) => !String(body[field] ?? '').trim());
    return { ok: missing.length === 0, missing };
};

module.exports = {
    isValidObjectId,
    sanitizeText,
    validateEmail,
    requireFields
};
