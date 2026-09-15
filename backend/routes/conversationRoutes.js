const express = require('express');
const { createOrGetConversation, getMessages, listConversations } = require('../controllers/conversationController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', protect, createOrGetConversation);
router.get('/', protect, listConversations);
router.get('/:conversationId/messages', protect, getMessages);

module.exports = router;
