const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        token_hash: {
            type: String,
            required: true,
            index: true
        },
        expires_at: {
            type: Date,
            required: true,
            index: true
        },
        revoked: {
            type: Boolean,
            default: false,
            index: true
        },
        created_by_ip: {
            type: String,
            default: ''
        },
        user_agent: {
            type: String,
            default: ''
        }
    },
    { timestamps: true }
);

refreshTokenSchema.index({ user_id: 1, revoked: 1, expires_at: -1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
