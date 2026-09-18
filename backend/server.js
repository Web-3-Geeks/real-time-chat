
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

app.use(cors({ origin: process.env.FRONTEND_URL }));
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

// Unmatched route (e.g. a typo'd endpoint, or a client hitting a removed one).
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Centralized error handler: catches anything passed to next(err), or thrown
// synchronously in a route handler, that individual controllers' own
// try/catch blocks didn't already handle. Logs the real error server-side
// but never sends error.message/stack to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ message: 'Server error' });
});

const httpServer = http.createServer(app);
const io = initSocket(httpServer);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, httpServer, io };