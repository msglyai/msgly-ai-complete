// Msgly.AI Complete Backend Server - Updated for GPT-4.1 & AI Scoring
// Production-ready system with OpenAI GPT-4.1 integration
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

// CORS configuration - Enhanced for Chrome Extensions
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow Chrome extension origins
    if (origin && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    // Allow your domains
    const allowedOrigins = [
      'https://msgly.ai',
      'https://www.msgly.ai',
      'https://api.msgly.ai',
      'https://linkedin.com',
      'https://www.linkedin.com',
      'http://localhost:3000',
      'http://localhost:8080'
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow all other origins for now (development mode)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Access-Control-Allow-Origin']
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
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
    model: 'gpt-4.1' // Updated to show GPT-4.1
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
      model: 'gpt-4.1', // Updated to GPT-4.1
      messages: [{ role: 'user', content: 'Say "OK" if you can hear this.' }],
      max_tokens: 5,
      temperature: 0
    });

    res.json({
      success: true,
      status: 'healthy',
      model: 'gpt-4.1', // Updated to GPT-4.1
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

// AI Profile Analysis - Extract real name from LinkedIn profile
app.post('/analyze-user-profile', [
  body('profileUrl').isURL().contains('linkedin.com/in/')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Valid LinkedIn profile URL required',
        errors: errors.array()
      });
    }

    const { profileUrl } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'AI service not configured'
      });
    }

    // Use OpenAI to extract name from LinkedIn URL
    const prompt = `Extract the first and last name from this LinkedIn profile URL: ${profileUrl}

The URL format is: linkedin.com/in/[username]

Rules:
1. Convert linkedin.com/in/john-smith-123 to "John Smith"
2. Convert linkedin.com/in/jane-doe-phd to "Jane Doe"  
3. Remove numbers, titles (phd, md, jr, sr), and extra suffixes
4. Capitalize first letter of each name part
5. Return only the clean first and last name
6. If you cannot determine a proper name, return "Unknown User"

Examples:
- linkedin.com/in/john-smith → "John Smith"  
- linkedin.com/in/sarah-johnson-123 → "Sarah Johnson"
- linkedin.com/in/michael-brown-phd → "Michael Brown"

Return only the name, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1', // Updated to GPT-4.1
      messages: [
        {
          role: 'system',
          content: 'You are a name extraction specialist. Extract clean first and last names from LinkedIn URLs.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const extractedName = completion.choices[0].message.content.trim();

    logger.info(`AI extracted name: ${extractedName} from URL: ${profileUrl}`);

    res.json({
      success: true,
      data: {
        fullName: extractedName,
        profileUrl: profileUrl
      }
    });

  } catch (error) {
    logger.error('Profile analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze profile'
    });
  }
});

// Generate personalized message - UPDATED FOR GPT-4.1 & ≤150 CHARACTERS
app.post('/generate', authMiddleware, aiLimiter, [
  body('profileData').isObject(),
  body('userContext').trim().isLength({ min: 10, max: 1000 }),
  body('userProfile').optional().isObject() // User's own profile data
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
    const { profileData, userContext, userProfile } = req.body;

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

    // Prepare comprehensive data for AI
    const targetProfile = profileData.basicInfo || {};
    const experience = profileData.experience?.slice(0, 3) || [];
    const education = profileData.education?.slice(0, 2) || [];
    const skills = profileData.skills?.slice(0, 10) || [];
    const activity = profileData.activity || {};
    
    // User's own profile data
    const userProfileData = userProfile || {};

    // ENHANCED PROMPT FOR GPT-4.1 WITH COMPREHENSIVE DATA ANALYSIS
    const prompt = `You are an expert LinkedIn outreach specialist. Create a personalized, professional LinkedIn message. Use the Data From the User Profile and The Target Profile. Make sure that you Are Putting the Attention on the Context that you Get from the User.

ANALYZE ALL DATA FOR COMMON GROUND:

USER PROFILE DATA:
Name: ${userProfileData.name || 'Not provided'}
Title: ${userProfileData.title || 'Not provided'}
Company: ${userProfileData.company || 'Not provided'}
Background: ${userProfileData.background || 'Not provided'}
Education: ${userProfileData.education || 'Not provided'}
Experience: ${userProfileData.experience || 'Not provided'}
Skills: ${userProfileData.skills || 'Not provided'}

