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
    const log = await AuditLog.create({
        actor_id: actorId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        group_id: groupId,
        metadata
    });
    console.log(
        `[AUDIT] ${action} actor=${String(actorId)} entity=${entityType}:${String(entityId)} log=${String(log._id)}`
    );
};

module.exports = {
    logAudit
};
