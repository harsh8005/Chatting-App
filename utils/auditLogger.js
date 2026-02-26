const AuditLog = require('../models/auditLogModel');

const logAudit = async ({
    actorId,
    action,
    entityType,
    entityId,
    groupId = null,
    metadata = {}
}) => {
    if (!actorId || !action || !entityType || !entityId) return;
    await AuditLog.create({
        actor_id: actorId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        group_id: groupId,
        metadata
    });
};

module.exports = {
    logAudit
};
