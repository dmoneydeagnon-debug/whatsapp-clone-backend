const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const auth = require('../middleware/auth');

const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;

  try {
    // Check if email OR phone already exists
    let user = await User.findOne({
      $or: [{ email }, {phone}]
    });

    if (user) return res.status(400).json({ msg: 'User already exists' });

    // Create user
    user = new User({ 
      name, 
      email: email || null,
      phone: phone || null,
      password: await bcrypt.hash(password, 10) 
    });

    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, phone, password } = req.body;

  try {
    // Detect if it's email or phone
    const query = email
      ? { email }
      : { phone };
  
    const user = await User.findOne(query);

    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({ 
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email,
        phone: user.phone
      } 
    });
    
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    let user = await User.findOne({ email: payload.email });

    if (!user) {
      user = new User({
        name: payload.name,
        email: payload.email,
        avatar: payload.picture,
        password: null,
      });
      await user.save();
    }

    const jwtToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: jwtToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Google auth failed" });
  }
});

// Get all users (for sidebar)
router.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('name email avatar isOnline lastSeen');

    const usersWithLastMessage = await Promise.all(
      users.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: req.user.id, receiver: user._id },
            { sender: user._id, receiver: req.user.id }
          ]
        })
          .sort({ createdAt: -1 })
          .lean();

        return {
          ...user.toObject(),
          lastMessage: lastMessage
            ? lastMessage.text || `[${lastMessage.mediaType}]`
            : ''
        };
      })
    );

    res.json(usersWithLastMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('name email phone avatar isOnline lastSeen');

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    });

  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, phone, avatar } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email, _id: { $ne: user._id } });
      if (existingEmail) return res.status(400).json({ msg: 'Email already in use' });
      user.email = email;
    }

    if (phone && phone !== user.phone) {
      const existingPhone = await User.findOne({ phone, _id: { $ne: user._id } });
      if (existingPhone) return res.status(400).json({ msg: 'Phone already in use' });
      user.phone = phone;
    }

    if (name) user.name = name;
    if (avatar !== undefined) user.avatar = avatar;

    await user.save();

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;