TARGET PROFILE DATA:
Name: ${targetProfile.fullName || 'Not available'}
Headline: ${targetProfile.headline || 'Not available'}
Current Position: ${targetProfile.currentPosition || 'Not available'}
Current Company: ${targetProfile.currentCompany || 'Not available'}
Location: ${targetProfile.location || 'Not available'}
About: ${targetProfile.about || 'Not available'}

TARGET'S RECENT EXPERIENCE:
${experience.map(exp => `• ${exp.title} at ${exp.company} (${exp.duration})`).join('\n') || 'Not available'}

TARGET'S EDUCATION:
${education.map(edu => `• ${edu.degree} at ${edu.school} (${edu.dates})`).join('\n') || 'Not available'}

TARGET'S KEY SKILLS:
${skills.join(', ') || 'Not available'}

TARGET'S ACTIVITY DATA (PAY ATTENTION):
Followers: ${activity.followers || 'Not available'}
Recent Posts: ${activity.posts || 'Not available'}
Comments Made: ${activity.comments || 'Not available'}
Likes/Reactions Received: ${activity.reactions || 'Not available'}
Has Recent Activity: ${activity.hasRecentActivity ? 'Yes - Active User' : 'No - Less Active'}

USER CONTEXT (PRIMARY FOCUS - MOST IMPORTANT):
${userContext}

MANDATORY ANALYSIS CHECKLIST:
✓ Look for COMMON GROUND between user and target:
  - Same University/School
  - Same Company (past or present)
  - Similar Industries
  - Shared Skills
  - Similar Roles/Titles
  - Same Location/Region
  - Mutual Interests

✓ Analyze TARGET'S ACTIVITY:
  - High activity = mention their posts/engagement
  - Recent posts = reference current content
  - Comments/likes = show you've noticed their engagement
  - Followers = adjust tone based on influence level

✓ Focus on USER CONTEXT:
  - This is the PRIMARY reason for the message
  - Make the context the central theme
  - Connect context to target's background

REQUIREMENTS:
1. Create a LinkedIn message (NOT a connection request)
2. MAXIMUM 150 CHARACTERS (including spaces and punctuation)
3. Focus primarily on the user context provided
4. MUST identify and mention common ground if it exists
5. Reference activity if target is active (posts, comments, likes)
6. Make it personal using target's specific background
7. Always generate a message (never refuse)
8. Keep it professional but conversational
9. Include a soft call-to-action
10. Use target's first name

CHARACTER LIMIT: Absolutely must be ≤150 characters total.

Return only the message text, no quotes or extra formatting.`;

    // Generate message using GPT-4.1
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1', // Updated to GPT-4.1
      messages: [
        {
          role: 'system',
          content: 'You are an expert LinkedIn outreach specialist who writes ultra-concise, personalized messages under 150 characters that get responses.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 100, // Reduced for shorter messages
      temperature: 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    const generatedMessage = completion.choices[0].message.content.trim();
    const messageLength = generatedMessage.length;
    const tokensUsed = completion.usage?.total_tokens || 0;

    // Ensure message is within 150 character limit
    if (messageLength > 150) {
      logger.warn(`Generated message too long: ${messageLength} chars, truncating...`);
      // If over limit, we could truncate or regenerate, but for now we'll return as-is with warning
    }

    // COMPREHENSIVE AI-POWERED SCORING ANALYSIS - FLEXIBLE POINT SYSTEM
    const scorePrompt = `Analyze this LinkedIn message and calculate a response probability score (0-100%). You are an expert at predicting LinkedIn message response rates. Use these scoring guidelines as suggestions, but apply your AI intelligence to adjust points based on the specific context.

MESSAGE TO ANALYZE:
"${generatedMessage}"

USER PROFILE DATA:
Name: ${userProfileData.name || 'Unknown'}
Title: ${userProfileData.title || 'Unknown'}
Company: ${userProfileData.company || 'Unknown'}
Background: ${userProfileData.background || 'Unknown'}

