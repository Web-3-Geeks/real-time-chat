const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

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
        isConnected = true;
        console.log('MongoDB connected');
    } catch (error) {
        isConnected = false;
        console.error('MongoDB connection failed:', error.message);
    }
};

module.exports = connectDB;