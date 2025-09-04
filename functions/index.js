const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const {GoogleGenerativeAI} = require("@google/generative-ai");

// This is the new, correct way to get the key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize the AI client right after getting the key
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

exports.getBookTopic = onRequest({cors: true}, async (req, res) => {
  // Handle browser preflight request
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const {title, description} = req.body;
  if (!title || !description) {
    logger.error("Request body missing title or description.");
    res.status(400).send("Please provide a book title and description.");
    return;
  }

  try {
    const model = genAI.getGenerativeModel({model: "gemini-pro"});

    // Prompt for Gemini
    const prompt = `
Given the following book information, 
return a single, concise phrase for the best topic
or category for this book 
(e.g., "Historical Fiction", "Quantum Physics", 
"Young Adult Fantasy").
Title: ${title}
Description: ${description}
Topic:
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const topic = response.text().trim() || "Unknown Topic";

    logger.info(`Gemini topic: ${topic}`);
    res.status(200).json({topic});
  } catch (error) {
    logger.error("Gemini API error:", error);
    res.status(500).send("Failed to generate book topic.");
  }
});
