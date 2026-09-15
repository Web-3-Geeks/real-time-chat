
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const initSocket = require('./socket');

const app = express();
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const conversationRoutes = require('./routes/conversationRoutes');

const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5173'];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use(async (req, res, next) => {
  await connectDB();
  next();
});

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);



app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

const httpServer = http.createServer(app);
const io = initSocket(httpServer);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, httpServer, io };