const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
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
    const result = await uploadToCloudinary(req.file.buffer, 'chat-images');

    res.json({
      url: result.secure_url,
      type: 'image'
    });
  } catch (err) {
    res.status(500).json({ msg: 'Image upload failed' });
  }
});

// AUDIO/VOICE UPLOAD
router.post('/voice', upload.single('file'), async (req, res) => {
  try {
    const result = await uploadToCloudinary(req.file.buffer, 'chat-voices');

    res.json({
      url: result.secure_url,
      type: 'voice'
    });
  } catch (err) {
    res.status(500).json({ msg: 'Voice upload failed' });
  }
});

module.exports = router;