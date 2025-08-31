const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

// Railway deployment - v3 - Force restart

// Import routes
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');
const { router: messageRoutes, setSocketIo: setMessageSocketIo } = require('./routes/messages');
const { router: groupRoutes, setSocketIo: setGroupSocketIo } = require('./routes/groups');

// Import models
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://localhost:3001",
      "https://kallurinaveenkumar.github.io",
      "https://KALLURINAVEENKUMAR.github.io"
    ],
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000", 
    "http://localhost:3001",
    "https://kallurinaveenkumar.github.io",
    "https://KALLURINAVEENKUMAR.github.io"
  ],
  credentials: true
}));
app.use(express.json());

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/jobcommunity';
console.log('Attempting to connect to MongoDB...');
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB successfully');
  console.log('Database URI:', mongoUri.includes('mongodb+srv') ? 'MongoDB Atlas' : 'Local/Railway MongoDB');
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  console.error('Connection URI:', mongoUri.substring(0, 20) + '...');
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);

// Initialize Socket.IO in routes
setMessageSocketIo(io);
setGroupSocketIo(io);

// Health check endpoint for deployment platforms
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running!' });
});

// Test database connection
app.get('/api/db-test', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const stateMap = {
      0: 'disconnected',
      1: 'connected', 
      2: 'connecting',
      3: 'disconnecting'
    };
    
    // Try a simple ping to test the connection
    let pingResult = 'not tested';
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
        pingResult = 'success';
      }
    } catch (pingError) {
      pingResult = `failed: ${pingError.message}`;
    }
    
    res.json({ 
      message: 'Database connection test',
      mongoState: stateMap[dbState] || 'unknown',
      mongoUri: process.env.MONGODB_URI ? 'Set' : 'Not Set',
      jwtSecret: process.env.JWT_SECRET ? 'Set' : 'Not Set',
      pingResult: pingResult,
      connectionString: process.env.MONGODB_URI ? 
        process.env.MONGODB_URI.substring(0, 50) + '...' : 'Not Set'
    });
  } catch (error) {
    res.status(500).json({ message: 'Database test failed', error: error.message });
  }
});

// Initialize database with sample data
app.post('/api/init', async (req, res) => {
  try {
    const Company = require('./models/Company');
    
    // Check if companies already exist
    const existingCount = await Company.countDocuments();
    if (existingCount > 0) {
      return res.json({ 
        message: 'Database already initialized', 
        companiesCount: existingCount 
      });
    }

    // Create sample companies
    const sampleCompanies = [
      { name: 'Sample Company', description: 'Example company for demonstration', memberCount: 1 },
      { name: 'Google', description: 'Tech giant focusing on search and cloud services', memberCount: 245 },
      { name: 'Microsoft', description: 'Software and cloud computing company', memberCount: 180 },
      { name: 'Amazon', description: 'E-commerce and cloud computing platform', memberCount: 320 },
      { name: 'Apple', description: 'Consumer electronics and software company', memberCount: 156 },
      { name: 'Meta', description: 'Social media and virtual reality company', memberCount: 89 }
    ];

    await Company.insertMany(sampleCompanies);
    
    res.json({ 
      message: 'Database initialized successfully!',
      companiesAdded: sampleCompanies.length
    });
  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(500).json({ message: 'Error initializing database', error: error.message });
  }
});

