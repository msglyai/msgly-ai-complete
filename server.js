// Msgly.AI Backend Server - Production Version with All Endpoints
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI with GPT-4
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ENHANCED CORS Configuration for Chrome Extensions
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://www.linkedin.com',
            'https://linkedin.com',
            'https://api.msgly.ai',
            'https://msgly.ai',
            'http://localhost:3000',
            'http://localhost:5000'
        ];
        
        // Allow Chrome extensions
        if (origin.startsWith('chrome-extension://')) {
            return callback(null, true);
        }
        
        // Allow Firefox extensions
        if (origin.startsWith('moz-extension://')) {
            return callback(null, true);
        }
        
        // Check allowed origins
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        console.log('CORS blocked origin:', origin);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
    ],
    credentials: false,
    optionsSuccessStatus: 200,
    preflightContinue: false
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Additional CORS headers middleware
app.use((req, res, next) => {
    const origin = req.get('Origin');
    
    // Always allow Chrome and Firefox extensions
    if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
        res.header('Access-Control-Max-Age', '86400'); // 24 hours
    }
    
    next();
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log('Origin:', req.get('Origin'));
    console.log('User-Agent:', req.get('User-Agent'));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    next();
});

// ==================== API ENDPOINTS ====================

// Health Check Endpoint
app.get('/health', (req, res) => {
    console.log('🏥 Health check requested from:', req.get('Origin'));
    
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        model: 'gpt-4',
        environment: process.env.NODE_ENV || 'production',
        uptime: process.uptime(),
        origin: req.get('Origin'),
        userAgent: req.get('User-Agent'),
        cors: 'enabled'
    });
});

// Alternative health check routes
app.get('/', (req, res) => {
    res.json({
        message: 'Msgly.AI API Server',
        status: 'running',
        endpoints: [
            'GET /health',
            'POST /analyze-user-profile',
            'POST /generate-message',
            'POST /check-score'
        ]
    });
});

// REAL AI PROFILE ANALYSIS ENDPOINT
app.post('/analyze-user-profile', async (req, res) => {
    console.log('🤖 AI Profile Analysis Request:', req.body);
    
    try {
        const { profileUrl, extractionType, requestedData } = req.body;
        
        if (!profileUrl || !profileUrl.includes('linkedin.com/in/')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn profile URL'
            });
        }
        
        // Create AI prompt for name extraction
        const prompt = `
You are an expert at extracting real names from LinkedIn profile URLs. 

LinkedIn Profile URL: ${profileUrl}

Extract the person's real first and last name from this URL. LinkedIn URLs typically contain the person's name in the path after "/in/".

Rules:
1. Convert URL format (dashes/underscores) to proper name format
2. Capitalize first letter of each name part
3. Remove numbers, titles, or suffixes from the URL
4. Return realistic first and last names only
5. If unclear, make best educated guess based on URL structure

Return ONLY a JSON object with this exact format:
{
  "firstName": "First",
  "lastName": "Last", 
  "fullName": "First Last"
}
`;

        console.log('🚀 Calling GPT-4 for profile analysis...');
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that extracts names from LinkedIn URLs. Always respond with valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 150,
            temperature: 0.3
        });

        const aiResponse = completion.choices[0].message.content.trim();
        console.log('🤖 GPT-4 Profile Analysis Response:', aiResponse);
        
        try {
            const extractedData = JSON.parse(aiResponse);
            
            if (extractedData.firstName && extractedData.lastName) {
                console.log('✅ AI successfully extracted name data');
                
                res.json({
                    success: true,
                    data: {
                        firstName: extractedData.firstName,
                        lastName: extractedData.lastName,
                        fullName: extractedData.fullName || `${extractedData.firstName} ${extractedData.lastName}`,
                        analyzedAt: new Date().toISOString(),
                        model: 'gpt-4',
                        profileUrl: profileUrl
                    }
                });
            } else {
                throw new Error('AI did not return valid name data');
            }
            
        } catch (parseError) {
            console.error('❌ Failed to parse AI response:', parseError);
            
            res.status(500).json({
                success: false,
                error: 'AI response parsing failed',
                details: 'Could not extract name from AI response'
            });
        }
        
    } catch (error) {
        console.error('❌ Profile Analysis Error:', error);
        
        res.status(500).json({
            success: false,
            error: 'AI profile analysis failed',
            details: error.message
        });
    }
});

