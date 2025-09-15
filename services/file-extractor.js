// File text extraction service for PDF, DOC, and TXT files
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const crypto = require('crypto');

class FileExtractorService {
    constructor() {
        this.supportedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/plain'
        ];
    }

    // Check if file type is supported
    isFileTypeSupported(mimeType) {
        return this.supportedTypes.includes(mimeType);
    }

    // Extract text from uploaded file buffer
    async extractTextFromFile(fileBuffer, mimeType, filename) {
        try {
            let extractedText = '';

            switch (mimeType) {
                case 'application/pdf':
                    extractedText = await this.extractFromPDF(fileBuffer);
                    break;
                
                case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                    extractedText = await this.extractFromDOCX(fileBuffer);
                    break;
                
                case 'application/msword':
                    extractedText = await this.extractFromDOC(fileBuffer);
                    break;
                
                case 'text/plain':
                    extractedText = this.extractFromTXT(fileBuffer);
                    break;
                
                default:
                    throw new Error(`Unsupported file type: ${mimeType}`);
            }

            // Clean and validate extracted text
            const cleanText = this.cleanExtractedText(extractedText);
            
            if (!cleanText || cleanText.trim().length < 50) {
                throw new Error('Insufficient text content extracted from file');
            }

            return {
                success: true,
                text: cleanText,
                originalLength: extractedText.length,
                cleanedLength: cleanText.length,
                filename: filename
            };

        } catch (error) {
            console.error('[FILE_EXTRACTOR] Error extracting text:', error);
            throw new Error(`Failed to extract text from ${filename}: ${error.message}`);
        }
    }

    // Extract text from PDF files
    async extractFromPDF(buffer) {
        try {
            const data = await pdf(buffer);
            return data.text;
        } catch (error) {
            throw new Error('Failed to extract text from PDF file');
        }
    }

    // Extract text from DOCX files
    async extractFromDOCX(buffer) {
        try {
            const result = await mammoth.extractRawText({ buffer: buffer });
            return result.value;
        } catch (error) {
            throw new Error('Failed to extract text from DOCX file');
        }
    }

    // Extract text from DOC files (legacy Word format)
    async extractFromDOC(buffer) {
        try {
            // mammoth also handles .doc files
            const result = await mammoth.extractRawText({ buffer: buffer });
            return result.value;
        } catch (error) {
            throw new Error('Failed to extract text from DOC file');
        }
    }

    // Extract text from TXT files
    extractFromTXT(buffer) {
        try {
            return buffer.toString('utf-8');
        } catch (error) {
            throw new Error('Failed to extract text from TXT file');
        }
    }

    // Clean and normalize extracted text
    cleanExtractedText(text) {
        return text
            .replace(/\r\n/g, '\n')  // Normalize line endings
            .replace(/\n{3,}/g, '\n\n')  // Remove excessive blank lines
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .trim();
    }

    // Create hash of file content for duplicate detection
    createFileHash(buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    // Create hash of profile data for duplicate detection
    createProfileHash(profileData) {
        if (!profileData) return null;
        
        const key = [
            profileData.name || '',
            profileData.current_company || '',
            profileData.current_title || ''
        ].join('|').toLowerCase();
        
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    // Validate file size and type
    validateFile(file, maxSizeMB = 10) {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        
        if (!file) {
            throw new Error('No file provided');
        }
        
        if (file.size > maxSizeBytes) {
            throw new Error(`File size exceeds ${maxSizeMB}MB limit`);
        }
        
        if (!this.isFileTypeSupported(file.mimetype)) {
            throw new Error('Unsupported file type. Please upload PDF, DOC, DOCX, or TXT files');
        }
        
        return true;
    }
}

module.exports = { FileExtractorService };
