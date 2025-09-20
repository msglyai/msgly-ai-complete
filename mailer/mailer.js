// mailer/mailer.js - MailerSend Service for Msgly.AI
// Railway-first configuration - all settings from process.env
// Supports both MailerSend API and SMTP fallback

const fs = require('fs').promises;
const path = require('path');

// MailerSend SDK (will be installed)
let MailerSend, EmailParams, Sender, Recipient;

try {
    const mailerSendModule = require('mailersend');
    MailerSend = mailerSendModule.MailerSend;
    EmailParams = mailerSendModule.EmailParams;
    Sender = mailerSendModule.Sender;
    Recipient = mailerSendModule.Recipient;
} catch (error) {
    console.warn('[MAILER] MailerSend SDK not installed, SMTP-only mode');
}

// SMTP fallback (using nodemailer)
const nodemailer = require('nodemailer');

// Environment configuration (Railway Variables)
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const MAILERSEND_FROM_EMAIL = process.env.MAILERSEND_FROM_EMAIL || 'no-reply@msgly.ai';
const MAILERSEND_FROM_NAME = process.env.MAILERSEND_FROM_NAME || 'Msgly.AI';
const MAILERSEND_USE_SMTP = process.env.MAILERSEND_USE_SMTP === 'true';

// SMTP configuration (if enabled)
const SMTP_CONFIG = {
    host: process.env.MAILERSEND_SMTP_HOST || 'smtp.mailersend.net',
    port: parseInt(process.env.MAILERSEND_SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.MAILERSEND_SMTP_USER,
        pass: process.env.MAILERSEND_SMTP_PASS
    }
};

// Initialize MailerSend client
let mailerSendClient = null;
if (MailerSend && MAILERSEND_API_KEY && !MAILERSEND_USE_SMTP) {
    mailerSendClient = new MailerSend({
        apiKey: MAILERSEND_API_KEY,
    });
    console.log('[MAILER] MailerSend API client initialized');
} else if (MAILERSEND_USE_SMTP) {
    console.log('[MAILER] SMTP mode enabled');
} else {
    console.warn('[MAILER] MailerSend API key missing, falling back to SMTP');
}

// Initialize SMTP transporter
let smtpTransporter = null;
if (MAILERSEND_USE_SMTP || !mailerSendClient) {
    try {
        smtpTransporter = nodemailer.createTransporter(SMTP_CONFIG);
        console.log('[MAILER] SMTP transporter initialized');
    } catch (error) {
        console.error('[MAILER] SMTP initialization failed:', error.message);
    }
}

// Template interpolation function
function interpolateTemplate(template, variables) {
    let result = template;
    
    // Replace {{name}} and {{product}} placeholders
    for (const [key, value] of Object.entries(variables)) {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(placeholder, value || '');
    }
    
    return result;
}

// Load email templates
async function loadTemplate(templateName) {
    try {
        const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
        const textTemplatePath = path.join(__dirname, 'templates', `${templateName}.txt`);
        
        const [htmlContent, textContent] = await Promise.all([
            fs.readFile(templatePath, 'utf8'),
            fs.readFile(textTemplatePath, 'utf8').catch(() => null)
        ]);
        
        return {
            html: htmlContent,
            text: textContent
        };
    } catch (error) {
        console.error(`[MAILER] Error loading template ${templateName}:`, error.message);
        throw new Error(`Template ${templateName} not found`);
    }
}

// Validate email address
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Send email via MailerSend API
async function sendViaMailerSend(emailData) {
    if (!mailerSendClient) {
        throw new Error('MailerSend client not initialized');
    }

    try {
        const emailParams = new EmailParams()
            .setFrom(new Sender(MAILERSEND_FROM_EMAIL, MAILERSEND_FROM_NAME))
            .setTo([new Recipient(emailData.toEmail, emailData.toName)])
            .setSubject(emailData.subject)
            .setHtml(emailData.htmlContent)
            .setText(emailData.textContent);

        console.log(`[MAILER] Sending via MailerSend API to ${emailData.toEmail}`);
        
        const response = await mailerSendClient.email.send(emailParams);
        
        console.log('[MAILER] MailerSend API response:', response);
        
        // MailerSend returns different response formats
        const messageId = response?.body?.message_id || response?.message_id || 'unknown';
        
        return {
            success: true,
            messageId: messageId,
            provider: 'mailersend_api',
            response: response
        };
        
    } catch (error) {
        console.error('[MAILER] MailerSend API error:', error);
        
        // Parse MailerSend error for retry logic
        const isRetryable = error.status === 429 || (error.status >= 500 && error.status < 600);
        
        throw {
            error: error.message,
            status: error.status,
            isRetryable: isRetryable,
            provider: 'mailersend_api'
        };
    }
}

