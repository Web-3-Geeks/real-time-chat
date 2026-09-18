const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');

let isConnected = false;

const connectDB = async () => {
    // Don't just trust our own flag — the underlying connection can drop
    // (idle timeout, network blip) without us finding out, and mongoose
    // won't reconnect on its own quickly enough for a request that needs it
    // right now. readyState 1 = connected; anything else, try to (re)connect.
    if (isConnected && mongoose.connection.readyState === 1) return;

    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 30000,
            // Without this, a query on a connection whose TCP path silently died
            // (no FIN/RST, just stopped responding) hangs forever with no error —
            // this bounds that to a fixed timeout so the caller gets a rejection.
            socketTimeoutMS: 20000,
        });
        await Conversation.syncIndexes();
        try {
            // Separate try/catch: if pre-existing data ever violated the new
            // unique {conversationId, userId} index, this would throw — that
            // should just skip the (unlikely, already-consistent-in-practice)
            // index build, never take down the whole DB connection.
            await ConversationMember.syncIndexes();
            await Message.syncIndexes();
        } catch (indexError) {
            console.error('Index sync failed (non-fatal):', indexError.message);
        }
        isConnected = true;
        console.log('MongoDB connected');
    } catch (error) {
        isConnected = false;
        console.error('MongoDB connection failed:', error.message);
    }
};

module.exports = connectDB;