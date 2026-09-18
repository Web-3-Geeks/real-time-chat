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
        content: {
            type: String,
            required: true,
            maxlength: 5000,
        },
        messageType: {
            type: String,
            enum: ['text', 'image', 'file'],
            default: 'text'
        },
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
