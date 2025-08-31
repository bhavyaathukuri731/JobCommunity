const express = require('express');
const Message = require('../models/Message');
const mongoose = require('mongoose');

const router = express.Router();

// Function to set up socket.io instance
let io;
const setSocketIo = (socketIo) => {
  io = socketIo;
};

const router_with_socket = { router, setSocketIo };

// Get messages for a specific company
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Handle both numeric IDs and MongoDB ObjectIds
    let queryFilter;
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      queryFilter = { companyId: companyId, isDeleted: { $ne: true } }; // String ObjectId, exclude deleted
    } else {
      queryFilter = { companyId: parseInt(companyId), isDeleted: { $ne: true } }; // Numeric ID, exclude deleted
    }
    
    const messages = await Message.find(queryFilter)
      .sort({ timestamp: 1 }) // Oldest first
      .limit(100); // Limit to last 100 messages

    // Transform to match frontend format
    const formattedMessages = messages.map(message => ({
      id: message._id,
      text: message.text,
      userId: message.userId,
      userName: message.userName,
      userRole: message.userRole,
      timestamp: message.timestamp.getTime(),
      companyId: message.companyId,
      isEdited: message.isEdited,
      editedAt: message.editedAt
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error fetching messages' });
  }
});

// Send a message
router.post('/', async (req, res) => {
  try {
    const { text, userId, userName, userRole, companyId } = req.body;

    if (!text || !userId || !userName || !userRole || !companyId) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Handle both numeric IDs and MongoDB ObjectIds
    let finalCompanyId;
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      finalCompanyId = companyId; // Keep as string ObjectId
    } else {
      finalCompanyId = parseInt(companyId); // Convert to number
    }

    const message = new Message({
      text,
      userId,
      userName,
      userRole,
      companyId: finalCompanyId,
      timestamp: new Date()
    });

    await message.save();

    const formattedMessage = {
      id: message._id,
      text: message.text,
      userId: message.userId,
      userName: message.userName,
      userRole: message.userRole,
      timestamp: message.timestamp.getTime(),
      companyId: message.companyId,
      isEdited: message.isEdited,
      editedAt: message.editedAt
    };

    // Broadcast the message to all users in the company via Socket.IO
    if (io) {
      io.to(`company_${finalCompanyId}`).emit('new-message', formattedMessage);
      console.log(`📡 Broadcasting message to company_${finalCompanyId} via API`);
    }

    res.status(201).json(formattedMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Server error sending message' });
  }
});

// Edit a message (only by the original sender)
router.put('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text, userId } = req.body;

    if (!text || !userId) {
      return res.status(400).json({ message: 'Text and userId are required' });
    }

    // Find the message and verify ownership
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (message.userId !== userId) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    if (message.isDeleted) {
      return res.status(400).json({ message: 'Cannot edit deleted message' });
    }

    // Update the message
    message.text = text;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    const formattedMessage = {
      id: message._id,
      text: message.text,
      userId: message.userId,
      userName: message.userName,
      userRole: message.userRole,
      timestamp: message.timestamp.getTime(),
      companyId: message.companyId,
      isEdited: message.isEdited,
      editedAt: message.editedAt
    };

    res.json(formattedMessage);
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ message: 'Server error editing message' });
  }
});

// Delete a message (only by the original sender)
router.delete('/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'UserId is required' });
    }

    // Find the message and verify ownership
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (message.userId !== userId) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    // Mark as deleted instead of actually deleting
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ message: 'Server error deleting message' });
  }
});

// Clear all messages for a company (actually delete from database)
router.delete('/clear/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    // Handle both numeric IDs and MongoDB ObjectIds
    let queryFilter;
    if (mongoose.Types.ObjectId.isValid(companyId)) {
      queryFilter = { companyId: companyId };
    } else {
      queryFilter = { companyId: parseInt(companyId) };
    }

    // Delete all messages for this company
    const result = await Message.deleteMany(queryFilter);

    console.log(`🧹 Cleared ${result.deletedCount} messages from company ${companyId}`);

    // Broadcast the clear event to all users in the company via Socket.IO
    if (io) {
      io.to(`company_${companyId}`).emit('chat-cleared', { companyId });
      console.log(`📡 Broadcasting chat-cleared to company_${companyId}`);
    }

    res.json({ 
      message: 'All messages cleared successfully',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ message: 'Server error clearing messages' });
  }
});

// Clear all messages for a group (actually delete from database)
router.delete('/clear/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    // Import GroupMessage model
    const GroupMessage = require('../models/GroupMessage');
    
    // Delete all messages for this group
    const result = await GroupMessage.deleteMany({ groupId: groupId });

    console.log(`🧹 Cleared ${result.deletedCount} messages from group ${groupId}`);

    // Broadcast the clear event to all users in the group via Socket.IO
    if (io) {
      io.to(`group_${groupId}`).emit('chat-cleared', { groupId });
      console.log(`📡 Broadcasting chat-cleared to group_${groupId}`);
    }

    res.json({ 
      message: 'All group messages cleared successfully',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing group messages:', error);
    res.status(500).json({ message: 'Server error clearing group messages' });
  }
});

module.exports = { router, setSocketIo };