// Socket.IO connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Extract user info from query
  const { userId, userName, userRole, companyId } = socket.handshake.query;
  
  // Store user info
  connectedUsers.set(socket.id, {
    userId,
    userName,
    userRole,
    companyId,
    socketId: socket.id
  });

  // Join company room
  socket.on('join-company', ({ companyId, user }) => {
    socket.join(`company_${companyId}`);
    console.log(`User ${user.email} joined company ${companyId}`);
    
    // Broadcast online users in this company
    const companyUsers = Array.from(connectedUsers.values())
      .filter(u => u.companyId === companyId);
    
    io.to(`company_${companyId}`).emit('online-users', companyUsers);
  });

  // Join group room
  socket.on('join-group', ({ groupId, user }) => {
    socket.join(`group_${groupId}`);
    console.log(`User ${user.email} joined group ${groupId}`);
    
    // Broadcast online users in this group
    const groupUsers = Array.from(connectedUsers.values())
      .filter(u => u.groupId === groupId);
    
    io.to(`group_${groupId}`).emit('online-users', groupUsers);
  });

  // Handle sending company messages
  socket.on('send-message', async (messageData) => {
    console.log('🔵 Socket received send-message:', messageData);
    try {
      // Save message to database
      const message = new Message({
        text: messageData.text,
        userId: messageData.userId,
        userName: messageData.userName,
        userRole: messageData.userRole,
        companyId: messageData.companyId,
        timestamp: new Date()
      });
      
      await message.save();
      console.log('💾 Message saved to database:', message._id);
      
      // Check if this is a help request from a student about interviews
      const isInterviewHelp = messageData.userRole === 'student' &&
        (messageData.text.toLowerCase().includes('interview') || 
         messageData.text.toLowerCase().includes('help') ||
         messageData.text.toLowerCase().includes('tomorrow') ||
         messageData.text.toLowerCase().includes('guidance'));
      
      // Get the company name for notifications
      const Company = require('./models/Company');
      const company = await Company.findById(messageData.companyId);
      const companyName = company ? company.name : 'Unknown Company';
      
      // If it's an interview help request, find employees of this company
      let employeeNotifications = [];
      if (isInterviewHelp) {
        const User = require('./models/User');
        const companyEmployees = await User.find({ 
          role: 'professional', 
          companyName: { $regex: new RegExp(`^${companyName}$`, 'i') }
        });
        
        // Find connected employees
        employeeNotifications = Array.from(connectedUsers.values())
          .filter(connectedUser => {
            const isEmployee = companyEmployees.some(emp => 
              emp._id.toString() === connectedUser.userId || emp.email === connectedUser.userId
            );
            const isDifferentUser = connectedUser.userId !== messageData.userId;
            return isEmployee && isDifferentUser;
          });
      }
      
      // Broadcast to all users in the company room
      const broadcastMessage = {
        ...messageData,
        id: message._id,
        isInterviewHelp: isInterviewHelp
      };
      
      console.log('📡 Broadcasting message to company room:', `company_${messageData.companyId}`);
      io.to(`company_${messageData.companyId}`).emit('new-message', broadcastMessage);
      
      // Send special notifications to company employees for interview help
      if (isInterviewHelp && employeeNotifications.length > 0) {
        employeeNotifications.forEach(employee => {
          io.to(employee.socketId).emit('interview-help-notification', {
            message: messageData,
            companyName: companyName,
            studentName: messageData.userName,
            type: 'interview-help'
          });
        });
        
        console.log(`🚨 Interview help notification sent to ${employeeNotifications.length} ${companyName} employees`);
      }
      
      console.log(`✅ Message sent in company ${messageData.companyId} by ${messageData.userName}`);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // Handle sending group messages
  socket.on('send-group-message', async (messageData) => {
    console.log('🔵 Socket received send-group-message:', messageData);
    try {
      // Import GroupMessage model if not already imported
      const GroupMessage = require('./models/GroupMessage');
      
      // Save message to database
      const message = new GroupMessage({
        text: messageData.text,
        userId: messageData.userId,
        userName: messageData.userName,
        userRole: messageData.userRole,
        userEmail: messageData.userEmail,
        groupId: messageData.groupId,
        mentions: messageData.mentions,
        replyTo: messageData.replyTo,
        timestamp: new Date()
      });
      
      await message.save();
      console.log('💾 Group message saved to database:', message._id);
      
      // Broadcast the message to all users in the group
      io.to(`group_${messageData.groupId}`).emit('new-message', {
        ...messageData,
        id: message._id,
        timestamp: message.timestamp
      });
      
      console.log(`✅ Message sent in group ${messageData.groupId} by ${messageData.userName}`);
    } catch (error) {
      console.error('Error saving group message:', error);
    }
  });

  // Handle editing messages
  socket.on('edit-message', async (data) => {
    console.log('✏️ Socket received edit-message:', data);
    try {
      const { messageId, newText, userId, companyId } = data;
      
      const message = await Message.findById(messageId);
      if (message && message.userId === userId && !message.isDeleted) {
        message.text = newText;
        message.isEdited = true;
        message.editedAt = new Date();
        await message.save();
        
        // Broadcast the edited message
        io.to(`company_${companyId}`).emit('message-edited', {
          messageId: message._id,
          text: message.text,
          isEdited: true,
          editedAt: message.editedAt
        });
        
        console.log(`✅ Message edited: ${messageId}`);
      }
    } catch (error) {
      console.error('Error editing message:', error);
    }
  });

  // Handle deleting messages
  socket.on('delete-message', async (data) => {
    console.log('🗑️ Socket received delete-message:', data);
    try {
      const { messageId, userId, companyId } = data;
      
      const message = await Message.findById(messageId);
      if (message && message.userId === userId) {
        message.isDeleted = true;
        message.deletedAt = new Date();
        await message.save();
        
        // Broadcast the deletion
        io.to(`company_${companyId}`).emit('message-deleted', {
          messageId: message._id
        });
        
        console.log(`✅ Message deleted: ${messageId}`);
      }
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  });

  // Handle clearing company chat
  socket.on('clear-company-chat', async (data) => {
    console.log('🧹 Socket received clear-company-chat:', data);
    try {
      const { companyId, userId, userName } = data;
      
      // Broadcast the clear event to all users in the company room
      io.to(`company_${companyId}`).emit('chat-cleared', {
        userId,
        userName,
        companyId,
        type: 'company'
      });
      
      console.log(`✅ Company chat cleared by ${userName} in company ${companyId}`);
    } catch (error) {
      console.error('Error handling clear company chat:', error);
    }
  });

  // Handle clearing group chat
  socket.on('clear-group-chat', async (data) => {
    console.log('🧹 Socket received clear-group-chat:', data);
    try {
      const { groupId, userId, userName } = data;
      
      // Broadcast the clear event to all users in the group room
      io.to(`group_${groupId}`).emit('chat-cleared', {
        userId,
        userName,
        groupId,
        type: 'group'
      });
      
      console.log(`✅ Group chat cleared by ${userName} in group ${groupId}`);
    } catch (error) {
      console.error('Error handling clear group chat:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const user = connectedUsers.get(socket.id);
    
    if (user) {
      // Remove user from connected users
      connectedUsers.delete(socket.id);
      
      // Update online users in the company room
      if (user.companyId) {
        const companyUsers = Array.from(connectedUsers.values())
          .filter(u => u.companyId === user.companyId);
        
        io.to(`company_${user.companyId}`).emit('online-users', companyUsers);
      }
    }
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO server is ready`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
