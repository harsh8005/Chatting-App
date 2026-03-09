const mongoose = require('mongoose');

const groupChatSchema = new mongoose.Schema(
    {
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group',
            required: true
        },
        sender_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        message: {
            type: String,
            default: ''
        },
        message_type: {
            type: String,
            enum: ['text', 'image', 'audio', 'file'],
            default: 'text'
        },
        file_url: {
            type: String,
            default: ''
        },
        file_name: {
            type: String,
            default: ''
        },
        file_mime: {
            type: String,
            default: ''
        },
        file_size: {
            type: Number,
            default: 0
        },
        reply_to: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupChat',
            default: null
        },
        reactions: {
            type: [
                {
                    user_id: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'User',
                        required: true
                    },
                    emoji: {
                        type: String,
                        required: true
                    }
                }
            ],
            default: []
        },
        read_by: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User'
                }
            ],
            default: []
        },
        is_pinned: {
            type: Boolean,
            default: false
        },
        pinned_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        pinned_at: {
            type: Date,
            default: null
        },
        moderation: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        transcript: {
            type: String,
            default: ''
        },
        sentiment: {
            type: String,
            default: ''
        },
        sentiment_score: {
            type: Number,
            default: 0
        },
        ai_generated: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

groupChatSchema.index({ group_id: 1, createdAt: -1 });
groupChatSchema.index({ group_id: 1, is_pinned: -1, createdAt: -1 });
groupChatSchema.index({ message: 'text', file_name: 'text' });

module.exports = mongoose.model('GroupChat', groupChatSchema);
