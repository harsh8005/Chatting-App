# Chat App (Real-Time Messaging Platform)

A full-stack real-time chat application built with Node.js, Express, MongoDB, EJS, jQuery, and Socket.IO.

It supports direct chat and advanced group collaboration features with security hardening, audit logs, pagination, and tests.

## Features

### Authentication and Security
- User registration/login/logout
- Session-based auth with hardened cookie settings
- JWT access token + refresh token flow
- Refresh token storage and revocation
- Route-level validation for IDs and inputs
- Rate limiting on auth, message, and search endpoints
- Secure file upload filtering (MIME + size limits + sanitized filenames)

### Direct Chat
- Real-time 1:1 messaging with Socket.IO
- Online/offline presence
- Edit and delete own messages
- Chronological ordering (oldest to newest)
- Timestamps on messages
- Paginated chat history API

### Group Chat (v2)
- Create groups with image and member limit
- Role-based permissions: `owner`, `admin`, `member`
- Add/remove members
- Owner can promote/demote admin/member roles
- Real-time group messaging
- Reply to message (thread-style reply reference)
- Reactions (emoji toggle)
- Pin/unpin messages (owner/admin)
- Read receipts
- Typing indicators
- File/image/audio message support
- Search across users, groups, and messages
- Chronological ordering (oldest to newest)
- Timestamps on messages
- Paginated group chat history API

### Observability and Audit
- Audit logs for critical actions:
  - direct chat edit/delete
  - group create/member add/remove/role update
  - group message create/edit/delete
  - pin/unpin and reactions
- Audit logs API with pagination

### Engineering Enhancements
- MongoDB indexes for common chat/group/search query paths
- Input sanitization helpers
- Reusable utility modules (`jwt`, `validators`, `auditLogger`, `rateLimiter`)
- Unit + integration tests for critical paths

## Tech Stack

- Backend: Node.js, Express, Mongoose
- Realtime: Socket.IO
- Frontend: EJS, jQuery, Bootstrap, CSS
- Database: MongoDB
- Testing: Node built-in test runner (`node:test`)

## Project Structure

```txt
controllers/
middlewares/
models/
public/
routes/
tests/
utils/
views/
app.js
```

## Environment Variables

Create a `.env` file in the root:

```env
SESSION_SECRET=your_session_secret
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
NODE_ENV=development
```

## Installation and Run

```bash
npm install
npm run dev
```

Server runs on:
- `http://127.0.0.1:3000`

MongoDB expected on:
- `mongodb://127.0.0.1:27017/dynamic-chat-app`

## Scripts

```bash
npm run dev     # run with nodemon
npm start       # run with node
npm test        # run unit + integration tests
```

## API Highlights

### Auth
- `POST /` login
- `POST /refresh-token` refresh access token
- `GET /logout` logout and revoke refresh token

### Direct Chat
- `GET /chat-history?receiver_id=<id>&page=1&limit=30`
- `POST /save-chat`
- `POST /update-chat`
- `POST /delete-chat`

### Group
- `POST /create-group`
- `POST /add-group-member`
- `POST /update-group-member-role`
- `POST /remove-group-member`
- `GET /group-members/:groupId`
- `GET /group-chat-history/:groupId?page=1&limit=30`
- `POST /save-group-chat`
- `POST /update-group-chat`
- `POST /delete-group-chat`
- `POST /toggle-pin-group-chat`
- `POST /react-group-chat`
- `POST /mark-group-read`

### Search and Audit
- `GET /search?q=<query>`
- `GET /audit-logs?page=1&limit=20`

## Testing

Current tests include:
- JWT token creation/verification
- Validation utility behavior
- Rate limiter integration behavior

Run:

```bash
npm test
```

## Notes

- Uploaded profile images are stored in `public/images`.
- Uploaded message attachments are stored in `public/uploads/messages`.
- Socket namespace used: `/user-namespace`.
