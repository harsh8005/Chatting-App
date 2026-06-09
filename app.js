require('dotenv').config();

const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const userRoute = require('./routes/userRoute');
const User = require('./models/userModel');
const Chat = require('./models/chatModel');
const Group = require('./models/groupModel');
const GroupChat = require('./models/groupChatModel');
const realtimeBridge = require('./services/realtime/bridge');

mongoose.connect('mongodb://127.0.0.1:27017/dynamic-chat-app');

const app = express();
const server = http.Server(app);

app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - startedAt;
        console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});

app.use('/', userRoute);

const io = socketIo(server);
const usp = io.of('/user-namespace');
realtimeBridge.setNamespace(usp);

const getIdString = (value) => String(value && value._id ? value._id : value);
const normalizeMembers = (group) => {
    const creatorId = getIdString(group.creator_id);
    const list = Array.isArray(group.members) ? group.members : [];
    const members = [];
    const seen = new Set();

    for (const raw of list) {
        let userId = null;
        let role = 'member';
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            userId = raw.user_id ? getIdString(raw.user_id) : raw._id ? getIdString(raw._id) : null;
            role = raw.role || role;
        } else if (raw) {
            userId = getIdString(raw);
        }
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        if (userId === creatorId) role = 'owner';
        members.push({ user_id: userId, role });
    }
    if (!seen.has(creatorId)) members.unshift({ user_id: creatorId, role: 'owner' });
    return members;
};

const isGroupMember = (group, userId) =>
    normalizeMembers(group).some((member) => member.user_id === getIdString(userId));

usp.on('connection', async function (socket) {
    const userId = socket.handshake.auth.token;
    if (!userId) return;

    await User.findOneAndUpdate({ _id: userId }, { $set: { is_online: '1' } });
    socket.broadcast.emit('getOnlineUser', { user_id: userId });

    socket.on('disconnect', async function () {
        const disconnectedUserId = socket.handshake.auth.token;
        await User.findOneAndUpdate({ _id: disconnectedUserId }, { $set: { is_online: '0' } });
        socket.broadcast.emit('getOfflineUser', { user_id: disconnectedUserId });
    });

    socket.on('newChat', function (data) {
        socket.broadcast.emit('loadNewChat', data);
    });

    socket.on('existsChat', async function (data) {
        const page = Math.max(Number(data.page || 1), 1);
        const limit = Math.min(Math.max(Number(data.limit || 30), 1), 100);
        const skip = (page - 1) * limit;

        const filter = {
            $or: [
                { sender_id: data.sender_id, receiver_id: data.receiver_id },
                { sender_id: data.receiver_id, receiver_id: data.sender_id }
            ]
        };

        const total = await Chat.countDocuments(filter);
        const chatsDesc = await Chat.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const chats = chatsDesc.reverse();

        socket.emit('loadChats', {
            chats,
            pagination: {
                page,
                limit,
                total,
                has_more: skip + chatsDesc.length < total
            }
        });
    });

    socket.on('chatDeleted', function (id) {
        socket.broadcast.emit('chatMessageDeleted', id);
    });

    socket.on('chatUpdated', function (data) {
        socket.broadcast.emit('chatMessageUpdated', data);
    });

    socket.on('joinGroup', function (groupId) {
        socket.join(`group_${groupId}`);
    });

    socket.on('existsGroupChat', async function (data) {
        const page = Math.max(Number(data.page || 1), 1);
        const limit = Math.min(Math.max(Number(data.limit || 30), 1), 100);
        const skip = (page - 1) * limit;

        const group = await Group.findById(data.group_id);
        if (!group || !isGroupMember(group, data.user_id)) {
            return socket.emit('loadGroupChats', { chats: [], group_id: data.group_id });
        }

        await GroupChat.updateMany(
            { group_id: group._id, read_by: { $ne: data.user_id } },
            { $addToSet: { read_by: data.user_id } }
        );

        const filter = { group_id: data.group_id };
        const total = await GroupChat.countDocuments(filter);
        const chatsDesc = await GroupChat.find(filter)
            .populate('sender_id', 'name image')
            .populate('reply_to', 'message sender_id')
            .populate('reactions.user_id', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const chats = chatsDesc.reverse();

        socket.emit('loadGroupChats', {
            chats,
            group_id: data.group_id,
            pagination: {
                page,
                limit,
                total,
                has_more: skip + chatsDesc.length < total
            }
        });
        usp.to(`group_${data.group_id}`).emit('groupReadReceipt', { group_id: data.group_id, user_id: data.user_id });
    });

    socket.on('newGroupChat', function (data) {
        usp.to(`group_${data.group_id}`).emit('loadNewGroupChat', data);
    });

    socket.on('groupChatDeleted', function (data) {
        usp.to(`group_${data.group_id}`).emit('groupMessageDeleted', data.id);
    });

    socket.on('groupChatUpdated', function (data) {
        usp.to(`group_${data.group_id}`).emit('groupMessageUpdated', data);
    });

    socket.on('groupMessagePinned', function (data) {
        usp.to(`group_${data.group_id}`).emit('groupMessagePinnedState', data);
    });

    socket.on('groupMessageReacted', function (data) {
        usp.to(`group_${data.group_id}`).emit('groupMessageReactionsUpdated', data);
    });

    socket.on('groupTyping', function (data) {
        socket.to(`group_${data.group_id}`).emit('showGroupTyping', data);
    });
});

server.listen(3000, function () {
    console.log('Server is running');
});