TARGET PROFILE DATA:
Name: ${targetProfile.fullName || 'Unknown'}
Position: ${targetProfile.currentPosition || 'Unknown'}
Company: ${targetProfile.currentCompany || 'Unknown'}
Headline: ${targetProfile.headline || 'Unknown'}
Location: ${targetProfile.location || 'Unknown'}
Education: ${education.map(edu => `${edu.school} (${edu.degree})`).join(', ') || 'Unknown'}
Experience: ${experience.map(exp => `${exp.company} (${exp.title})`).join(', ') || 'Unknown'}
Skills: ${skills.join(', ') || 'Unknown'}

TARGET'S ACTIVITY ANALYSIS:
Followers: ${activity.followers || 0}
Recent Posts: ${activity.posts || 0}
Comments Made: ${activity.comments || 0}
Likes/Reactions Received: ${activity.reactions || 0}
Has Recent Activity: ${activity.hasRecentActivity ? 'Yes - Active User' : 'No - Less Active'}

USER CONTEXT:
${userContext}

FLEXIBLE SCORING GUIDELINES (use your AI judgment to adjust):

1. **Common Ground Analysis (~20 points total):**
   - Same University/School = ±15 points (adjust based on prestige, relevance)
   - Same Company (past/present) = ±15 points (adjust based on timing, role level)
   - Similar Industry = ±10 points (adjust based on how similar)
   - Shared Skills = ±8 points (adjust based on skill relevance)
   - Same Location = ±5 points (adjust based on market size)
   - Similar Role/Title = ±7 points (adjust based on career level)

2. **Personalization Quality (~20 points total):**
   - Uses target's first name = ±8 points (natural vs forced usage)
   - Mentions specific company = ±8 points (current vs past, relevance)
   - References their role/title = ±6 points (accuracy and relevance)
   - Shows knowledge of background = ±10 points (depth of knowledge shown)

3. **Message Structure (~15 points total):**
   - Optimal length (60-150 chars) = ±10 points (perfect fit vs too short/long)
   - Professional tone = ±8 points (appropriate for industry/person)
   - Clear call-to-action = ±7 points (compelling vs weak)
   - Grammar/spelling = ±5 points (perfect vs minor errors)

4. **Context Relevance (~15 points total):**
   - User context highly relevant = ±15 points (perfect match vs generic)
   - Context matches target's needs = ±12 points (timing and relevance)
   - Context shows research = ±8 points (personalized vs template)

5. **Activity Consideration (~15 points total):**
   - References their posts/content = ±10 points (specific vs general)
   - Acknowledges activity level = ±8 points (appropriate for their influence)
   - Mentions engagement/comments = ±7 points (shows real attention)
   - Timing consideration = ±5 points (good timing vs bad timing)

6. **Response Likelihood Factors (~15 points total):**
   - Target is active user = ±8 points (but busy users harder to reach)
   - Message shows genuine interest = ±10 points (authentic vs fake)
   - Clear mutual benefit = ±8 points (win-win vs one-sided)
   - Not overly salesy = ±5 points (professional vs pushy)

APPLY YOUR AI INTELLIGENCE:
- Adjust points up/down based on specific context
- Consider industry norms (tech vs finance vs healthcare)
- Factor in seniority level (CEO vs individual contributor)
- Account for message timing and market conditions
- Weight factors differently based on target profile

NEGATIVE FACTORS (flexible penalties):
- Generic/template language = -5 to -15 points (severity dependent)
- Too salesy/pushy = -10 to -20 points (adjust based on approach)
- No personalization = -15 to -25 points (complete vs partial)
- Length issues = -5 to -15 points (how far off optimal)

Use your AI expertise to calculate a realistic percentage probability (0-100%) that this message will get a response. Consider all factors holistically, not just mechanically adding points.

