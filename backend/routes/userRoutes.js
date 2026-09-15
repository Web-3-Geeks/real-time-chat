const express = require('express');
const { getProfile, updateProfile, listUsers } = require('../controllers/userController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, listUsers);
router.get('/me', protect, getProfile);
router.patch('/me', protect, updateProfile);

module.exports = router;
