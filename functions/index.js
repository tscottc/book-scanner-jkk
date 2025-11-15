/**
 * Firebase Cloud Functions for Book Scanner
 * Provides AI-powered book topic analysis using Google Gemini
 */

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const {GoogleGenerativeAI} = require("@google/generative-ai");

// ===================================
// Configuration
// ===================================
// API key will be accessed via process.env.GEMINI_API_KEY (from secrets)
let genAI = null;

// ===================================
// Constants
// ===================================
// Use gemini-1.5-flash - stable model with generous free tier (15 RPM, 1M TPM)
const MODEL_NAME = "gemini-1.5-flash";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

// ===================================
// Helper Functions
// ===================================

/**
 * Validates request body for required fields
 * @param {object} body - The request body to validate
 * @return {Array} Array of validation error messages
 */
function validateRequestBody(body) {
  const errors = [];

  if (!body) {
    errors.push("Request body is missing");
    return errors;
  }

  if (!body.title ||
      typeof body.title !== "string" ||
      body.title.trim() === "") {
    errors.push("Title is required and must be a non-empty string");
  }

  if (!body.description ||
      typeof body.description !== "string" ||
      body.description.trim() === "") {
    errors.push("Description is required and must be a non-empty string");
  }

  if (!body.subjects || !Array.isArray(body.subjects) ||
      body.subjects.length === 0) {
    errors.push("Subjects array is required and must be a non-empty array");
  }

  return errors;
}

/**
 * Generates AI prompt for book topic classification
 * @param {string} title - The book title
 * @param {string} description - The book description
 * @param {Array} subjects - Array of valid subjects to choose from
 * @return {string} The generated prompt for AI classification
 */
function generatePrompt(title, description, subjects) {
  // Limit subjects list in prompt to avoid token limits
  const maxSubjects = 500;
  const subjectsList = subjects.slice(0, maxSubjects).join(", ");
  const remaining = subjects.length > maxSubjects ?
    ` (and ${subjects.length - maxSubjects} more)` : "";

  return `You are a library book classification expert. Your job is to ` +
    `match books to the correct library shelf subject category.

CRITICAL INSTRUCTIONS:
1. You MUST return EXACTLY ONE subject from the provided list below
2. Return ONLY the subject name, with no additional text, punctuation, ` +
    `or explanation
3. Choose the MOST SPECIFIC subject that matches the book's content
4. If multiple subjects could apply, choose the most relevant one
5. The subject you return must EXACTLY match one from the list ` +
    `(case-sensitive)

AVAILABLE SUBJECTS:
${subjectsList}${remaining}

BOOK TO CLASSIFY:
Title: ${title}
Description: ${description}

Return ONLY the matching subject name:`;
}

/**
 * Analyzes book with retry logic
 * @param {string} title - The book title
 * @param {string} description - The book description
 * @param {Array} subjects - Array of valid subjects to choose from
 * @param {number} retries - Number of retry attempts
 * @return {Promise<string>} The classified book subject
 */
async function analyzeBookWithRetry(
    title,
    description,
    subjects,
    retries = MAX_RETRIES,
) {
  const model = genAI.getGenerativeModel({model: MODEL_NAME});
  const prompt = generatePrompt(title, description, subjects);

  // Create a Set for fast lookup
  const subjectsSet = new Set(subjects);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logger.info(
          `Attempting to analyze book ` +
          `(attempt ${attempt + 1}/${retries + 1})`,
      );

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), TIMEOUT_MS),
      );

      // Race between the API call and timeout
      const result = await Promise.race([
        model.generateContent(prompt),
        timeoutPromise,
      ]);

      const response = result.response;
      let subject = response.text().trim();

      // Clean up any extra punctuation or quotes
      subject = subject.replace(/^["']|["']$/g, "");
      subject = subject.replace(/\.$/, "");

      if (!subject) {
        throw new Error("Empty response from Gemini");
      }

      // Validate that the subject is in our list
      if (!subjectsSet.has(subject)) {
        // Try case-insensitive match
        const lowerSubject = subject.toLowerCase();
        const match = subjects.find(
            (s) => s.toLowerCase() === lowerSubject,
        );

        if (match) {
          subject = match;
        } else {
          logger.warn(
              `Gemini returned subject not in list: "${subject}". ` +
              `Retrying...`,
          );
          throw new Error("Invalid subject returned");
        }
      }

      logger.info(`Successfully analyzed book: "${subject}"`);
      return subject;
    } catch (error) {
      logger.warn(`Attempt ${attempt + 1} failed:`, error.message);

      if (attempt === retries) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const waitTime = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

// ===================================
// Cloud Function: getBookTopic
// ===================================
exports.getBookTopic = onRequest(
    {
      cors: true,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: ["GEMINI_API_KEY"],
    },
    async (req, res) => {
      // Get API key from secrets
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        logger.error("GEMINI_API_KEY secret not configured");
        res.status(500).json({
          error: "Configuration Error",
          message: "AI service is not properly configured",
        });
        return;
      }

      // Initialize genAI if not already done
      if (!genAI) {
        genAI = new GoogleGenerativeAI(apiKey);
      }

      // Log request method and origin
      logger.info(
          `Received ${req.method} request from ` +
          `${req.headers.origin || "unknown"}`,
      );

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      // Only allow POST requests
      if (req.method !== "POST") {
        logger.warn(`Method ${req.method} not allowed`);
        res.status(405).json({
          error: "Method Not Allowed",
          message: "Only POST requests are accepted",
        });
        return;
      }

      // Validate request body
      const validationErrors = validateRequestBody(req.body);
      if (validationErrors.length > 0) {
        logger.warn("Request validation failed:", validationErrors);
        res.status(400).json({
          error: "Bad Request",
          message: "Invalid request body",
          details: validationErrors,
        });
        return;
      }

      const {title, description, subjects} = req.body;

      try {
        // Analyze the book
        const subject = await analyzeBookWithRetry(
            title,
            description,
            subjects,
        );

        // Return success response
        res.status(200).json({
          subject,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Failed to analyze book:", {
          error: error.message,
          stack: error.stack,
          title: title.substring(0, 50), // Log truncated title for debugging
        });

        // Determine appropriate error response
        let statusCode = 500;
        let errorMessage = "Failed to generate book topic";

        if (error.message.includes("timeout")) {
          statusCode = 504;
          errorMessage = "AI analysis timed out";
        } else if (error.message.includes("quota") ||
                   error.message.includes("limit")) {
          statusCode = 429;
          errorMessage = "AI service rate limit exceeded";
        }

        res.status(statusCode).json({
          error: "Analysis Failed",
          message: errorMessage,
          useFallback: true, // Signal to use keyword matching fallback
        });
      }
    },
);

// ===================================
// Optional: Health Check Endpoint
// ===================================
// Removed to avoid deployment conflicts - not needed for main functionality