// REAL AI MESSAGE GENERATION ENDPOINT
app.post('/generate-message', async (req, res) => {
    console.log('🤖 AI Message Generation Request:', req.body);
    
    try {
        const { targetProfile, userProfile, context, activityData } = req.body;
        
        if (!targetProfile || !targetProfile.name) {
            return res.status(400).json({
                success: false,
                error: 'Target profile data is required'
            });
        }
        
        if (!context || context.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message context is required'
            });
        }
        
        // Create sophisticated AI prompt for message generation
        const prompt = `
You are an expert LinkedIn outreach specialist. Generate a professional, personalized LinkedIn connection message.

TARGET PROFILE:
- Name: ${targetProfile.name}
- Title: ${targetProfile.title || 'Professional'}
- LinkedIn URL: ${targetProfile.url}

USER PROFILE: ${userProfile ? `
- Name: ${userProfile.data?.aiExtractedName || userProfile.data?.name || 'User'}
- URL: ${userProfile.url || ''}
` : 'Not provided'}

MESSAGE CONTEXT: ${context}

ACTIVITY DATA:
- Followers: ${activityData?.followers || 0}
- Recent Activity: ${activityData?.hasRecentActivity ? 'Yes' : 'No'}

REQUIREMENTS:
1. Keep message under 150 characters (LinkedIn connection message limit)
2. Use the target's first name naturally
3. Focus on the provided context as the main reason for connecting
4. Be professional but personable
5. Include a clear call-to-action (connecting/discussing)
6. No generic phrases like "hope this finds you well"
7. Make it feel personal and specific
8. If user profile is provided, mention relevant connection points subtly

Return ONLY a JSON object with this format:
{
  "message": "Hi [FirstName],\\n\\n[Your message content]\\n\\nBest regards",
  "characterCount": [number],
  "score": [predicted response probability 1-100],
  "reasoning": "Brief explanation of approach"
}
`;

        console.log('🚀 Calling GPT-4 for message generation...');
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a LinkedIn outreach expert. Generate professional, personalized messages that get responses. Always respond with valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 300,
            temperature: 0.7
        });

        const aiResponse = completion.choices[0].message.content.trim();
        console.log('🤖 GPT-4 Message Generation Response:', aiResponse);
        
        try {
            const generatedData = JSON.parse(aiResponse);
            
            if (generatedData.message && generatedData.message.length > 0) {
                console.log('✅ AI successfully generated message');
                
                res.json({
                    success: true,
                    data: {
                        message: generatedData.message,
                        characterCount: generatedData.characterCount || generatedData.message.length,
                        score: generatedData.score || 75,
                        reasoning: generatedData.reasoning || 'AI-generated personalized message',
                        generatedAt: new Date().toISOString(),
                        model: 'gpt-4',
                        context: context
                    }
                });
            } else {
                throw new Error('AI did not return valid message data');
            }
            
        } catch (parseError) {
            console.error('❌ Failed to parse AI message response:', parseError);
            
            res.status(500).json({
                success: false,
                error: 'AI message generation parsing failed',
                details: 'Could not extract message from AI response'
            });
        }
        
    } catch (error) {
        console.error('❌ Message Generation Error:', error);
        
        res.status(500).json({
            success: false,
            error: 'AI message generation failed',
            details: error.message
        });
    }
});

