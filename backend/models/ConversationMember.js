const mongoose = require('mongoose');

const conversationMemberSchema = new mongoose.Schema({
    conversationId: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
})

// Membership is checked on almost every socket event (join_conversation,
// send_message, mark_messages_read, typing_start/stop) via
// findOne({conversationId, userId}) — unique because a user should only
// ever have one membership row per conversation, which this also enforces
// at the database level instead of relying on application code alone.
conversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
// Covers "which conversations is this user in" (find({userId}).distinct(...)),
// used on every connect for presence/catch-up-delivery lookups.
conversationMemberSchema.index({ userId: 1 });

module.exports = mongoose.model('ConversationMember', conversationMemberSchema);