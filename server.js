// Msgly.AI Complete Backend Server
// Production-ready system with OpenAI integration
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage (for initial deployment - will upgrade to database later)
const users = new Map();
const messages = new Map();
const usage = new Map();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

// CORS configuration - Allow all origins for Chrome extension
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  skipSuccessfulRequests: true
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { success: false, message: 'Too many AI requests, please slow down.' }
});

app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Helper functions
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '30d' });
};

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

const validatePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

const getCurrentMonth = () => {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
};

const getUserUsage = (userId) => {
  const month = getCurrentMonth();
  const key = `${userId}-${month}`;
  return usage.get(key) || 0;
};

const incrementUsage = (userId) => {
  const month = getCurrentMonth();
  const key = `${userId}-${month}`;
  const current = usage.get(key) || 0;
  usage.set(key, current + 1);
  return current + 1;
};

// Authentication middleware
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
    const user = users.get(decoded.userId);

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing'
  });
});

// AI service health check
app.get('/ai/health', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: 'OpenAI API key not configured'
      });
    }

    const testCompletion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say "OK" if you can hear this.' }],
      max_tokens: 5,
      temperature: 0
    });

    res.json({
      success: true,
      status: 'healthy',
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      response: testCompletion.choices[0].message.content
    });

  } catch (error) {
    logger.error('AI health check error:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// User registration
app.post('/auth/email/signup', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('fullName').trim().isLength({ min: 2, max: 100 }),
  body('password').isLength({ min: 6, max: 128 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, fullName, password } = req.body;

    // Check if user exists
    const existingUser = Array.from(users.values()).find(user => user.email === email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create user
    const userId = uuidv4();
    const passwordHash = await hashPassword(password);
    
    const user = {
      id: userId,
      email,
      name: fullName,
      passwordHash,
      authProvider: 'email',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      isActive: true
    };

    users.set(userId, user);

    const token = generateToken(userId);

    logger.info(`User registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// User login
app.post('/auth/email/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = Array.from(users.values()).find(u => u.email === email && u.authProvider === 'email');

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Validate password
    const isValidPassword = await validatePassword(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken(user.id);

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get current user
app.get('/me', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const monthlyUsage = getUserUsage(userId);
    const freeLimit = 30;
    const creditsRemaining = Math.max(0, freeLimit - monthlyUsage);

    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        authProvider: req.user.authProvider,
        emailVerified: req.user.emailVerified,
        createdAt: req.user.createdAt,
        credits: {
          available: creditsRemaining,
          type: 'free',
          monthlyUsage: monthlyUsage,
          freeMonthlyLimit: freeLimit
        }
      }
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Generate personalized message
app.post('/generate', authMiddleware, aiLimiter, [
  body('profileData').isObject(),
  body('userContext').trim().isLength({ min: 10, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.userId;
    const { profileData, userContext } = req.body;

    // Check credits
    const monthlyUsage = getUserUsage(userId);
    const freeLimit = 30;

    if (monthlyUsage >= freeLimit) {
      return res.status(402).json({
        success: false,
        message: 'Monthly free limit reached. Please upgrade to continue.',
        creditsRemaining: 0
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'AI service not configured'
      });
    }

    // Create prompt for message generation
    const profile = profileData.basicInfo || {};
    const experience = profileData.experience?.slice(0, 3) || [];
    const education = profileData.education?.slice(0, 2) || [];
    const skills = profileData.skills?.slice(0, 10) || [];

    const prompt = `You are an expert LinkedIn outreach specialist. Create a personalized, professional LinkedIn message based on the following information:

SENDER CONTEXT:
${userContext}

TARGET PROFILE:
Name: ${profile.fullName || 'Not available'}
Headline: ${profile.headline || 'Not available'}
Current Position: ${profile.currentPosition || 'Not available'}
Current Company: ${profile.currentCompany || 'Not available'}
Location: ${profile.location || 'Not available'}
About: ${profile.about || 'Not available'}

RECENT EXPERIENCE:
${experience.map(exp => `• ${exp.title} at ${exp.company} (${exp.duration})`).join('\n')}

EDUCATION:
${education.map(edu => `• ${edu.degree} at ${edu.school} (${edu.dates})`).join('\n')}

KEY SKILLS:
${skills.join(', ')}

REQUIREMENTS:
1. Write a professional LinkedIn connection/message request
2. Keep it concise (50-150 words)
3. Personalize it based on their background and your context
4. Make it engaging and likely to get a response
5. Avoid being overly salesy or generic
6. Reference specific details from their profile
7. Include a clear but soft call-to-action
8. Sound natural and conversational

Return only the message text, no extra formatting or quotes.`;

    // Generate message using OpenAI
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an expert LinkedIn outreach specialist who writes personalized, effective connection messages.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 300,
      temperature: 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    const generatedMessage = completion.choices[0].message.content.trim();
    const tokensUsed = completion.usage?.total_tokens || 0;

    // Calculate response score (simplified algorithm)
    let score = 60; // Base score
    
    // Add points for personalization
    if (generatedMessage.includes(profile.fullName)) score += 10;
    if (generatedMessage.includes(profile.currentCompany)) score += 10;
    if (experience.length > 0 && experience.some(exp => generatedMessage.includes(exp.company))) score += 10;
    if (skills.length > 0 && skills.some(skill => generatedMessage.toLowerCase().includes(skill.toLowerCase()))) score += 5;
    
    // Add points for length (optimal range)
    const wordCount = generatedMessage.split(' ').length;
    if (wordCount >= 50 && wordCount <= 150) score += 5;

    // Save message
    const messageId = uuidv4();
    const messageData = {
      id: messageId,
      userId,
      linkedinProfileUrl: profileData.url,
      profileName: profile.fullName,
      profileHeadline: profile.headline,
      userContext,
      generatedText: generatedMessage,
      initialScore: score,
      tokensUsed,
      createdAt: new Date().toISOString()
    };

    messages.set(messageId, messageData);

    // Increment usage
    const newUsage = incrementUsage(userId);
    const creditsRemaining = Math.max(0, freeLimit - newUsage);

    logger.info(`Message generated for user ${userId}, usage: ${newUsage}/${freeLimit}`);

    res.json({
      success: true,
      message: generatedMessage,
      score: score,
      messageId: messageId,
      tokensUsed: tokensUsed,
      creditsRemaining: creditsRemaining
    });

  } catch (error) {
    logger.error('Generate message error:', error);
    
    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'AI service is currently busy. Please try again in a moment.'
      });
    }

    if (error.status === 402) {
      return res.status(402).json({
        success: false,
        message: 'AI service quota exceeded. Please contact support.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate message'
    });
  }
});

// Re-score edited message
app.post('/rescore', authMiddleware, aiLimiter, [
  body('message').trim().isLength({ min: 10, max: 1000 }),
  body('profileData').isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { message, profileData, messageId } = req.body;
    const profile = profileData.basicInfo || {};

    // Calculate score for edited message (simplified)
    let score = 60; // Base score
    
    if (message.includes(profile.fullName)) score += 10;
    if (message.includes(profile.currentCompany)) score += 10;
    
    const wordCount = message.split(' ').length;
    if (wordCount >= 50 && wordCount <= 150) score += 10;
    if (wordCount >= 30 && wordCount < 50) score += 5;
    
    // Check for personalization keywords
    const personalWords = ['experience', 'work', 'company', 'role', 'background', 'career'];
    const personalCount = personalWords.filter(word => message.toLowerCase().includes(word)).length;
    score += personalCount * 3;

    // Update message if messageId provided
    if (messageId && messages.has(messageId)) {
      const messageData = messages.get(messageId);
      messageData.editedText = message;
      messageData.editedScore = score;
      messageData.updatedAt = new Date().toISOString();
      messages.set(messageId, messageData);
    }

    res.json({
      success: true,
      score: score,
      message: 'Message re-scored successfully'
    });

  } catch (error) {
    logger.error('Rescore message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to re-score message'
    });
  }
});

// Get user's recent messages
app.get('/messages', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20 } = req.query;

    const userMessages = Array.from(messages.values())
      .filter(msg => msg.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice((page - 1) * limit, page * limit);

    const total = Array.from(messages.values()).filter(msg => msg.userId === userId).length;

    res.json({
      success: true,
      messages: userMessages.map(msg => ({
        id: msg.id,
        linkedinProfileUrl: msg.linkedinProfileUrl,
        profileName: msg.profileName,
        profileHeadline: msg.profileHeadline,
        userContext: msg.userContext,
        generatedText: msg.generatedText,
        initialScore: msg.initialScore,
        editedText: msg.editedText,
        editedScore: msg.editedScore,
        createdAt: msg.createdAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get usage statistics
app.get('/usage', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const monthlyUsage = getUserUsage(userId);
    const userMessages = Array.from(messages.values()).filter(msg => msg.userId === userId);
    
    res.json({
      success: true,
      usage: {
        monthlyUsage: monthlyUsage,
        freeMonthlyLimit: 30,
        creditsRemaining: Math.max(0, 30 - monthlyUsage),
        totalMessages: userMessages.length,
        averageScore: userMessages.length > 0 
          ? Math.round(userMessages.reduce((sum, msg) => sum + msg.initialScore, 0) / userMessages.length)
          : 0
      }
    });

  } catch (error) {
    logger.error('Get usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Server error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Msgly.AI Complete API server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`OpenAI configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
  
  // Log initial stats
  logger.info(`System ready - Users: ${users.size}, Messages: ${messages.size}`);
});

module.exports = app;