Return ONLY a number between 0-100.`;

    const scoreCompletion = await openai.chat.completions.create({
      model: 'gpt-4.1', // AI calculates score using GPT-4.1
      messages: [
        {
          role: 'system',
          content: 'You are an expert at predicting LinkedIn message response rates. Return only a number between 0-100.'
        },
        {
          role: 'user',
          content: scorePrompt
        }
      ],
      max_tokens: 10,
      temperature: 0.3
    });

    const aiScore = parseInt(scoreCompletion.choices[0].message.content.trim()) || 50;

    // Save message
    const messageId = uuidv4();
    const messageData = {
      id: messageId,
      userId,
      linkedinProfileUrl: profileData.url,
      profileName: targetProfile.fullName,
      profileHeadline: targetProfile.headline,
      userContext,
      generatedText: generatedMessage,
      messageLength: messageLength,
      aiScore: aiScore, // AI-calculated score
      tokensUsed,
      model: 'gpt-4.1', // Track which model was used
      createdAt: new Date().toISOString()
    };

    messages.set(messageId, messageData);

    // Increment usage
    const newUsage = incrementUsage(userId);
    const creditsRemaining = Math.max(0, freeLimit - newUsage);

    logger.info(`GPT-4.1 message generated for user ${userId}, usage: ${newUsage}/${freeLimit}, length: ${messageLength} chars, AI score: ${aiScore}%`);

    res.json({
      success: true,
      message: generatedMessage,
      messageLength: messageLength,
      characterLimit: 150,
      score: aiScore, // AI-calculated probability score
      messageId: messageId,
      tokensUsed: tokensUsed,
      model: 'gpt-4.1',
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

// Re-score edited message - UPDATED TO USE AI SCORING
app.post('/rescore', authMiddleware, aiLimiter, [
  body('message').trim().isLength({ min: 10, max: 500 }),
  body('profileData').isObject(),
  body('userProfile').optional().isObject()
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

    const { message, profileData, messageId, userProfile, userContext } = req.body;
    const targetProfile = profileData.basicInfo || {};
    const activity = profileData.activity || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'AI service not configured'
      });
    }

    // COMPREHENSIVE AI-POWERED SCORING FOR EDITED MESSAGES - FLEXIBLE SYSTEM
    const scorePrompt = `Analyze this LinkedIn message and calculate a response probability score (0-100%). You are an expert at predicting LinkedIn message response rates. Use these scoring guidelines as suggestions, but apply your AI intelligence to adjust points based on the specific context.

MESSAGE TO ANALYZE:
"${message}"

USER PROFILE DATA:
Name: ${userProfile?.name || 'Unknown'}
Title: ${userProfile?.title || 'Unknown'}
Company: ${userProfile?.company || 'Unknown'}

TARGET PROFILE DATA:
Name: ${targetProfile.fullName || 'Unknown'}
Position: ${targetProfile.currentPosition || 'Unknown'}  
Company: ${targetProfile.currentCompany || 'Unknown'}
Headline: ${targetProfile.headline || 'Unknown'}
Experience: ${profileData.experience?.map(exp => `${exp.company} (${exp.title})`).join(', ') || 'Unknown'}
Education: ${profileData.education?.map(edu => `${edu.school} (${edu.degree})`).join(', ') || 'Unknown'}
Skills: ${profileData.skills?.join(', ') || 'Unknown'}

TARGET'S ACTIVITY ANALYSIS:
Followers: ${activity.followers || 0}
Recent Posts: ${activity.posts || 0}
Comments Made: ${activity.comments || 0}
Likes/Reactions: ${activity.reactions || 0}
Has Recent Activity: ${activity.hasRecentActivity ? 'Yes - Active User' : 'No - Less Active'}

USER CONTEXT:
${userContext || 'Not provided'}

FLEXIBLE SCORING GUIDELINES (use your AI judgment to adjust):

1. **Common Ground Analysis (~20 points total):**
   - Same University/School = ±15 points (adjust for prestige, timing, relevance)
   - Same Company (past/present) = ±15 points (adjust for role overlap, timing)
   - Similar Industry = ±10 points (adjust for how closely related)
   - Shared Skills = ±8 points (adjust for skill importance and rarity)
   - Same Location = ±5 points (adjust for market size and networking value)
   - Similar Role/Title = ±7 points (adjust for career level and experience)

2. **Personalization Quality (~20 points total):**
   - Uses target's first name = ±8 points (natural integration vs forced)
   - Mentions specific company = ±8 points (current relevance vs outdated)
   - References their role/title = ±6 points (accuracy and contextual fit)
   - Shows background knowledge = ±10 points (depth and accuracy of research)

3. **Message Structure (~15 points total):**
   - Good length (60-300 chars for edited) = ±10 points (optimal vs too short/long)
   - Professional tone = ±8 points (appropriate for industry and seniority)
   - Clear call-to-action = ±7 points (compelling and specific vs vague)
   - Grammar/spelling quality = ±5 points (perfect vs minor issues)

