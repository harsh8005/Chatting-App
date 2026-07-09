# Chat App (Real-Time Messaging Platform)

A full-stack real-time chat application built with Node.js, Express, MongoDB, EJS, jQuery, and Socket.IO.

It supports direct chat, group collaboration, file uploads, audit logs, and AI-assisted features for summaries, topics, moderation, and bot replies.

## Features

### Authentication and Security
- User registration, login, and logout
- Session-based auth with secure cookie settings
- JWT access token + refresh token flow
- Refresh token storage and revocation
- Route-level validation for IDs and inputs
- Rate limiting on auth, message, and search endpoints
- Secure file upload filtering with MIME and size limits

### Direct Chat
- Real-time 1:1 messaging with Socket.IO
- Online/offline presence
- Edit and delete your own messages
- Paginated chat history API
- Automatic AI bot replies when messaging the bot account

### Group Chat
- Create groups with image uploads and member limits
- Role-based permissions: `owner`, `admin`, `member`
- Add, remove, and promote/demote members
- Real-time group messaging
- Reply-to references for threaded conversations
- Emoji reactions
- Pin and unpin messages
- Read receipts
- Typing indicators
- Image, audio, PDF, and text attachments
- Search across users, groups, direct messages, and group messages

### AI Features
- Group message summaries
- Meeting recaps
- Topic extraction
- Audio transcription and sentiment detection
- AI health check endpoint
- Local fallback behavior when Hugging Face is unavailable

### Observability
- Audit logs for important actions such as:
  - direct message edit/delete
  - group create/member management
  - group message create/edit/delete
  - pin/unpin and reactions

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
services/
tests/
utils/
views/
app.js
```

## Requirements

- Node.js 18+ recommended
- MongoDB running locally
- Optional: Hugging Face API token for AI features

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root:

```env
SESSION_SECRET=your_session_secret
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
HUGGINGFACE_API_TOKEN=your_huggingface_api_token
NODE_ENV=development
```

3. Make sure MongoDB is available locally.

The app currently connects to:

```txt
mongodb://127.0.0.1:27017/dynamic-chat-app
```

If you want to change the database URI, update `app.js`.

## Run

```bash
npm run dev
```

Or run the server directly:

```bash
npm start
```

The app listens on:

```txt
http://127.0.0.1:3000
```

## Scripts

```bash
npm run dev
npm start
npm test
```

## Main Routes

### Auth
- `GET /register`
- `POST /register`
- `GET /`
- `POST /`
- `POST /refresh-token`
- `GET /logout`
- `GET /dashboard`

### Direct Chat
- `GET /chat-history?receiver_id=<id>&page=1&limit=30`
- `POST /save-chat`
- `POST /update-chat`
- `POST /delete-chat`

### Groups
- `GET /groups`
- `POST /create-group`
- `POST /add-group-member`
- `POST /update-group-member-role`
- `POST /remove-group-member`
- `GET /group-members/:groupId`
- `GET /group-chat-history/:groupId`
- `POST /save-group-chat`
- `POST /delete-group-chat`
- `POST /update-group-chat`
- `POST /toggle-pin-group-chat`
- `POST /react-group-chat`
- `POST /mark-group-read`

### AI, Search, Logs
- `GET /group-ai-summary/:groupId`
- `GET /group-ai-recap/:groupId`
- `GET /group-ai-topics/:groupId`
- `GET /ai-health`
- `GET /search?q=<query>`
- `GET /audit-logs`

## File Uploads

- Profile images are stored in `public/images`
- Message attachments are stored in `public/uploads/messages`

## Socket.IO

The app uses the `/user-namespace` namespace for realtime updates.

## Testing

Current tests cover:
- JWT token behavior
- Validation helpers
- Rate limiter integration

Run them with:

```bash
npm test
```

## Notes

- The AI bot account is created automatically as `aibot@chatapp.local`.
- If `HUGGINGFACE_API_TOKEN` is missing, AI features fall back to local behavior where possible.
- The app stores upload files in the `public` directory, so they are served statically.