// Send email via SMTP
async function sendViaSMTP(emailData) {
    if (!smtpTransporter) {
        throw new Error('SMTP transporter not initialized');
    }

    try {
        console.log(`[MAILER] Sending via SMTP to ${emailData.toEmail}`);
        
        const mailOptions = {
            from: `"${MAILERSEND_FROM_NAME}" <${MAILERSEND_FROM_EMAIL}>`,
            to: `"${emailData.toName}" <${emailData.toEmail}>`,
            subject: emailData.subject,
            html: emailData.htmlContent,
            text: emailData.textContent
        };

        const result = await smtpTransporter.sendMail(mailOptions);
        
        console.log('[MAILER] SMTP send successful:', result.messageId);
        
        return {
            success: true,
            messageId: result.messageId,
            provider: 'smtp',
            response: result
        };
        
    } catch (error) {
        console.error('[MAILER] SMTP error:', error);
        
        // SMTP errors are generally retryable
        throw {
            error: error.message,
            status: null,
            isRetryable: true,
            provider: 'smtp'
        };
    }
}

// Retry logic with jitter
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main send function with retry
async function sendEmailWithRetry(emailData, maxRetries = 1) {
    let lastError = null;
    
    // Determine provider
    const useAPI = mailerSendClient && !MAILERSEND_USE_SMTP;
    const provider = useAPI ? 'MailerSend API' : 'SMTP';
    
    console.log(`[MAILER] Using ${provider} for ${emailData.toEmail}`);
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            if (useAPI) {
                return await sendViaMailerSend(emailData);
            } else {
                return await sendViaSMTP(emailData);
            }
        } catch (error) {
            lastError = error;
            
            console.error(`[MAILER] Attempt ${attempt} failed:`, error.error);
            
            // Don't retry on non-retryable errors
            if (!error.isRetryable || attempt > maxRetries) {
                break;
            }
            
            // Retry with jitter (500-1500ms)
            const jitter = 500 + Math.random() * 1000;
            console.log(`[MAILER] Retrying in ${Math.round(jitter)}ms...`);
            await sleep(jitter);
        }
    }
    
    // All attempts failed
    throw lastError;
}

// Main export function: Send Welcome Email
async function sendWelcomeEmail({ toEmail, toName, userId }) {
    console.log(`[MAILER] sendWelcomeEmail called for ${toEmail} (User ID: ${userId})`);
    
    try {
        // Validate inputs
        if (!toEmail || !isValidEmail(toEmail)) {
            console.error('[MAILER] Invalid email address:', toEmail);
            return {
                ok: false,
                error: 'Invalid email address'
            };
        }
        
        // Skip obviously invalid emails
        const invalidPatterns = ['test@', 'example@', 'noreply@', 'no-reply@'];
        if (invalidPatterns.some(pattern => toEmail.toLowerCase().includes(pattern))) {
            console.log(`[MAILER] Skipping invalid email pattern: ${toEmail}`);
            return {
                ok: false,
                error: 'Invalid email pattern - skipped'
            };
        }
        
        // Load welcome template
        console.log('[MAILER] Loading welcome template...');
        const templates = await loadTemplate('welcome');
        
        // Prepare template variables
        const templateVars = {
            name: toName || toEmail.split('@')[0], // Fallback to email username
            product: 'Msgly.AI' // Hardcoded as requested
        };
        
        // Interpolate templates
        const htmlContent = interpolateTemplate(templates.html, templateVars);
        const textContent = templates.text ? interpolateTemplate(templates.text, templateVars) : null;
        
        console.log('[MAILER] Templates loaded and interpolated');
        
        // Prepare email data
        const emailData = {
            toEmail: toEmail,
            toName: toName || templateVars.name,
            subject: `Welcome to Msgly.AI - Let's Get Started! 🚀`,
            htmlContent: htmlContent,
            textContent: textContent
        };
        
        // Send email with retry
        console.log('[MAILER] Sending welcome email...');
        const result = await sendEmailWithRetry(emailData, 1);
        
        console.log(`[MAILER] Welcome email sent successfully via ${result.provider}`);
        console.log(`[MAILER] Message ID: ${result.messageId}`);
        
        return {
            ok: true,
            provider: result.provider,
            messageId: result.messageId,
            toEmail: toEmail,
            toName: toName,
            userId: userId
        };
        
    } catch (error) {
        console.error('[MAILER] Welcome email failed:', error);
        
        return {
            ok: false,
            error: error.error || error.message || 'Unknown email error',
            provider: error.provider || 'unknown',
            toEmail: toEmail,
            userId: userId
        };
    }
}

