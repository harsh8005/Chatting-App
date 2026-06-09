const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
    {
        actor_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        action: {
            type: String,
            required: true,
            index: true
        },
        entity_type: {
            type: String,
            required: true,
            index: true
        },
        entity_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group',
            default: null,
            index: true
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

auditLogSchema.index({ createdAt: -1, action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
