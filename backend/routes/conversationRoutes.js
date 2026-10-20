const express = require('express');
const {
  createOrGetConversation,
  getMessages,
  listConversations,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
  setMemberRole,
  leaveGroup,
} = require('../controllers/conversationController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', protect, createOrGetConversation);
router.get('/', protect, listConversations);
router.get('/:conversationId/messages', protect, getMessages);

// Group management (admin-only, except leaving).
router.patch('/:conversationId', protect, renameGroup);
router.post('/:conversationId/members', protect, addGroupMembers);
router.delete('/:conversationId/members/:userId', protect, removeGroupMember);
router.patch('/:conversationId/members/:userId', protect, setMemberRole);
router.post('/:conversationId/leave', protect, leaveGroup);

module.exports = router;
