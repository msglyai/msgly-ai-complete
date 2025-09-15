// File upload controller for target profile analysis
const { FileExtractorService } = require('../services/file-extractor');
const { backupDB } = require('../config/neon-backup');
const { sendToGemini } = require('../gemini'); // Your existing Gemini service
const { createCreditHold, completeOperation } = require('../services/creditService');

class FileUploadController {
    constructor() {
        this.fileExtractor = new FileExtractorService();
        this.analysisCredits = 0.25; // Cost for file analysis
    }

    // Main file upload handler
    async handleFileUpload(req, res) {
        const transaction = { id: null };
        
        try {
            // 1. Validate request and file
            const validation = this.validateRequest(req);
            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            const { file, userId, userConsented } = validation.data;

            // 2. Extract text from file
            console.log(`[FILE_UPLOAD] Processing file: ${file.originalname} for user ${userId}`);
            const extractionResult = await this.fileExtractor.extractTextFromFile(
                file.buffer, 
                file.mimetype, 
                file.originalname
            );

            // 3. Check for duplicates before charging credits
            const duplicateCheck = await this.checkForDuplicates(
                userId, 
                file.buffer, 
                extractionResult.text
            );

            if (duplicateCheck.isDuplicate) {
                return res.json({
                    success: true,
                    isDuplicate: true,
                    message: duplicateCheck.message,
                    existingData: duplicateCheck.existingData,
                    creditsCharged: 0,
                    fileProfileId: duplicateCheck.existingId
                });
            }

            // 4. Create credit hold for analysis
            transaction.id = await createCreditHold(userId, this.analysisCredits, 'file_analysis');
            console.log(`[FILE_UPLOAD] Credit hold created: ${transaction.id}`);

            // 5. Analyze with existing Gemini service (GPT-5 Nano)
            const analysisResult = await sendToGemini({
                html: extractionResult.text,
                url: `file://${file.originalname}`,
                isUserProfile: false // This is a target profile
            });

            if (!analysisResult.success) {
                throw new Error(`Analysis failed: ${analysisResult.error}`);
            }

            // 6. Store in backup database
            const storageResult = await this.storeFileProfile({
                userId,
                file,
                extractionResult,
                analysisResult,
                userConsented,
                duplicateCheck
            });

            // 7. Complete credit transaction
            await completeOperation(transaction.id, 'completed');
            console.log(`[FILE_UPLOAD] Analysis completed successfully for ${file.originalname}`);

            // 8. Return success response
            res.json({
                success: true,
                isDuplicate: false,
                message: 'File analyzed successfully',
                data: analysisResult.data,
                creditsCharged: this.analysisCredits,
                fileProfileId: storageResult.fileProfileId,
                tokensUsed: {
                    input: analysisResult.inputTokens || 0,
                    output: analysisResult.outputTokens || 0,
                    total: analysisResult.totalTokens || 0
                },
                expiresAt: storageResult.expiresAt
            });

        } catch (error) {
            console.error('[FILE_UPLOAD] Error:', error);
            
            // Rollback credit transaction if it exists
            if (transaction.id) {
                try {
                    await completeOperation(transaction.id, 'failed');
                } catch (rollbackError) {
                    console.error('[FILE_UPLOAD] Rollback failed:', rollbackError);
                }
            }

            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process file',
                creditsCharged: 0
            });
        }
    }

    // Validate incoming request
    validateRequest(req) {
        try {
            // Check if user is authenticated
            if (!req.user || !req.user.id) {
                return { success: false, error: 'Authentication required' };
            }

            // Check if file was uploaded
            if (!req.file) {
                return { success: false, error: 'No file uploaded' };
            }

            // Check consent
            const userConsented = req.body.userConsented === 'true';
            if (!userConsented) {
                return { success: false, error: 'Data retention consent required' };
            }

            // Validate file
            this.fileExtractor.validateFile(req.file);

            return {
                success: true,
                data: {
                    file: req.file,
                    userId: req.user.id,
                    userConsented
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Check for duplicate profiles
    async checkForDuplicates(userId, fileBuffer, extractedText) {
        try {
            // 1. Check file content hash first (fastest check)
            const fileHash = this.fileExtractor.createFileHash(fileBuffer);
            
            const existingFile = await backupDB.query(`
                SELECT id, data_json, created_at, expires_at 
                FROM files_target_profiles 
                WHERE user_id = $1 AND file_content_hash = $2 AND expires_at > NOW()
            `, [userId, fileHash]);

            if (existingFile.rows.length > 0) {
                const existing = existingFile.rows[0];
                return {
                    isDuplicate: true,
                    message: `This exact file was already analyzed ${this.getTimeAgo(existing.created_at)}`,
                    existingData: existing.data_json,
                    existingId: existing.id,
                    reason: 'identical_file'
                };
            }

            // 2. Quick analysis to create profile hash
            const quickAnalysis = await sendToGemini({
                html: extractedText.substring(0, 2000), // First 2000 chars for quick check
                url: 'file://duplicate-check',
                isUserProfile: false
            });

            if (quickAnalysis.success && quickAnalysis.data) {
                const profileHash = this.fileExtractor.createProfileHash(quickAnalysis.data);
                
                if (profileHash) {
                    const existingProfile = await backupDB.query(`
                        SELECT id, data_json, created_at, original_filename
                        FROM files_target_profiles 
                        WHERE user_id = $1 AND profile_data_hash = $2 AND expires_at > NOW()
                    `, [userId, profileHash]);

                    if (existingProfile.rows.length > 0) {
                        const existing = existingProfile.rows[0];
                        return {
                            isDuplicate: true,
                            message: `This person's profile was already analyzed from "${existing.original_filename}" ${this.getTimeAgo(existing.created_at)}`,
                            existingData: existing.data_json,
                            existingId: existing.id,
                            reason: 'same_person'
                        };
                    }
                }
            }

            return {
                isDuplicate: false,
                fileHash,
                profileHash: this.fileExtractor.createProfileHash(quickAnalysis.data)
            };

        } catch (error) {
            console.error('[FILE_UPLOAD] Duplicate check error:', error);
            // Continue with analysis if duplicate check fails
            return { isDuplicate: false };
        }
    }

    // Store file profile in backup database
    async storeFileProfile({ userId, file, extractionResult, analysisResult, userConsented, duplicateCheck }) {
        try {
            const result = await backupDB.query(`
                INSERT INTO files_target_profiles (
                    user_id, original_filename, file_type, linkedin_url, data_json,
                    file_content_hash, profile_data_hash, input_tokens, output_tokens,
                    total_tokens, analysis_model, user_consented, created_at, expires_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW() + INTERVAL '7 days')
                RETURNING id, created_at, expires_at
            `, [
                userId,
                file.originalname,
                file.mimetype,
                analysisResult.data.linkedin_url || null,
                JSON.stringify(analysisResult.data),
                duplicateCheck.fileHash || null,
                duplicateCheck.profileHash || null,
                analysisResult.inputTokens || 0,
                analysisResult.outputTokens || 0,
                analysisResult.totalTokens || 0,
                'gpt-5-nano',
                userConsented
            ]);

            return {
                fileProfileId: result.rows[0].id,
                createdAt: result.rows[0].created_at,
                expiresAt: result.rows[0].expires_at
            };

        } catch (error) {
            console.error('[FILE_UPLOAD] Storage error:', error);
            throw new Error('Failed to store analysis results');
        }
    }

    // Get user-friendly time ago string
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - new Date(date);
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        
        if (diffDays > 0) {
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        } else if (diffHours > 0) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else {
            return 'recently';
        }
    }

    // Get file profile by ID (for later use in message generation)
    async getFileProfile(req, res) {
        try {
            const { fileProfileId } = req.params;
            const userId = req.user.id;

            const result = await backupDB.query(`
                SELECT * FROM files_target_profiles 
                WHERE id = $1 AND user_id = $2 AND expires_at > NOW()
            `, [fileProfileId, userId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'File profile not found or expired'
                });
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            console.error('[FILE_UPLOAD] Get profile error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve file profile'
            });
        }
    }
}

module.exports = { FileUploadController };
