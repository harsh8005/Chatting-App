const bcrypt = require('bcrypt');
const User = require('../models/userModel');
const Chat = require('../models/chatModel');
const Group = require('../models/groupModel');
const GroupChat = require('../models/groupChatModel');
const RefreshToken = require('../models/refreshTokenModel');
const AuditLog = require('../models/auditLogModel');
const { createToken, verifyToken, randomToken, sha256 } = require('../utils/jwt');
const { sanitizeText, validateEmail, requireFields, isValidObjectId } = require('../utils/validators');
const { logAudit } = require('../utils/auditLogger');
const realtimeBridge = require('../services/realtime/bridge');
const {
    moderateText,
    summarizeMessages,
    extractTopics,
    transcribeAudioAndSentiment,
    ensureAIBotUser,
    buildBotReply,
    toContextMessages,
    getAiHealthReport
} = require('../services/ai/aiFeatures');

const MEMBER_ROLES = ['owner', 'admin', 'member'];
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret-change-me';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh-secret-change-me';
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 15 * 60);
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 7 * 24 * 60 * 60);

const getIdString = (value) => String(value && value._id ? value._id : value);

const normalizeMembers = (group) => {
    const creatorId = getIdString(group.creator_id);
    const rawMembers = Array.isArray(group.members) ? group.members : [];
    const members = [];
    const seen = new Set();

    for (const raw of rawMembers) {
        let userId = null;
        let role = 'member';

        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            userId = raw.user_id ? getIdString(raw.user_id) : raw._id ? getIdString(raw._id) : null;
            role = raw.role && MEMBER_ROLES.includes(raw.role) ? raw.role : role;
        } else if (raw) {
            userId = getIdString(raw);
        }

        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        if (userId === creatorId) role = 'owner';

        members.push({
            user_id: userId,
            role,
            joined_at: raw && raw.joined_at ? raw.joined_at : new Date(),
            last_read_at: raw && raw.last_read_at ? raw.last_read_at : null
        });
    }

    if (!seen.has(creatorId)) {
        members.unshift({
            user_id: creatorId,
            role: 'owner',
            joined_at: new Date(),
            last_read_at: null
        });
    }

    return members;
};

const getGroupRole = (group, userId) => {
    const normalized = normalizeMembers(group);
    const found = normalized.find((member) => member.user_id === getIdString(userId));
    return found ? found.role : null;
};

const isGroupMember = (group, userId) => !!getGroupRole(group, userId);

const canManageGroup = (group, userId) => {
    const role = getGroupRole(group, userId);
    return role === 'owner' || role === 'admin';
};

const setAccessCookie = (res, token) => {
    res.cookie('access_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000
    });
};

const setRefreshCookie = (res, token) => {
    res.cookie('refresh_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000
    });
};

const issueAuthTokens = async ({ user, req, res }) => {
    const accessToken = createToken({
        payload: { sub: String(user._id), type: 'access', email: user.email },
        secret: ACCESS_TOKEN_SECRET,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS
    });

    const refreshTokenJti = randomToken(24);
    const refreshToken = createToken({
        payload: { sub: String(user._id), jti: refreshTokenJti, type: 'refresh' },
        secret: REFRESH_TOKEN_SECRET,
        expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS
    });

    await RefreshToken.create({
        user_id: user._id,
        token_hash: sha256(refreshToken),
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        created_by_ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        user_agent: req.headers['user-agent'] || ''
    });

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
};

const registerLoad = async (req, res) => {
    try {
        res.render('register');
    } catch (error) {
        console.log(error.message);
    }
};

