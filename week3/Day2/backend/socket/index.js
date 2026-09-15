const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const ConversationMember = require("../models/ConversationMember");
const Message = require("../models/Message");

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Not authorized, no token"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (error) {
      next(new Error("Not authorized, token failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    socket.on("join_conversation", async (conversationId, callback) => {
      const isMember = await ConversationMember.findOne({
        conversationId,
        userId: socket.userId,
      });

      if (!isMember) {
        if (callback)
          callback({
            success: false,
            message: "Not a member of this conversation",
          });
        return;
      }

      socket.join(conversationId);
      console.log(
        `User ${socket.userId} joined conversation ${conversationId}`,
      );

      if (callback) callback({ success: true });
    });

    socket.on("leave_conversation", (conversationId) => {
      socket.leave(conversationId);
      console.log(`User ${socket.userId} left conversation ${conversationId}`);
    });

    socket.on("send_message", async (data, callback) => {
      const { conversationId, content } = data;

      const isMember = await ConversationMember.findOne({
        conversationId,
        userId: socket.userId
      });

      if (!isMember) {
        if (callback) callback({ success: false, message: 'Not a member of this conversation' });
        return;
      }

      if (!content || !content.trim()) {
        if (callback) callback({ success: false, message: 'Message cannot be empty' });
        return;
      }

      const message = await Message.create({
        conversationId,
        senderId: socket.userId,
        content: content.trim()
      })

      io.to(conversationId).emit('receive_message', {
        id: message._id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt
      });

      if (callback) callback({ success: true });
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id} (user: ${socket.userId})`);
    });
  });

  return io;
};

module.exports = initSocket;
