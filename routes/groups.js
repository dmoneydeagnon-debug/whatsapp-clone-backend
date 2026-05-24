const express = require('express');
const router = express.Router();

const Group = require('../models/Group');
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// Create group
router.post('/', auth, async (req, res) => {
  try {
    const { groupName, memberIds } = req.body;

    const name = (groupName || '').trim();
    if (!name) return res.status(400).json({ msg: 'groupName is required' });

    const members = Array.isArray(memberIds) ? memberIds : [];
    // Ensure creator is included
    const uniqueMembers = Array.from(
      new Set(members.map((id) => id.toString()))
    );
    if (!uniqueMembers.includes(req.user.id.toString())) {
      uniqueMembers.push(req.user.id.toString());
    }

    if (uniqueMembers.length < 2) {
      return res.status(400).json({ msg: 'Select at least 1 other user' });
    }

    const group = await Group.create({
      name,
      members: uniqueMembers,
      createdBy: req.user.id
    });

    res.json({ group });
  } catch (err) {
    console.error('CREATE GROUP ERROR:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// List groups for current user (basic shape for sidebar)
router.get('/my', auth, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    const groupsWithMeta = await Promise.all(
      groups.map(async (g) => {
        const lastMessage = await Message.findOne({
          groupId: g._id
        })
          .sort({ createdAt: -1 })
          .lean();

        const unreadCount = await Message.countDocuments({
          groupId: g._id,
          // read status is per message; we treat any unread message in group as unread for everyone
          // frontend will mark as read when opening group.
          read: false
        });

        return {
          _id: g._id,
          name: g.name,
          membersCount: g.members?.length || 0,
          lastMessage: lastMessage
            ? lastMessage.text || `[${lastMessage.mediaType}]`
            : '',
          unreadCount
        };
      })
    );

    res.json(groupsWithMeta);
  } catch (err) {
    console.error('LIST GROUPS ERROR:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get messages for a group
router.get('/:groupId/messages', auth, async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId).lean();
    if (!group) return res.status(404).json({ msg: 'Group not found' });

    const isMember = (group.members || []).some((m) => m.toString() === req.user.id.toString());
    if (!isMember) return res.status(403).json({ msg: 'Forbidden' });

    const messages = await Message.find({
      groupId
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error('GROUP MESSAGES ERROR:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;

