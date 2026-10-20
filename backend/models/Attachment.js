const mongoose = require('mongoose');

// Uploaded images are stored in MongoDB itself rather than on local disk:
// the backend runs on Railway, whose filesystem is ephemeral (wiped on every
// redeploy/restart), and this avoids needing a third-party storage account.
// Uploads are capped at 5MB, well under MongoDB's 16MB document limit.
const attachmentSchema = new mongoose.Schema(
    {
        // Random, unguessable id used in the public URL — <img> tags can't send
        // the Authorization header, so the key itself acts as the capability.
        key: {
            type: String,
            required: true,
            unique: true,
        },
        data: {
            type: Buffer,
            required: true,
        },
        mimeType: {
            type: String,
            required: true,
        },
        size: {
            type: Number,
            required: true,
        },
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Attachment', attachmentSchema);
