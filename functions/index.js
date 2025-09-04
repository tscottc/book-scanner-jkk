// functions/index.js (Simplified Version without Gemini API)

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

exports.getBookTopic = onRequest({cors: true}, async (req, res) => {
  // Handle the browser's security preflight request
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Reject any request that isn't a POST
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
    // Simple keyword-based topic classification
    const topic = classifyBookTopic(title, description);

    logger.info(`Successfully generated topic: ${topic}`);
    res.status(200).json({topic: topic});
  } catch (error) {
    logger.error("Error generating topic:", error);
    res.status(500).send("Failed to generate book topic.");
  }
});

// eslint-disable-next-line require-jsdoc, max-len
function classifyBookTopic(title, description) {
  // eslint-disable-next-line max-len
  const text = `${title} ${description}`.toLowerCase();

  // US History & Politics (higher priority than general history)
  // eslint-disable-next-line max-len
  if (text.includes("constitution") || text.includes("founding fathers") || text.includes("declaration of independence")) {
    return "US Constitutional History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("prohibition") || text.includes("18th amendment") || text.includes("temperance")) {
    return "Prohibition Era History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("civil war") || text.includes("confederate") || text.includes("union") || text.includes("antietam") || text.includes("gettysburg")) {
    return "Civil War History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("world war") || text.includes("wwii") || text.includes("ww2") || text.includes("nazi") || text.includes("holocaust")) {
    return "World War II History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("american revolution") || text.includes("revolutionary war") || text.includes("george washington")) {
    return "American Revolutionary History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("great depression") || text.includes("new deal") || text.includes("fdr")) {
    return "Great Depression Era History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("cold war") || text.includes("soviet union") || text.includes("communism")) {
    return "Cold War History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("civil rights") || text.includes("martin luther king") || text.includes("segregation")) {
    return "Civil Rights Movement History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("president") || text.includes("presidency") || text.includes("white house") || text.includes("political")) {
    return "US Political History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("ancient") || text.includes("rome") || text.includes("greek") || text.includes("egypt") || text.includes("pharaoh")) {
    return "Ancient History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("medieval") || text.includes("middle ages") || text.includes("crusades")) {
    return "Medieval History";
  }
  // eslint-disable-next-line max-len
  if (text.includes("history") || text.includes("historical")) {
    return "General History";
  }

  // Science Fiction categories
  // eslint-disable-next-line max-len
  if (text.includes("cyberpunk") || text.includes("dystopian") || text.includes("post-apocalyptic")) {
    return "Cyberpunk Dystopian Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("space") || text.includes("galaxy") || text.includes("planet") || text.includes("alien") || text.includes("spaceship")) {
    return "Space Science Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("time travel") || text.includes("time machine")) {
    return "Time Travel Science Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("sci-fi") || text.includes("science fiction")) {
    return "General Science Fiction";
  }

  // Fantasy categories
  // eslint-disable-next-line max-len
  if (text.includes("dragon") || text.includes("magic") || text.includes("wizard") || text.includes("fantasy")) {
    return "Fantasy Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("vampire") || text.includes("werewolf") || text.includes("supernatural")) {
    return "Supernatural Fantasy";
  }

  // Mystery/Thriller categories
  // eslint-disable-next-line max-len
  if (text.includes("murder") || text.includes("crime") || text.includes("detective") || text.includes("mystery")) {
    return "Mystery & Crime Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("thriller") || text.includes("suspense")) {
    return "Thriller & Suspense";
  }

  // Romance categories
  // eslint-disable-next-line max-len
  if (text.includes("romance") || text.includes("love story")) {
    return "Romance Fiction";
  }

  // Non-fiction categories
  // eslint-disable-next-line max-len
  if (text.includes("cookbook") || text.includes("recipe") || text.includes("cooking") || text.includes("culinary")) {
    return "Cooking & Culinary Arts";
  }
  // eslint-disable-next-line max-len
  if (text.includes("business") || text.includes("management") || text.includes("leadership") || text.includes("entrepreneur")) {
    return "Business & Management";
  }
  // eslint-disable-next-line max-len
  if (text.includes("psychology") || text.includes("mental health") || text.includes("therapy")) {
    return "Psychology & Mental Health";
  }
  // eslint-disable-next-line max-len
  if (text.includes("science") || text.includes("physics") || text.includes("chemistry") || text.includes("biology") || text.includes("technology")) {
    return "Science & Technology";
  }
  // eslint-disable-next-line max-len
  if (text.includes("philosophy") || text.includes("ethics") || text.includes("moral")) {
    return "Philosophy & Ethics";
  }
  // eslint-disable-next-line max-len
  if (text.includes("religion") || text.includes("spiritual") || text.includes("faith") || text.includes("bible")) {
    return "Religion & Spirituality";
  }
  // eslint-disable-next-line max-len
  if (text.includes("self-help") || text.includes("personal development") || text.includes("motivation")) {
    return "Self-Help & Personal Development";
  }
  // eslint-disable-next-line max-len
  if (text.includes("travel") || text.includes("geography") || text.includes("destination")) {
    return "Travel & Geography";
  }
  // eslint-disable-next-line max-len
  if (text.includes("art") || text.includes("painting") || text.includes("music") || text.includes("creative")) {
    return "Art & Creative Arts";
  }
  // eslint-disable-next-line max-len
  if (text.includes("biography") || text.includes("autobiography") || text.includes("memoir")) {
    return "Biography & Memoir";
  }
  // eslint-disable-next-line max-len
  if (text.includes("poetry") || text.includes("poem")) {
    return "Poetry & Literature";
  }
  // eslint-disable-next-line max-len
  if (text.includes("children") || text.includes("kids") || text.includes("young adult")) {
    return "Children's & Young Adult Literature";
  }

  // Default categories based on common words
  // eslint-disable-next-line max-len
  if (text.includes("fiction") || text.includes("novel")) {
    return "General Fiction";
  }
  // eslint-disable-next-line max-len
  if (text.includes("non-fiction") || text.includes("nonfiction")) {
    return "General Non-Fiction";
  }

  // Fallback
  return "General Literature";
}
