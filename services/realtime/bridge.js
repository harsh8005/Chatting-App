let namespace = null;

const setNamespace = (ns) => {
    namespace = ns;
};

const emitDirect = (event, payload) => {
    if (!namespace) return;
    namespace.emit(event, payload);
};

const emitGroup = (groupId, event, payload) => {
    if (!namespace || !groupId) return;
    namespace.to(`group_${groupId}`).emit(event, payload);
};

module.exports = {
    setNamespace,
    emitDirect,
    emitGroup
};
