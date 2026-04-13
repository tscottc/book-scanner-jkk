/**
 * Firebase Cloud Functions for Book Scanner
 * Provides AI-powered book topic analysis using Google Gemini
 */

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const {GoogleGenAI} = require("@google/genai");
const admin = require("firebase-admin");

admin.initializeApp();

// ===================================
// Configuration
// ===================================
// API key will be accessed via process.env.GEMINI_API_KEY (from secrets)
let genAI = null;

// ===================================
// Constants
// ===================================
// Use gemini-2.5-flash - latest stable model with generous free tier
const MODEL_NAME = "gemini-2.5-flash";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

const ALLOWED_ORIGINS = [
  "https://book-scanner-jkk.web.app",
  "https://book-scanner-jkk.firebaseapp.com",
];

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_QUERY_LENGTH = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// ===================================
// Helper Functions
// ===================================

/**
 * Verifies Firebase ID token from Authorization header.
 * Returns the decoded token, or throws with a 401-friendly message.
 * @param {object} req - Express request object
 * @return {Promise<object>} Decoded Firebase token
 */
async function verifyAuth(req) {
  const authHeader = req.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ?
    authHeader.slice(7) : null;
  if (!token) {
    const err = new Error("Missing Authorization token");
    err.statusCode = 401;
    throw err;
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (_) {
    const err = new Error("Invalid or expired token");
    err.statusCode = 401;
    throw err;
  }
}

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
  } else if (body.title.length > MAX_TITLE_LENGTH) {
    errors.push(`Title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }

  if (!body.description ||
      typeof body.description !== "string" ||
      body.description.trim() === "") {
    errors.push("Description is required and must be a non-empty string");
  } else if (body.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
        `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    );
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
  const subjectsList = subjects.join(", ");

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
${subjectsList}

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
        genAI.models.generateContent({model: MODEL_NAME, contents: prompt}),
        timeoutPromise,
      ]);

      let subject = result.text.trim();

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
      cors: ALLOWED_ORIGINS,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: ["GEMINI_API_KEY"],
    },
    async (req, res) => {
      // Verify Firebase auth token
      try {
        await verifyAuth(req);
      } catch (err) {
        res.status(err.statusCode || 401).json({error: err.message});
        return;
      }

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
        genAI = new GoogleGenAI({apiKey});
      }

      // Log request method and origin
      logger.info(
          `Received ${req.method} request from ` +
          `${req.headers.origin || "unknown"}`,
      );

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
// Cloud Function: webSearch
// ===================================
exports.webSearch = onRequest({
  cors: ALLOWED_ORIGINS,
  timeoutSeconds: 15,
  memory: "256MiB",
  secrets: ["SERPER_API_KEY"],
}, async (req, res) => {
  try {
    await verifyAuth(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({error: err.message});
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({error: "POST only"});
    return;
  }
  const {query} = req.body;
  if (!query || typeof query !== "string" || query.trim() === "") {
    res.status(400).json({error: "query required"});
    return;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    res.status(400).json({
      error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer`,
    });
    return;
  }
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.error("SERPER_API_KEY secret not configured");
    res.status(500).json({error: "Web search service not configured"});
    return;
  }
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {"X-API-KEY": apiKey, "Content-Type": "application/json"},
      body: JSON.stringify({q: query, num: 5}),
    });
    const data = await response.json();
    const results = (data.organic || []).map((r) => ({
      title: r.title,
      snippet: r.snippet,
      link: r.link,
      displayLink: r.displayLink,
    }));
    res.status(200).json({results});
  } catch (error) {
    logger.error("Web search error:", error.message);
    res.status(500).json({error: "Web search failed", message: error.message});
  }
});

// ===================================
// Cloud Function: identifyBookCover
// ===================================
exports.identifyBookCover = onRequest(
    {
      cors: ALLOWED_ORIGINS,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: ["GEMINI_API_KEY"],
    },
    async (req, res) => {
      try {
        await verifyAuth(req);
      } catch (err) {
        res.status(err.statusCode || 401).json({error: err.message});
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        logger.error("GEMINI_API_KEY secret not configured");
        res.status(500).json({error: "AI service is not properly configured"});
        return;
      }

      if (!genAI) {
        genAI = new GoogleGenAI({apiKey});
      }

      if (req.method !== "POST") {
        res.status(405).json({error: "Only POST requests are accepted"});
        return;
      }

      const {imageBase64, mimeType} = req.body;

      if (!imageBase64 || !mimeType) {
        res.status(400).json({error: "imageBase64 and mimeType are required"});
        return;
      }

      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        const allowed = ALLOWED_MIME_TYPES.join(",");
        res.status(400).json({
          error: `Unsupported image type. Allowed: ${allowed}`,
        });
        return;
      }

      // base64 expands by ~4/3, so check approximate decoded size
      const approxBytes = (imageBase64.length * 3) / 4;
      if (approxBytes > MAX_IMAGE_BYTES) {
        res.status(400).json({error: "Image exceeds 5 MB limit"});
        return;
      }

      try {
        const prompt = `Look at this book cover image. Identify the book ` +
          `title and author name visible on the cover. Return ONLY a valid ` +
          `JSON ` +
          `object with exactly these two fields: ` +
          `{"title": "the exact title", "author": "the author name"}. ` +
          `If you cannot determine the author, use an empty string. ` +
          `Do not include any other text, markdown, or explanation.`;

        const result = await genAI.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              parts: [
                {inlineData: {mimeType, data: imageBase64}},
                {text: prompt},
              ],
            },
          ],
        });

        let text = result.text.trim();

        // Strip markdown code fences if present
        text = text.replace(/^```(?:json)?\s*/i, "");
        text = text.replace(/\s*```$/, "");

        const parsed = JSON.parse(text);

        if (!parsed.title) {
          res.status(422).json({
            error: "Could not identify book title from cover",
          });
          return;
        }

        logger.info(
            `Cover identified: "${parsed.title}" by "${parsed.author}"`,
        );
        res.status(200).json({
          title: parsed.title.trim(),
          author: (parsed.author || "").trim(),
        });
      } catch (error) {
        logger.error("Cover identification error:", error.message);
        res.status(500).json({
          error: "Failed to identify book cover",
          message: error.message,
        });
      }
    },
);
