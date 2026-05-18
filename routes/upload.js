const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// Cloudinary config
// Support two env var naming conventions: CLOUDINARY_NAME or CLOUDINARY_CLOUD_NAME
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// helper to upload buffer to cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

// IMAGE UPLOAD
router.post('/image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('Image upload error: missing file');
      return res.status(400).json({ msg: 'No file provided' });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'chat-images');

    res.json({
      url: result.secure_url,
      type: 'image'
    });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ msg: err.message || 'Image upload failed' });
  }
});

// AUDIO/VOICE UPLOAD
router.post('/voice', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('Voice upload error: missing file');
      return res.status(400).json({ msg: 'No file provided' });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'chat-voices');

    res.json({
      url: result.secure_url,
      type: 'voice'
    });
  } catch (err) {
    console.error('Voice upload error:', err);
    res.status(500).json({ msg: err.message || 'Voice upload failed' });
  }
});

// GENERIC UPLOAD: accept form field `file` and route based on mimetype
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('Generic upload error: missing file');
      return res.status(400).json({ msg: 'No file provided' });
    }

    const mimetype = req.file.mimetype || '';
    const isImage = mimetype.startsWith('image/');
    const isAudio = mimetype.startsWith('audio/');

    const folder = isImage ? 'chat-images' : isAudio ? 'chat-voices' : 'chat-files';

    const result = await uploadToCloudinary(req.file.buffer, folder);

    res.json({
      url: result.secure_url,
      type: isImage ? 'image' : isAudio ? 'voice' : 'file'
    });
  } catch (err) {
    console.error('Generic upload error:', err);
    res.status(500).json({ msg: err.message || 'Upload failed' });
  }
});

module.exports = router;