const register = async (req, res) => {
    try {
        const required = requireFields(req.body, ['name', 'email', 'password']);
        if (!required.ok) {
            return res.status(400).render('register', { message: `Missing fields: ${required.missing.join(', ')}` });
        }
        if (!validateEmail(req.body.email)) {
            return res.status(400).render('register', { message: 'Invalid email format.' });
        }
        if (!req.file) {
            return res.status(400).render('register', { message: 'Profile image is required.' });
        }

        const exists = await User.findOne({ email: sanitizeText(req.body.email, 320).toLowerCase() });
        if (exists) {
            return res.status(400).render('register', { message: 'Email is already registered.' });
        }

        const passwordHash = await bcrypt.hash(req.body.password, 10);

        const user = new User({
            name: sanitizeText(req.body.name, 80),
            email: sanitizeText(req.body.email, 320).toLowerCase(),
            image: 'images/' + req.file.filename,
            password: passwordHash
        });

        await user.save();
        res.render('register', { message: 'Registration Successful' });
    } catch (error) {
        console.log(error.message);
    }
};

const loadLogin = async (req, res) => {
    try {
        res.render('login');
    } catch (error) {
        console.log(error.message);
    }
};

const login = async (req, res) => {
    try {
        const email = sanitizeText(req.body.email, 320).toLowerCase();
        const password = String(req.body.password || '');

        if (!validateEmail(email) || !password) {
            return res.render('login', { message: 'Email and Password is Incorrect!' });
        }

        const userData = await User.findOne({ email });
        if (!userData) {
            return res.render('login', { message: 'Email and Password is Incorrect!' });
        }

        const passwordMatch = await bcrypt.compare(password, userData.password);
        if (!passwordMatch) {
            return res.render('login', { message: 'Email and Password is Incorrect!' });
        }

        await RefreshToken.updateMany({ user_id: userData._id, revoked: false }, { $set: { revoked: true } });
        await issueAuthTokens({ user: userData, req, res });

        req.session.user = userData;
        res.cookie('user', JSON.stringify(userData));
        res.redirect('/dashboard');
    } catch (error) {
        console.log(error.message);
    }
};

const logout = async (req, res) => {
    try {
        const refreshToken = req.cookies ? req.cookies.refresh_token : null;
        if (refreshToken) {
            await RefreshToken.updateMany({ token_hash: sha256(refreshToken), revoked: false }, { $set: { revoked: true } });
        }

        res.clearCookie('user');
        res.clearCookie('access_token');
        res.clearCookie('refresh_token');
        req.session.destroy(() => {
            res.redirect('/');
        });
    } catch (error) {
        console.log(error.message);
    }
};

const refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = req.cookies ? req.cookies.refresh_token : null;
        const verifyResult = verifyToken({ token: refreshToken, secret: REFRESH_TOKEN_SECRET });
        if (!verifyResult.valid || !verifyResult.payload || !verifyResult.payload.sub) {
            return res.status(401).send({ success: false, msg: 'Invalid refresh token.' });
        }

        const record = await RefreshToken.findOne({
            user_id: verifyResult.payload.sub,
            token_hash: sha256(refreshToken),
            revoked: false,
            expires_at: { $gt: new Date() }
        });
        if (!record) {
            return res.status(401).send({ success: false, msg: 'Refresh token revoked/expired.' });
        }

        const user = await User.findById(verifyResult.payload.sub).select('-password');
        if (!user) {
            return res.status(401).send({ success: false, msg: 'User not found.' });
        }

        const accessToken = createToken({
            payload: { sub: String(user._id), type: 'access', email: user.email },
            secret: ACCESS_TOKEN_SECRET,
            expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS
        });
        setAccessCookie(res, accessToken);
        req.session.user = user;

        return res.status(200).send({ success: true });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const loadDashboard = async (req, res) => {
    try {
        const users = await User.find({ _id: { $nin: [req.session.user._id] } });
        const normalizedUsers = users.map((item) => {
            const user = item.toObject ? item.toObject() : item;
            const image = String(user.image || '').toLowerCase();
            if (user.email === 'aibot@chatapp.local' && (!image || image.endsWith('/aibot.png') || image.endsWith('aibot.png'))) {
                user.image = 'images/1720171439274-ayush.png';
            }
            return user;
        });
        res.render('dashboard', { user: req.session.user, users: normalizedUsers });
    } catch (error) {
        console.log(error.message);
    }
};

