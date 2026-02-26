const store = new Map();

const getClientKey = (req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userId = req.session && req.session.user ? req.session.user._id : 'anon';
    return `${ip}:${userId}`;
};

const rateLimit = ({ windowMs, max }) => {
    return (req, res, next) => {
        const key = getClientKey(req);
        const now = Date.now();
        const state = store.get(key) || { count: 0, resetAt: now + windowMs };

        if (now > state.resetAt) {
            state.count = 0;
            state.resetAt = now + windowMs;
        }

        state.count += 1;
        store.set(key, state);

        if (state.count > max) {
            return res.status(429).send({
                success: false,
                msg: 'Too many requests. Please try again shortly.'
            });
        }

        return next();
    };
};

module.exports = {
    rateLimit
};
