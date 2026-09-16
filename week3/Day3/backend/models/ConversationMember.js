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

module.exports = mongoose.model('ConversationMember', conversationMemberSchema);