// REAL AI SCORE CHECK ENDPOINT
app.post('/check-score', async (req, res) => {
    console.log('🤖 AI Score Check Request:', req.body);
    
    try {
        const { message, targetProfile, userProfile, activityData } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message content is required for scoring'
            });
        }
        
        if (!targetProfile || !targetProfile.name) {
            return res.status(400).json({
                success: false,
                error: 'Target profile data is required for scoring'
            });
        }
        
        // Create sophisticated AI prompt for message scoring
        const prompt = `
You are a LinkedIn outreach expert analyzing message effectiveness. Score this LinkedIn connection message.

MESSAGE TO ANALYZE:
"${message}"

TARGET PROFILE:
- Name: ${targetProfile.name}
- Title: ${targetProfile.title || 'Professional'}
- LinkedIn URL: ${targetProfile.url}

USER PROFILE: ${userProfile ? `
- Name: ${userProfile.data?.aiExtractedName || userProfile.data?.name || 'User'}
- URL: ${userProfile.url || ''}
` : 'Not provided'}

ACTIVITY DATA:
- Followers: ${activityData?.followers || 0}
- Recent Activity: ${activityData?.hasRecentActivity ? 'Yes' : 'No'}

SCORING CRITERIA:
1. Personalization Level (0-25 points): Uses name, mentions specific details
2. Message Structure (0-20 points): Professional greeting, clear purpose, call-to-action  
3. Length Appropriateness (0-15 points): Ideal 60-150 characters for LinkedIn
4. Engagement Potential (0-20 points): Likely to get a response vs ignored
5. Professionalism (0-10 points): Appropriate tone, no red flags
6. Relevance (0-10 points): Makes sense for the target's profile

DEDUCTIONS:
- Generic phrases: -10 points each
- Too salesy: -15 points
- Too long (>200 chars): -10 points
- Too short (<30 chars): -15 points
- No personalization: -20 points

Calculate a realistic score (20-95) and provide specific advice.

Return ONLY a JSON object:
{
  "score": [number 20-95],
  "breakdown": {
    "personalization": [0-25],
    "structure": [0-20], 
    "length": [0-15],
    "engagement": [0-20],
    "professionalism": [0-10],
    "relevance": [0-10]
  },
  "advice": "Specific actionable advice to improve the message",
  "reasoning": "Brief explanation of the score"
}
`;

        console.log('🚀 Calling GPT-4 for message scoring...');
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a LinkedIn outreach expert. Analyze messages and provide realistic scores with actionable advice. Always respond with valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 400,
            temperature: 0.3
        });

        const aiResponse = completion.choices[0].message.content.trim();
        console.log('🤖 GPT-4 Score Check Response:', aiResponse);
        
        try {
            const scoreData = JSON.parse(aiResponse);
            
            if (typeof scoreData.score === 'number' && scoreData.score >= 0 && scoreData.score <= 100) {
                console.log('✅ AI successfully scored message:', scoreData.score);
                
                res.json({
                    success: true,
                    data: {
                        score: scoreData.score,
                        breakdown: scoreData.breakdown || {},
                        advice: scoreData.advice || 'Message analyzed successfully',
                        reasoning: scoreData.reasoning || 'AI-powered scoring analysis',
                        analyzedAt: new Date().toISOString(),
                        model: 'gpt-4',
                        messageLength: message.length
                    }
                });
            } else {
                throw new Error('AI did not return valid score data');
            }
            
        } catch (parseError) {
            console.error('❌ Failed to parse AI score response:', parseError);
            
            res.status(500).json({
                success: false,
                error: 'AI score analysis parsing failed',
                details: 'Could not extract score from AI response'
            });
        }
        
    } catch (error) {
        console.error('❌ Score Check Error:', error);
        
        res.status(500).json({
            success: false,
            error: 'AI score analysis failed',
            details: error.message
        });
    }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({
        error: 'Route not found',
        availableEndpoints: [
            'GET /health',
            'POST /analyze-user-profile',
            'POST /generate-message', 
            'POST /check-score'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('❌ Global Error Handler:', error);
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// ==================== SERVER STARTUP ====================

// Validate environment variables
function validateEnvironment() {
    const required = ['OPENAI_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:', missing);
        process.exit(1);
    }
    
    console.log('✅ Environment variables validated');
}

// Test OpenAI connection
async function testOpenAIConnection() {
    try {
        console.log('🧪 Testing OpenAI GPT-4 connection...');
        
        const testCompletion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "user",
                    content: "Reply with just 'OK' to confirm connection."
                }
            ],
            max_tokens: 5
        });

        const response = testCompletion.choices[0].message.content.trim();
        console.log('✅ OpenAI GPT-4 connection successful:', response);
        
    } catch (error) {
        console.error('❌ OpenAI GPT-4 connection failed:', error.message);
        console.error('🚨 Server will start but AI features will not work');
    }
}

// Start server
async function startServer() {
    try {
        // Validate environment
        validateEnvironment();
        
        // Test OpenAI connection
        await testOpenAIConnection();
        
        // Start listening
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Msgly.AI Server Started Successfully!');
            console.log(`📍 Server running on port ${PORT}`);
            console.log(`🌐 Health check: http://localhost:${PORT}/health`);
            console.log(`🤖 AI Model: GPT-4`);
            console.log(`🔧 Environment: ${process.env.NODE_ENV || 'production'}`);
            console.log(`⏰ Started at: ${new Date().toISOString()}`);
            
            if (process.env.RAILWAY_ENVIRONMENT) {
                console.log('🚂 Running on Railway');
                console.log(`🔗 Public URL: https://${process.env.RAILWAY_STATIC_URL || 'api.msgly.ai'}`);
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📥 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📥 SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
