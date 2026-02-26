const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const user_route = express();
const userController = require('../controllers/userController');
const auth = require('../middlewares/auth');
const { rateLimit } = require('../middlewares/rateLimiter');
const { isValidObjectId } = require('../utils/validators');

const { SESSION_SECRET } = process.env;
user_route.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        name: 'chat.sid',
        cookie: {
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 1000 * 60 * 60 * 8
        }
    })
);
user_route.use(cookieParser());
user_route.use(bodyParser.json());
user_route.use(bodyParser.urlencoded({ extended: true }));

user_route.set('view engine', 'ejs');
user_route.set('views', './views');
user_route.use(express.static('public'));

const imageDir = path.join(__dirname, '../public/images');
const messageUploadDir = path.join(__dirname, '../public/uploads/messages');
fs.mkdirSync(imageDir, { recursive: true });
fs.mkdirSync(messageUploadDir, { recursive: true });

const safeName = (name) => name.replace(/[^\w.\-]/g, '_');

const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, imageDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + safeName(file.originalname));
    }
});

const messageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, messageUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + safeName(file.originalname));
    }
});

const imageUpload = multer({
    storage: imageStorage,
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) return cb(null, true);
        cb(new Error('Only image upload is allowed.'));
    }
});

const messageUpload = multer({
    storage: messageStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const allowed = [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/gif',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/webm',
            'audio/ogg',
            'application/pdf',
            'text/plain'
        ];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Unsupported file type.'));
    }
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const validateObjectIds = (fields) => (req, res, next) => {
    for (const field of fields) {
        const value = req.body[field] || req.params[field] || req.query[field];
        if (value && !isValidObjectId(value)) {
            return res.status(400).send({ success: false, msg: `Invalid ${field}.` });
        }
    }
    return next();
};

user_route.get('/register', auth.isLogout, userController.registerLoad);
user_route.post('/register', authLimiter, imageUpload.single('image'), userController.register);

user_route.get('/', auth.isLogout, userController.loadLogin);
user_route.post('/', authLimiter, userController.login);
user_route.post('/refresh-token', userController.refreshAccessToken);
user_route.get('/logout', auth.isLogin, userController.logout);
user_route.get('/dashboard', auth.isLogin, userController.loadDashboard);

user_route.get('/chat-history', auth.isLogin, userController.getDirectChatHistory);
user_route.post('/save-chat', auth.isLogin, messageLimiter, validateObjectIds(['receiver_id']), userController.saveChat);
user_route.post('/delete-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.deleteChat);
user_route.post('/update-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.updateChat);

user_route.get('/groups', auth.isLogin, userController.loadGroups);
user_route.post('/create-group', auth.isLogin, messageLimiter, imageUpload.single('image'), userController.createGroup);
user_route.post('/add-group-member', auth.isLogin, messageLimiter, validateObjectIds(['group_id', 'member_id']), userController.addGroupMember);
user_route.post('/update-group-member-role', auth.isLogin, messageLimiter, validateObjectIds(['group_id', 'member_id']), userController.updateGroupMemberRole);
user_route.post('/remove-group-member', auth.isLogin, messageLimiter, validateObjectIds(['group_id', 'member_id']), userController.removeGroupMember);
user_route.get('/group-members/:groupId', auth.isLogin, validateObjectIds(['groupId']), userController.getGroupMembers);

user_route.get('/group-chat-history/:groupId', auth.isLogin, validateObjectIds(['groupId']), userController.getGroupChatHistory);
user_route.post('/save-group-chat', auth.isLogin, messageLimiter, validateObjectIds(['group_id']), messageUpload.single('attachment'), userController.saveGroupChat);
user_route.post('/delete-group-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.deleteGroupChat);
user_route.post('/update-group-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.updateGroupChat);
user_route.post('/toggle-pin-group-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.togglePinGroupChat);
user_route.post('/react-group-chat', auth.isLogin, messageLimiter, validateObjectIds(['id']), userController.reactGroupChat);
user_route.post('/mark-group-read', auth.isLogin, messageLimiter, validateObjectIds(['group_id']), userController.markGroupRead);

user_route.get('/search', auth.isLogin, searchLimiter, userController.search);
user_route.get('/audit-logs', auth.isLogin, userController.getAuditLogs);

user_route.get('*', function (req, res) {
    res.redirect('/');
});

module.exports = user_route;
