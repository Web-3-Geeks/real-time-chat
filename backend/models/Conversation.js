const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['private', 'group'],
            required: true
        },
        name: {
            type: String
        },
        pairKey: {
            type: String,
            unique: true,
            sparse: true,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Conversation', conversationSchema);