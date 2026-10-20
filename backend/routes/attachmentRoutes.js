const express = require('express');
const { uploadAttachment, getAttachment, MAX_SIZE } = require('../controllers/attachmentController');
const protect = require('../middleware/authMiddleware');

const router = express.Router();

// Raw body (not JSON/multipart) keeps the upload dependency-free. The limit is
// slightly above MAX_SIZE so the controller, not the parser, reports the
// friendlier "too large" message for files just over it.
router.post(
  '/',
  protect,
  express.raw({ type: () => true, limit: MAX_SIZE + 1024 }),
  uploadAttachment
);

// Bodies far over the limit are rejected by the parser itself, before the
// controller runs — give those the same friendly message.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Image is too large (max 5MB)' });
  }
  next(err);
});

// Public by unguessable key: <img src> can't send an Authorization header.
router.get('/:key', getAttachment);

module.exports = router;