// 🚀 NEW: Admin Notification Email Function
async function sendAdminNotification({ userEmail, userName, packageType, billingModel, linkedinUrl, userId }) {
    console.log(`[MAILER] sendAdminNotification called for new user: ${userEmail} (User ID: ${userId})`);
    
    try {
        // Admin notification details
        const adminEmail = 'ziv@msgly.ai';
        const adminName = 'Ziv';
        
        // Extract LinkedIn domain for privacy
        const linkedinDomain = linkedinUrl ? new URL(linkedinUrl).hostname : 'Not provided';
        
        // Create timestamp
        const timestamp = new Date().toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Create HTML email content
        const htmlContent = `
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background: #4a90e2; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; }
                .detail-box { background: #f8f9fa; border: 1px solid #dee2e6; padding: 15px; margin: 10px 0; border-radius: 5px; }
                .success { color: #28a745; font-weight: bold; }
                .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🎉 New User Registration - Msgly.AI</h1>
            </div>
            <div class="content">
                <p class="success">A new user has successfully completed registration!</p>
                
                <div class="detail-box">
                    <h3>👤 User Details</h3>
                    <p><strong>Name:</strong> ${userName || 'Not provided'}</p>
                    <p><strong>Email:</strong> ${userEmail}</p>
                    <p><strong>User ID:</strong> ${userId}</p>
                </div>
                
                <div class="detail-box">
                    <h3>📋 Plan Details</h3>
                    <p><strong>Package:</strong> ${packageType || 'Free'}</p>
                    <p><strong>Billing:</strong> ${billingModel || 'Monthly'}</p>
                </div>
                
                <div class="detail-box">
                    <h3>🔗 Additional Info</h3>
                    <p><strong>LinkedIn:</strong> ${linkedinDomain}</p>
                    <p><strong>Registration Time:</strong> ${timestamp}</p>
                </div>
                
                <div class="footer">
                    <p>This is an automated notification from Msgly.AI registration system.</p>
                </div>
            </div>
        </body>
        </html>`;
        
        // Create text content
        const textContent = `
        NEW USER REGISTRATION - Msgly.AI
        
        A new user has successfully completed registration!
        
        USER DETAILS:
        - Name: ${userName || 'Not provided'}
        - Email: ${userEmail}
        - User ID: ${userId}
        
        PLAN DETAILS:
        - Package: ${packageType || 'Free'}
        - Billing: ${billingModel || 'Monthly'}
        
        ADDITIONAL INFO:
        - LinkedIn: ${linkedinDomain}
        - Registration Time: ${timestamp}
        
        This is an automated notification from Msgly.AI registration system.`;
        
        // Prepare email data
        const emailData = {
            toEmail: adminEmail,
            toName: adminName,
            subject: `🚀 New User Alert: ${userName || userEmail} joined Msgly.AI (${packageType || 'Free'})`,
            htmlContent: htmlContent,
            textContent: textContent
        };
        
        // Send email with retry
        console.log('[MAILER] Sending admin notification email...');
        const result = await sendEmailWithRetry(emailData, 1);
        
        console.log(`[MAILER] Admin notification sent successfully via ${result.provider}`);
        console.log(`[MAILER] Message ID: ${result.messageId}`);
        
        return {
            ok: true,
            provider: result.provider,
            messageId: result.messageId,
            adminEmail: adminEmail,
            userEmail: userEmail,
            userId: userId
        };
        
    } catch (error) {
        console.error('[MAILER] Admin notification failed:', error);
        
        return {
            ok: false,
            error: error.error || error.message || 'Unknown email error',
            provider: error.provider || 'unknown',
            userEmail: userEmail,
            userId: userId
        };
    }
}

// Configuration check
function checkConfiguration() {
    const hasAPIKey = !!MAILERSEND_API_KEY;
    const hasSMTPConfig = !!(SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass);
    const isConfigured = hasAPIKey || hasSMTPConfig;
    
    return {
        isConfigured: isConfigured,
        hasAPIKey: hasAPIKey,
        hasSMTPConfig: hasSMTPConfig,
        useAPI: !MAILERSEND_USE_SMTP && hasAPIKey,
        useSMTP: MAILERSEND_USE_SMTP || !hasAPIKey,
        fromEmail: MAILERSEND_FROM_EMAIL,
        fromName: MAILERSEND_FROM_NAME
    };
}

// Export functions
module.exports = {
    sendWelcomeEmail,
    sendAdminNotification, // 🚀 NEW: Added admin notification export
    checkConfiguration
};