4. **Context Relevance (~15 points total):**
   - User context highly relevant = ±15 points (perfect alignment vs generic)
   - Context timing appropriateness = ±12 points (right moment vs poor timing)
   - Context shows genuine research = ±8 points (personalized vs template)

5. **Activity Consideration (~15 points total):**
   - References their posts/content = ±10 points (specific mentions vs general)
   - Acknowledges activity level = ±8 points (appropriate for influence level)
   - Mentions engagement/comments = ±7 points (shows real attention to their content)
   - Activity timing consideration = ±5 points (recent vs outdated references)

6. **Response Likelihood Factors (~15 points total):**
   - Target is active user = ±8 points (but consider if they're overwhelmed)
   - Message shows genuine interest = ±10 points (authentic vs manufactured)
   - Clear mutual benefit = ±8 points (win-win vs one-sided ask)
   - Professional approach = ±5 points (consultative vs overly sales-focused)

APPLY YOUR AI INTELLIGENCE:
- Adjust points flexibly based on specific situation
- Consider industry culture (startup vs corporate vs non-profit)
- Factor in seniority (C-level vs manager vs individual contributor)
- Account for current market conditions and trends
- Weight factors based on what matters most for this specific target

NEGATIVE FACTORS (flexible penalties):
- Generic/template language = -5 to -20 points (based on how obvious it is)
- Too salesy/pushy = -10 to -25 points (based on severity and inappropriateness)
- No personalization = -15 to -30 points (complete absence vs minimal effort)
- Length issues = -5 to -15 points (based on how far from optimal)
- Poor timing/context = -5 to -15 points (based on appropriateness)

Use your AI expertise to evaluate this message holistically. Consider the interplay between all factors rather than mechanically adding points. Calculate a realistic percentage probability (0-100%) based on your analysis.

Pay special attention to:
- Quality and relevance of common ground
- Genuine personalization vs template approach
- Activity level and engagement appropriateness
- Context alignment with target's likely interests

Return ONLY a number between 0-100.`;

    const scoreCompletion = await openai.chat.completions.create({
      model: 'gpt-4.1', // AI calculates score using GPT-4.1
      messages: [
        {
          role: 'system',
          content: 'You are an expert at predicting LinkedIn message response rates. Return only a number between 0-100.'
        },
        {
          role: 'user',
          content: scorePrompt
        }
      ],
      max_tokens: 10,
      temperature: 0.3
    });

    const aiScore = parseInt(scoreCompletion.choices[0].message.content.trim()) || 50;

    // Update message if messageId provided
    if (messageId && messages.has(messageId)) {
      const messageData = messages.get(messageId);
      messageData.editedText = message;
      messageData.editedScore = aiScore;
      messageData.updatedAt = new Date().toISOString();
      messages.set(messageId, messageData);
    }

    logger.info(`AI-powered rescore completed: ${aiScore}% for message length ${message.length}`);

    res.json({
      success: true,
      score: aiScore, // AI-calculated score
      messageLength: message.length,
      model: 'gpt-4.1',
      message: 'Message re-scored using AI analysis'
    });

  } catch (error) {
    logger.error('AI Rescore message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to re-score message with AI'
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
        messageLength: msg.messageLength,
        aiScore: msg.aiScore || msg.initialScore, // Use AI score if available
        editedText: msg.editedText,
        editedScore: msg.editedScore,
        model: msg.model || 'gpt-3.5-turbo', // Track model used
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
    
    // Calculate average AI score
    const aiScores = userMessages
      .map(msg => msg.aiScore || msg.initialScore)
      .filter(score => score > 0);
    
    const averageScore = aiScores.length > 0 
      ? Math.round(aiScores.reduce((sum, score) => sum + score, 0) / aiScores.length)
      : 0;
    
    res.json({
      success: true,
      usage: {
        monthlyUsage: monthlyUsage,
        freeMonthlyLimit: 30,
        creditsRemaining: Math.max(0, 30 - monthlyUsage),
        totalMessages: userMessages.length,
        averageAIScore: averageScore, // AI-calculated average
        model: 'gpt-4.1' // Current model in use
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
  logger.info(`AI Model: GPT-4.1`); // Updated log
  
  // Log initial stats
  logger.info(`System ready - Users: ${users.size}, Messages: ${messages.size}`);
});

module.exports = app;
