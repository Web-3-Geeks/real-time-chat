const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        // Optional for image messages (the caption), required for everything else.
        content: {
            type: String,
            required: function () {
                return this.messageType !== 'image';
            },
            default: '',
            maxlength: 5000,
        },
        // 'system' = auto-generated group events ("Ali added Sara"); these are
        // never editable, deletable, reactable or reply-able.
        messageType: {
            type: String,
            enum: ['text', 'image', 'file', 'system'],
            default: 'text'
        },
        attachment: {
            key: { type: String },
            mimeType: { type: String },
            size: { type: Number },
            width: { type: Number },
            height: { type: Number },
        },
        replyTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Message',
        },
        // One reaction per user (picking another emoji replaces it).
        reactions: [
            {
                _id: false,
                emoji: { type: String, required: true },
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
            },
        ],
        deliveredTo: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        readBy: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        edited: {
            type: Boolean,
            default: false,
        },
        editedAt: {
            type: Date,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
)

// Every message query filters by conversationId and sorts/pages by
// createdAt (history fetch, cursor-based `before` pagination, unread
// counts) — this compound index covers all of them instead of falling
// back to a full collection scan as message volume grows.
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
