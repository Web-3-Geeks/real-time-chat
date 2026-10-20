const crypto = require("crypto");
const Attachment = require("../models/Attachment");

const MAX_SIZE = 5 * 1024 * 1024;

// SVG is deliberately excluded: it can carry script and would be served from
// our own origin.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Checks the file's leading bytes so a client can't label arbitrary data as
// an image just by setting the Content-Type header.
const looksLikeImage = (buf, mimeType) => {
  if (!buf || buf.length < 12) return false;
  switch (mimeType) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/gif":
      return buf.subarray(0, 4).toString("ascii") === "GIF8";
    case "image/webp":
      return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
};

// Body arrives as raw bytes (express.raw on this route), Content-Type = the
// image's MIME type.
const uploadAttachment = async (req, res) => {
  try {
    const mimeType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(400).json({ message: "Only JPEG, PNG, WebP or GIF images are allowed" });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "No file received" });
    }

    if (req.body.length > MAX_SIZE) {
      return res.status(413).json({ message: "Image is too large (max 5MB)" });
    }

    if (!looksLikeImage(req.body, mimeType)) {
      return res.status(400).json({ message: "File content does not match its image type" });
    }

    const attachment = await Attachment.create({
      key: crypto.randomBytes(24).toString("hex"),
      data: req.body,
      mimeType,
      size: req.body.length,
      uploadedBy: req.user._id,
    });

    res.status(201).json({
      key: attachment.key,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
  } catch (error) {
    console.error("uploadAttachment error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

const getAttachment = async (req, res) => {
  try {
    const { key } = req.params;
    if (!/^[a-f0-9]{48}$/.test(key)) {
      return res.status(404).json({ message: "Not found" });
    }

    const attachment = await Attachment.findOne({ key });
    if (!attachment) {
      return res.status(404).json({ message: "Not found" });
    }

    res.set({
      "Content-Type": attachment.mimeType,
      "Content-Length": attachment.size,
      // Content behind a key never changes, so browsers can cache it forever.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.send(attachment.data);
  } catch (error) {
    console.error("getAttachment error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { uploadAttachment, getAttachment, MAX_SIZE };
