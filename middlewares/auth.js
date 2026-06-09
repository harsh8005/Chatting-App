const User = require('../models/userModel');
const RefreshToken = require('../models/refreshTokenModel');
const { createToken, verifyToken, sha256 } = require('../utils/jwt');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret-change-me';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh-secret-change-me';
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 15 * 60);

const getAccessToken = (req) => {
    const bearer = req.headers.authorization;
    if (bearer && bearer.startsWith('Bearer ')) {
        return bearer.slice(7).trim();
    }
    return req.cookies ? req.cookies.access_token : null;
};

const setAccessCookie = (res, token) => {
    res.cookie('access_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000
    });
};

const tryAuthenticateWithRefresh = async (req, res) => {
    const refreshToken = req.cookies ? req.cookies.refresh_token : null;
    if (!refreshToken) return null;

    const refreshVerify = verifyToken({ token: refreshToken, secret: REFRESH_TOKEN_SECRET });
    if (!refreshVerify.valid || !refreshVerify.payload || !refreshVerify.payload.sub) return null;

    const tokenRecord = await RefreshToken.findOne({
        user_id: refreshVerify.payload.sub,
        token_hash: sha256(refreshToken),
        revoked: false,
        expires_at: { $gt: new Date() }
    });
    if (!tokenRecord) return null;

    const user = await User.findById(refreshVerify.payload.sub).select('-password');
    if (!user) return null;

    const newAccessToken = createToken({
        payload: { sub: String(user._id), type: 'access', email: user.email },
        secret: ACCESS_TOKEN_SECRET,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS
    });
    setAccessCookie(res, newAccessToken);
    return user;
};

const isLogin = async (req, res, next) => {
    try {
        if (req.session && req.session.user) {
            req.authUser = req.session.user;
            return next();
        }

        const accessToken = getAccessToken(req);
        const verifyResult = verifyToken({ token: accessToken, secret: ACCESS_TOKEN_SECRET });

        if (verifyResult.valid && verifyResult.payload && verifyResult.payload.sub) {
            const user = await User.findById(verifyResult.payload.sub).select('-password');
            if (user) {
                req.authUser = user;
                req.session.user = user;
                return next();
            }
        }

        const refreshUser = await tryAuthenticateWithRefresh(req, res);
        if (refreshUser) {
            req.authUser = refreshUser;
            req.session.user = refreshUser;
            return next();
        }

        return res.redirect('/');
    } catch (error) {
        console.log(error.message);
        return res.redirect('/');
    }
};

const isLogout = async (req, res, next) => {
    try {
        if (req.session && req.session.user) {
            return res.redirect('/dashboard');
        }

        const accessToken = getAccessToken(req);
        const verifyResult = verifyToken({ token: accessToken, secret: ACCESS_TOKEN_SECRET });
        if (verifyResult.valid) {
            return res.redirect('/dashboard');
        }

        return next();
    } catch (error) {
        console.log(error.message);
        return next();
    }
};

module.exports = {
    isLogin,
    isLogout
};