const getDirectChatHistory = async (req, res) => {
    try {
        const receiverId = req.query.receiver_id;
        if (!isValidObjectId(receiverId)) {
            return res.status(400).send({ success: false, msg: 'Invalid receiver_id.' });
        }

        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
        const skip = (page - 1) * limit;

        const filter = {
            $or: [
                { sender_id: req.session.user._id, receiver_id: receiverId },
                { sender_id: receiverId, receiver_id: req.session.user._id }
            ]
        };

        const total = await Chat.countDocuments(filter);
        const chatsDesc = await Chat.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const chats = chatsDesc.reverse();

        return res.status(200).send({
            success: true,
            data: chats,
            pagination: {
                page,
                limit,
                total,
                has_more: skip + chatsDesc.length < total
            }
        });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const saveChat = async (req, res) => {
    try {
        const message = sanitizeText(req.body.message, 2000);
        if (!message) {
            return res.status(400).send({ success: false, msg: 'Message is required.' });
        }

        const chat = new Chat({
            sender_id: req.session.user._id,
            receiver_id: req.body.receiver_id,
            message
        });

        const newChat = await chat.save();
        res.status(200).send({ success: true, msg: 'Chat inserted!', data: newChat });

        // Async bot reply for direct chat if user messages AI Bot.
        setImmediate(async () => {
            try {
                const botUser = await ensureAIBotUser();
                if (String(req.body.receiver_id) !== String(botUser._id)) return;

                const context = await Chat.find({
                    $or: [
                        { sender_id: req.session.user._id, receiver_id: botUser._id },
                        { sender_id: botUser._id, receiver_id: req.session.user._id }
                    ]
                })
                    .sort({ createdAt: -1 })
                    .limit(30)
                    .populate('sender_id', 'name');

                const reply = await buildBotReply({
                    groupName: 'Direct Chat',
                    message,
                    contextMessages: context
                        .reverse()
                        .map((x) => ({
                            sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
                            message: x.message || ''
                        }))
                });

                const botChat = await Chat.create({
                    sender_id: botUser._id,
                    receiver_id: req.session.user._id,
                    message: sanitizeText(reply, 4000) || 'AI Bot: I received your message.'
                });

                await logAudit({
                    actorId: botUser._id,
                    action: 'DIRECT_AI_BOT_REPLY',
                    entityType: 'Chat',
                    entityId: botChat._id,
                    metadata: { receiver_id: req.session.user._id }
                });

                const botChatPayload = await Chat.findById(botChat._id);
                realtimeBridge.emitDirect('loadNewChat', botChatPayload || botChat);
            } catch (error) {
                console.error('[AI] direct bot reply failed:', error.message);
            }
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const deleteChat = async (req, res) => {
    try {
        const chat = await Chat.findOneAndDelete({ _id: req.body.id, sender_id: req.session.user._id });
        if (!chat) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }
        await logAudit({
            actorId: req.session.user._id,
            action: 'DIRECT_CHAT_DELETE',
            entityType: 'Chat',
            entityId: chat._id,
            metadata: { receiver_id: chat.receiver_id }
        });
        res.status(200).send({ success: true });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const updateChat = async (req, res) => {
    try {
        const message = sanitizeText(req.body.message, 2000);
        if (!message) {
            return res.status(400).send({ success: false, msg: 'Message is required.' });
        }

        const updated = await Chat.findOneAndUpdate(
            { _id: req.body.id, sender_id: req.session.user._id },
            { $set: { message } },
            { new: true }
        );
        if (!updated) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }

        await logAudit({
            actorId: req.session.user._id,
            action: 'DIRECT_CHAT_UPDATE',
            entityType: 'Chat',
            entityId: updated._id,
            metadata: { receiver_id: updated.receiver_id }
        });

        res.status(200).send({ success: true });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const loadGroups = async (req, res) => {
    try {
        const currentUserId = getIdString(req.session.user._id);
        const groups = await Group.find();

        const groupView = groups
            .map((group) => {
                const members = normalizeMembers(group);
                const role = members.find((member) => member.user_id === currentUserId)?.role || null;
                if (!role) return null;

                return {
                    _id: group._id,
                    name: group.name,
                    image: group.image,
                    limit: group.limit,
                    member_count: members.length,
                    role,
                    ai_tags: group.ai_tags || []
                };
            })
            .filter(Boolean)
            .sort((a, b) => String(b._id).localeCompare(String(a._id)));

        const users = await User.find({ _id: { $nin: [req.session.user._id] } }).select('_id name email image');

        res.render('group', {
            user: req.session.user,
            groups: groupView,
            users
        });
    } catch (error) {
        console.log(error.message);
    }
};

const createGroup = async (req, res) => {
    try {
        const name = sanitizeText(req.body.name, 120);
        const limit = Number(req.body.limit);

        if (!name || !limit || limit < 2) {
            return res.status(400).send({ success: false, msg: 'Invalid group name or limit.' });
        }

        const image = req.file ? req.file.path.replace(/\\/g, '/').split('/public/')[1] : '';

        const group = new Group({
            creator_id: req.session.user._id,
            name,
            image,
            limit,
            members: [
                {
                    user_id: req.session.user._id,
                    role: 'owner',
                    joined_at: new Date(),
                    last_read_at: new Date()
                }
            ]
        });

        const savedGroup = await group.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_CREATE',
            entityType: 'Group',
            entityId: savedGroup._id,
            groupId: savedGroup._id,
            metadata: { name: savedGroup.name, limit: savedGroup.limit }
        });
        res.status(200).send({ success: true, msg: 'Group created successfully.', data: savedGroup });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const addGroupMember = async (req, res) => {
    try {
        const group = await Group.findById(req.body.group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }

        if (!canManageGroup(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Only owner/admin can add members.' });
        }

        const members = normalizeMembers(group);
        const targetId = getIdString(req.body.member_id);

        if (members.some((member) => member.user_id === targetId)) {
            return res.status(400).send({ success: false, msg: 'User is already a member.' });
        }

        if (members.length >= group.limit) {
            return res.status(400).send({ success: false, msg: 'Group member limit reached.' });
        }

        members.push({
            user_id: targetId,
            role: 'member',
            joined_at: new Date(),
            last_read_at: null
        });

        group.members = members;
        await group.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_MEMBER_ADD',
            entityType: 'Group',
            entityId: group._id,
            groupId: group._id,
            metadata: { member_id: targetId, role: 'member' }
        });

        res.status(200).send({ success: true, msg: 'Member added successfully.' });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const updateGroupMemberRole = async (req, res) => {
    try {
        const { group_id, member_id, role } = req.body;
        if (!['admin', 'member'].includes(role)) {
            return res.status(400).send({ success: false, msg: 'Invalid role.' });
        }

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }

        if (getGroupRole(group, req.session.user._id) !== 'owner') {
            return res.status(403).send({ success: false, msg: 'Only owner can update roles.' });
        }

        const members = normalizeMembers(group);
        const targetId = getIdString(member_id);
        const target = members.find((member) => member.user_id === targetId);

        if (!target) {
            return res.status(404).send({ success: false, msg: 'Member not found in group.' });
        }
        if (target.role === 'owner') {
            return res.status(400).send({ success: false, msg: 'Owner role cannot be changed.' });
        }

        target.role = role;
        group.members = members;
        await group.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_MEMBER_ROLE_UPDATE',
            entityType: 'Group',
            entityId: group._id,
            groupId: group._id,
            metadata: { member_id: targetId, role }
        });

        res.status(200).send({ success: true, msg: 'Role updated successfully.' });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const removeGroupMember = async (req, res) => {
    try {
        const { group_id, member_id } = req.body;
        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }

        const requesterRole = getGroupRole(group, req.session.user._id);
        if (!['owner', 'admin'].includes(requesterRole)) {
            return res.status(403).send({ success: false, msg: 'Only owner/admin can remove members.' });
        }

        const members = normalizeMembers(group);
        const targetId = getIdString(member_id);
        const target = members.find((member) => member.user_id === targetId);

        if (!target) {
            return res.status(404).send({ success: false, msg: 'Member not found in group.' });
        }
        if (target.role === 'owner') {
            return res.status(400).send({ success: false, msg: 'Owner cannot be removed.' });
        }
        if (requesterRole === 'admin' && target.role === 'admin') {
            return res.status(403).send({ success: false, msg: 'Admin cannot remove another admin.' });
        }

        group.members = members.filter((member) => member.user_id !== targetId);
        await group.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_MEMBER_REMOVE',
            entityType: 'Group',
            entityId: group._id,
            groupId: group._id,
            metadata: { member_id: targetId }
        });

        res.status(200).send({ success: true, msg: 'Member removed successfully.' });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const getGroupMembers = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }
        if (!isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        const members = normalizeMembers(group);
        const userIds = members.map((member) => member.user_id);
        const users = await User.find({ _id: { $in: userIds } }).select('_id name email image is_online');
        const userMap = new Map(users.map((user) => [getIdString(user._id), user]));

        const data = members
            .map((member) => {
                const user = userMap.get(member.user_id);
                if (!user) return null;
                return {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    image: user.image,
                    is_online: user.is_online,
                    role: member.role
                };
            })
            .filter(Boolean);

        res.status(200).send({
            success: true,
            data,
            current_user_role: getGroupRole(group, req.session.user._id)
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const getGroupChatHistory = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
        const skip = (page - 1) * limit;

        const filter = { group_id: group._id };
        const total = await GroupChat.countDocuments(filter);
        const messagesDesc = await GroupChat.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('sender_id', 'name image')
            .populate('reply_to', 'message sender_id')
            .populate('reactions.user_id', 'name');

        const messages = messagesDesc.reverse();
        return res.status(200).send({
            success: true,
            data: messages,
            pagination: {
                page,
                limit,
                total,
                has_more: skip + messagesDesc.length < total
            }
        });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const saveGroupChat = async (req, res) => {
    try {
        const group = await Group.findById(req.body.group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }
        if (!isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'You are not a member of this group.' });
        }

        const message = sanitizeText(req.body.message, 2000);
        const replyTo = req.body.reply_to || null;

        if (!message && !req.file) {
            return res.status(400).send({ success: false, msg: 'Message or attachment is required.' });
        }

        let moderation = {};

        let messageType = 'text';
        let filePayload = {};
        let transcriptPayload = {};
        if (req.file) {
            if (req.file.mimetype.startsWith('image/')) messageType = 'image';
            else if (req.file.mimetype.startsWith('audio/')) messageType = 'audio';
            else messageType = 'file';

            filePayload = {
                file_url: req.file.path.replace(/\\/g, '/').split('/public/')[1],
                file_name: req.file.originalname,
                file_mime: req.file.mimetype,
                file_size: req.file.size
            };

        }

        let replyMessage = null;
        if (replyTo) {
            replyMessage = await GroupChat.findOne({ _id: replyTo, group_id: group._id }).select('_id message sender_id');
            if (!replyMessage) {
                return res.status(400).send({ success: false, msg: 'Invalid reply target.' });
            }
        }

        const chat = new GroupChat({
            group_id: group._id,
            sender_id: req.session.user._id,
            message,
            message_type: messageType,
            reply_to: replyTo,
            read_by: [req.session.user._id],
            moderation,
            transcript: transcriptPayload.transcript || '',
            sentiment: transcriptPayload.sentiment || '',
            sentiment_score: transcriptPayload.sentiment_score || 0,
            ...filePayload
        });

        const saved = await chat.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_CHAT_CREATE',
            entityType: 'GroupChat',
            entityId: saved._id,
            groupId: group._id,
            metadata: { message_type: messageType, has_file: !!req.file, reply_to: replyTo || null }
        });
        const populated = await GroupChat.findById(saved._id)
            .populate('sender_id', 'name image')
            .populate('reply_to', 'message sender_id')
            .populate('reactions.user_id', 'name');

        res.status(200).send({ success: true, data: populated, ai_tags: group.ai_tags || [] });

        // Run AI tasks async to avoid message send latency.
        setImmediate(async () => {
            try {
                if (message) {
                    const moderationResult = await moderateText(message);
                    if (moderationResult && Object.keys(moderationResult).length) {
                        await GroupChat.updateOne(
                            { _id: saved._id },
                            { $set: { moderation: moderationResult } }
                        );
                    }
                }

                if (messageType === 'audio' && req.file && req.file.path) {
                    const transcriptResult = await transcribeAudioAndSentiment({
                        filePath: req.file.path,
                        mimeType: req.file.mimetype
                    });
                    await GroupChat.updateOne(
                        { _id: saved._id },
                        {
                            $set: {
                                transcript: transcriptResult.transcript || '',
                                sentiment: transcriptResult.sentiment || '',
                                sentiment_score: transcriptResult.sentiment_score || 0
                            }
                        }
                    );
                }

                const botTrigger = /(^|\s)@aibot\b/i.test(message) || /^\/ask\b/i.test(message);
                if (botTrigger) {
                    const context = await toContextMessages(group._id);
                    const prompt = message.replace(/@aibot/gi, '').replace(/^\/ask/i, '').trim() || message;
                    let reply = await buildBotReply({
                        groupName: group.name,
                        message: prompt,
                        contextMessages: context
                    });
                    reply = sanitizeText(reply, 4000);
                    if (!reply) {
                        reply = `AI Bot (fallback): I received your message in ${group.name}.`;
                    }

                    const botUser = await ensureAIBotUser();
                    const botChat = await GroupChat.create({
                        group_id: group._id,
                        sender_id: botUser._id,
                        message: reply,
                        message_type: 'text',
                        read_by: [],
                        ai_generated: true
                    });

                    await logAudit({
                        actorId: botUser._id,
                        action: 'GROUP_AI_BOT_REPLY',
                        entityType: 'GroupChat',
                        entityId: botChat._id,
                        groupId: group._id,
                        metadata: {}
                    });

                    const botMessage = await GroupChat.findById(botChat._id)
                        .populate('sender_id', 'name image')
                        .populate('reply_to', 'message sender_id')
                        .populate('reactions.user_id', 'name');

                    realtimeBridge.emitGroup(String(group._id), 'loadNewGroupChat', botMessage);
                }

                const recent = await GroupChat.find({ group_id: group._id, message: { $ne: '' } })
                    .sort({ createdAt: -1 })
                    .limit(60)
                    .populate('sender_id', 'name');

                if (recent.length >= 5) {
                    const tags = await extractTopics(
                        recent.map((x) => ({
                            sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
                            message: x.message
                        }))
                    );
                    if (tags && tags.length) {
                        await Group.updateOne({ _id: group._id }, { $set: { ai_tags: tags } });
                    }
                }
            } catch (error) {
                console.error('[AI] async group tasks failed:', error.message);
            }
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const deleteGroupChat = async (req, res) => {
    try {
        const message = await GroupChat.findById(req.body.id);
        if (!message) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }

        const group = await Group.findById(message.group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }

        const isSender = getIdString(message.sender_id) === getIdString(req.session.user._id);
        if (!isSender && !canManageGroup(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed to delete this message.' });
        }

        await GroupChat.deleteOne({ _id: req.body.id });
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_CHAT_DELETE',
            entityType: 'GroupChat',
            entityId: message._id,
            groupId: message.group_id,
            metadata: {}
        });
        res.status(200).send({ success: true, group_id: message.group_id });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const updateGroupChat = async (req, res) => {
    try {
        const message = await GroupChat.findById(req.body.id);
        if (!message) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }

        const group = await Group.findById(message.group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }

        const isSender = getIdString(message.sender_id) === getIdString(req.session.user._id);
        if (!isSender && !canManageGroup(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed to edit this message.' });
        }

        const newMessage = sanitizeText(req.body.message, 2000);
        if (!newMessage) {
            return res.status(400).send({ success: false, msg: 'Message is required.' });
        }
        await GroupChat.updateOne({ _id: req.body.id }, { $set: { message: newMessage } });
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_CHAT_UPDATE',
            entityType: 'GroupChat',
            entityId: message._id,
            groupId: message.group_id,
            metadata: {}
        });
        res.status(200).send({ success: true, group_id: message.group_id });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const togglePinGroupChat = async (req, res) => {
    try {
        const chat = await GroupChat.findById(req.body.id);
        if (!chat) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }

        const group = await Group.findById(chat.group_id);
        if (!group) {
            return res.status(404).send({ success: false, msg: 'Group not found.' });
        }
        if (!canManageGroup(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Only owner/admin can pin messages.' });
        }

        const nextPinned = !chat.is_pinned;
        chat.is_pinned = nextPinned;
        chat.pinned_by = nextPinned ? req.session.user._id : null;
        chat.pinned_at = nextPinned ? new Date() : null;
        await chat.save();
        await logAudit({
            actorId: req.session.user._id,
            action: nextPinned ? 'GROUP_CHAT_PIN' : 'GROUP_CHAT_UNPIN',
            entityType: 'GroupChat',
            entityId: chat._id,
            groupId: chat.group_id,
            metadata: {}
        });

        res.status(200).send({
            success: true,
            data: {
                id: chat._id,
                is_pinned: chat.is_pinned,
                group_id: chat.group_id
            }
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const reactGroupChat = async (req, res) => {
    try {
        const { id, emoji } = req.body;
        if (!emoji || emoji.length > 8) {
            return res.status(400).send({ success: false, msg: 'Invalid emoji.' });
        }

        const chat = await GroupChat.findById(id);
        if (!chat) {
            return res.status(404).send({ success: false, msg: 'Message not found.' });
        }

        const group = await Group.findById(chat.group_id);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        const userId = getIdString(req.session.user._id);
        const existing = chat.reactions.find((reaction) => getIdString(reaction.user_id) === userId);
        if (existing && existing.emoji === emoji) {
            chat.reactions = chat.reactions.filter((reaction) => getIdString(reaction.user_id) !== userId);
        } else if (existing) {
            existing.emoji = emoji;
        } else {
            chat.reactions.push({ user_id: req.session.user._id, emoji });
        }

        await chat.save();
        await logAudit({
            actorId: req.session.user._id,
            action: 'GROUP_CHAT_REACT',
            entityType: 'GroupChat',
            entityId: chat._id,
            groupId: chat.group_id,
            metadata: { emoji }
        });
        const populated = await GroupChat.findById(chat._id).populate('reactions.user_id', 'name');

        res.status(200).send({
            success: true,
            data: { id: chat._id, group_id: chat.group_id, reactions: populated.reactions }
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const markGroupRead = async (req, res) => {
    try {
        if (!isValidObjectId(req.body.group_id)) {
            return res.status(200).send({ success: true, ignored: true });
        }

        const group = await Group.findById(req.body.group_id);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        await GroupChat.updateMany(
            { group_id: group._id, read_by: { $ne: req.session.user._id } },
            { $addToSet: { read_by: req.session.user._id } }
        );

        const members = normalizeMembers(group).map((member) => ({
            ...member,
            last_read_at: member.user_id === getIdString(req.session.user._id) ? new Date() : member.last_read_at
        }));
        group.members = members;
        await group.save();

        res.status(200).send({ success: true, group_id: group._id, user_id: req.session.user._id });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const search = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) {
            return res.status(200).send({ success: true, data: { users: [], groups: [], messages: [], direct: [] } });
        }

        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const currentUserId = getIdString(req.session.user._id);

        const users = await User.find({
            _id: { $nin: [req.session.user._id] },
            $or: [{ name: regex }, { email: regex }]
        })
            .select('_id name email image is_online')
            .limit(10);

        const allGroups = await Group.find({ name: regex }).limit(20);
        const groups = allGroups
            .filter((group) => isGroupMember(group, currentUserId))
            .map((group) => ({
                _id: group._id,
                name: group.name,
                image: group.image
            }));

        const memberGroups = await Group.find();
        const groupIds = memberGroups
            .filter((group) => isGroupMember(group, currentUserId))
            .map((group) => group._id);

        const messages = await GroupChat.find({
            group_id: { $in: groupIds },
            $or: [{ message: regex }, { file_name: regex }]
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('sender_id', 'name')
            .populate('group_id', 'name');

        const direct = await Chat.find({
            $or: [{ sender_id: req.session.user._id }, { receiver_id: req.session.user._id }],
            message: regex
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('sender_id', 'name')
            .populate('receiver_id', 'name');

        res.status(200).send({
            success: true,
            data: { users, groups, messages, direct }
        });
    } catch (error) {
        res.status(400).send({ success: false, msg: error.message });
    }
};

const getGroupAiSummary = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        const limit = Math.min(Math.max(Number(req.query.limit || 80), 10), 200);
        const chats = await GroupChat.find({ group_id: group._id, message: { $ne: '' } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('sender_id', 'name');

        const summary = await summarizeMessages(
            chats.reverse().map((x) => ({
                sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
                message: x.message
            })),
            'chat summary'
        );

        return res.status(200).send({ success: true, data: { summary } });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const getGroupAiRecap = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        const sinceHours = Math.min(Math.max(Number(req.query.hours || 24), 1), 168);
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
        const chats = await GroupChat.find({
            group_id: group._id,
            createdAt: { $gte: since },
            message: { $ne: '' }
        })
            .sort({ createdAt: 1 })
            .populate('sender_id', 'name');

        const recap = await summarizeMessages(
            chats.map((x) => ({
                sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
                message: x.message
            })),
            'meeting recap'
        );

        group.ai_last_recap = recap;
        await group.save();

        return res.status(200).send({ success: true, data: { recap } });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const getGroupAiTopics = async (req, res) => {
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group || !isGroupMember(group, req.session.user._id)) {
            return res.status(403).send({ success: false, msg: 'Not allowed.' });
        }

        if (!group.ai_tags || !group.ai_tags.length) {
            const chats = await GroupChat.find({ group_id: group._id, message: { $ne: '' } })
                .sort({ createdAt: -1 })
                .limit(80)
                .populate('sender_id', 'name');
            const tags = await extractTopics(
                chats.reverse().map((x) => ({
                    sender_name: x.sender_id && x.sender_id.name ? x.sender_id.name : 'User',
                    message: x.message
                }))
            );
            group.ai_tags = tags;
            await group.save();
        }

        return res.status(200).send({
            success: true,
            data: {
                tags: group.ai_tags || [],
                last_recap: group.ai_last_recap || ''
            }
        });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const getAiHealth = async (req, res) => {
    try {
        const report = await getAiHealthReport();
        return res.status(200).send({ success: true, data: report });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

const getAuditLogs = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        const skip = (page - 1) * limit;

        const query = { actor_id: req.session.user._id };
        if (req.query.group_id && isValidObjectId(req.query.group_id)) {
            const group = await Group.findById(req.query.group_id);
            if (!group || !isGroupMember(group, req.session.user._id)) {
                return res.status(403).send({ success: false, msg: 'Not allowed.' });
            }
            query.group_id = req.query.group_id;
            if (canManageGroup(group, req.session.user._id)) {
                delete query.actor_id;
            }
        }
        if (req.query.action) {
            query.action = sanitizeText(req.query.action, 64);
        }

        const total = await AuditLog.countDocuments(query);
        const logs = await AuditLog.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('actor_id', 'name email')
            .populate('group_id', 'name');

        return res.status(200).send({
            success: true,
            data: logs,
            pagination: {
                page,
                limit,
                total,
                has_more: skip + logs.length < total
            }
        });
    } catch (error) {
        return res.status(400).send({ success: false, msg: error.message });
    }
};

module.exports = {
    register,
    registerLoad,
    loadLogin,
    login,
    refreshAccessToken,
    logout,
    loadDashboard,
    getDirectChatHistory,
    saveChat,
    deleteChat,
    updateChat,
    loadGroups,
    createGroup,
    addGroupMember,
    updateGroupMemberRole,
    removeGroupMember,
    getGroupMembers,
    getGroupChatHistory,
    saveGroupChat,
    deleteGroupChat,
    updateGroupChat,
    togglePinGroupChat,
    reactGroupChat,
    markGroupRead,
    search,
    getAiHealth,
    getGroupAiSummary,
    getGroupAiRecap,
    getGroupAiTopics,
    getAuditLogs
};
