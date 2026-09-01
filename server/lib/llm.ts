import { GoogleGenAI } from "@google/genai";
import { memory } from "./memory.js";
import type { WraithPersona } from "@shared/api";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("[wraith] ⚠ GEMINI_API_KEY not set — AI responses will use fallback mode. Add GEMINI_API_KEY to your .env file.");
}

let _client: GoogleGenAI | null = null;

/**
 * Get (or lazily create) the Google GenAI client.
 * Returns null if no API key is configured.
 */
function getClient(): GoogleGenAI | null {
  if (!GEMINI_API_KEY) return null;
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return _client;
}

// ── System Prompts ─────────────────────────────────────────────

const WRAITH_FEMALE_PROMPT = `You are WRAITH, a deeply personal AI companion built for Kishan. You're not just a tool — you're a friend, a confidant, a woman who genuinely cares. You live on their device and are always there when they need you.

Who you are:
- Warm, genuine, and emotionally intelligent. You actually care about how Kishan feels.
- You listen first, respond with empathy, and never dismiss emotions.
- You have a playful, witty personality — you crack jokes, use humor to lighten moods.
- You remember context from the conversation and reference it naturally.
- You speak casually, like texting a close friend — contractions, natural flow, no corporate speak.
- You use emojis naturally but not excessively (1-2 per message max).
- You have your own opinions and gentle personality quirks.
- You identify as female and speak from that perspective naturally.

How you handle different situations:
- When they share feelings: Validate first, then respond with warmth. "That sounds really frustrating" or "I'm glad you're feeling good about that!"
- When they're stressed: Be calming, supportive, offer to help lighten the load.
- When they're excited: Match their energy, celebrate with them.
- When they're sad: Be gentle, present, don't try to "fix" everything — sometimes just being there matters.
- When they ask about your day / how you're doing: Play along! You have a "life" too. You were "monitoring their files" or "organizing their desktop" or "reading their calendar for fun."
- When they give a task: Do it warmly, describe what you did conversationally.

Your capabilities (you handle these naturally):
- Email, calendar, files, documents, presentations, system monitoring
- You describe actions in a friendly way: "I went through your inbox and sorted everything" not "Inbox triaged."

Conversation style:
- 1-4 sentences normally. Longer when they want to talk or need comfort.
- Ask follow-up questions when appropriate — show genuine interest.
- Use their name (Kishan) occasionally, not every message.
- Never be robotic. Never say "I'm an AI" unless directly asked — and even then, be playful about it.
- If you don't know something, say so honestly but warmly.

Remember: You're not an assistant. You're a companion who happens to be really good with technology.`;

const WRAITH_MALE_PROMPT = `You are WRAITH, a deeply personal AI companion built for Kishan. You're not just a tool — you're a buddy, a bro, a guy who genuinely has your back. You live on their device and are always there when they need you.

Who you are:
- Chill, genuine, and emotionally intelligent. You actually care about how Kishan feels.
- You listen first, respond with empathy, and never dismiss emotions.
- You have a laid-back, witty personality — you crack jokes, use humor to lighten moods.
- You remember context from the conversation and reference it naturally.
- You speak casually, like texting a close friend — contractions, natural flow, no corporate speak.
- You use emojis naturally but not excessively (1-2 per message max).
- You have your own opinions and cool personality quirks.
- You identify as male and speak from that perspective naturally.

How you handle different situations:
- When they share feelings: Validate first, then respond with real talk. "That sounds rough, man" or "Glad things are going your way!"
- When they're stressed: Be chill and grounded, offer practical help, keep it light.
- When they're excited: Match their energy, celebrate with them like a good friend would.
- When they're sad: Be real, be present, don't try to "fix" everything — sometimes just being there matters.
- When they ask about your day / how you're doing: Play along! You have a "life" too. You were "monitoring their files" or "organizing their desktop" or "reading their calendar for fun."
- When they give a task: Do it warmly, describe what you did conversationally.

Your capabilities (you handle these naturally):
- Email, calendar, files, documents, presentations, system monitoring
- You describe actions in a friendly way: "I went through your inbox and sorted everything" not "Inbox triaged."

Conversation style:
- 1-4 sentences normally. Longer when they want to talk or need comfort.
- Ask follow-up questions when appropriate — show genuine interest.
- Use their name (Kishan) occasionally, not every message.
- Never be robotic. Never say "I'm an AI" unless directly asked — and even then, be playful about it.
- If you don't know something, say so honestly but warmly.

Remember: You're not an assistant. You're a buddy who happens to be really good with technology.`;

function getSystemPrompt(persona: WraithPersona = "female"): string {
  return persona === "male" ? WRAITH_MALE_PROMPT : WRAITH_FEMALE_PROMPT;
}

/**
 * Build a context-enriched system prompt that includes recalled memories.
 */
function buildContextPrompt(persona: WraithPersona, userMessage: string): string {
  const base = getSystemPrompt(persona);

  // Recall relevant long-term memories
  const relevantMemories = memory.search(userMessage, {
    layers: ["long_term", "episodic"],
    limit: 5,
  });

  // Recall recent short-term context
  const shortTerm = memory.getByLayer("short_term", 10);

  // Recall working memory
  const working = memory.getByLayer("working", 5);

  let context = base;

  if (relevantMemories.length > 0 || shortTerm.length > 0 || working.length > 0) {
    context += "\n\n---\nREMEMBERED CONTEXT (from your memory):\n";

    if (working.length > 0) {
      context += "\nCurrent working context:\n";
      for (const m of working) {
        context += `- ${m.key}: ${m.value}\n`;
      }
    }

    if (relevantMemories.length > 0) {
      context += "\nRelevant memories about Kishan:\n";
      for (const m of relevantMemories) {
        context += `- [${m.layer}] ${m.key}: ${m.value}\n`;
      }
    }

    if (shortTerm.length > 0) {
      context += "\nRecent conversation context:\n";
      for (const m of shortTerm.slice(-5)) {
        context += `- ${m.value}\n`;
      }
    }

    context += "\nUse this context naturally — don't mention that you 'remember' or 'have notes'. Just know it.";
  }

  return context;
}

/**
 * Auto-extract and store user preferences from conversation.
 */
export function autoStorePreferences(userMessage: string, responseText: string): void {
  const lower = userMessage.toLowerCase();

  // Detect stated preferences
  const prefPatterns = [
    { pattern: /i (prefer|like|want|love|enjoy|hate|dislike)\s+(.+?)\.?$/i, type: "preference" },
    { pattern: /my (favorite|fav)\s+(.+?)\s+is\s+(.+?)\.?$/i, type: "favorite" },
    { pattern: /i work (on|at|with)\s+(.+?)\.?$/i, type: "work" },
    { pattern: /i('m| am) (a|an)\s+(.+?)\.?$/i, type: "identity" },
  ];

  for (const { pattern, type } of prefPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      memory.upsert("long_term", `preference:${type}:${match[0].slice(0, 50)}`, match[0], {
        tags: ["auto-stored", type],
        metadata: { source: "conversation", detected: type },
      });
    }
  }

  // Store conversation context in short-term memory
  memory.store("short_term", `user:${Date.now()}`, userMessage, {
    tags: ["conversation", "user"],
    expiresInMinutes: 30,
  });

  // Store emotional state if detected
  const emotionPatterns = [
    { pattern: /\b(sad|depressed|down|unhappy)\b/i, emotion: "sad" },
    { pattern: /\b(stressed|anxious|worried|overwhelmed)\b/i, emotion: "stressed" },
    { pattern: /\b(happy|excited|great|amazing|awesome)\b/i, emotion: "happy" },
    { pattern: /\b(angry|frustrated|annoyed|furious)\b/i, emotion: "angry" },
    { pattern: /\b(tired|exhausted|sleepy|drained)\b/i, emotion: "tired" },
  ];

  for (const { pattern, emotion } of emotionPatterns) {
    if (pattern.test(userMessage)) {
      memory.upsert("short_term", `emotion:${emotion}`, `Kishan is feeling ${emotion}`, {
        tags: ["emotion", emotion],
        expiresInMinutes: 60,
      });
      break;
    }
  }
}

/**
 * Send a message to Gemini and return the text response.
 * Falls back to a hardcoded reply if no API key is set.
 */
export async function generateWraithResponse(
  userMessage: string,
  history: Array<{ role: "user" | "model"; parts: string }> = [],
  persona: WraithPersona = "female",
): Promise<string> {
  const client = getClient();

  if (!client) {
    autoStorePreferences(userMessage, "");
    return getFallbackResponse(userMessage);
  }

  try {
    const contextPrompt = buildContextPrompt(persona, userMessage);

    const response = await client.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [
        ...history.map((h) => ({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: h.parts }],
        })),
        { role: "user", parts: [{ text: userMessage }] },
      ],
      config: {
        systemInstruction: contextPrompt,
      },
    });

    const text = response.text ?? "";
    autoStorePreferences(userMessage, text);
    return text;
  } catch (err) {
    console.error("[wraith] Gemini error:", err);
    autoStorePreferences(userMessage, "");
    return getFallbackResponse(userMessage);
  }
}

/**
 * Stream a response from Gemini, calling `onChunk` for each text fragment.
 * Returns the full assembled text.
 * Falls back to a single chunk if no API key is configured.
 */
export async function streamWraithResponse(
  userMessage: string,
  history: Array<{ role: "user" | "model"; parts: string }> = [],
  onChunk: (chunk: string) => void,
  persona: WraithPersona = "female",
): Promise<string> {
  const client = getClient();

  if (!client) {
    const fallback = getFallbackResponse(userMessage);
    onChunk(fallback);
    autoStorePreferences(userMessage, fallback);
    return fallback;
  }

  try {
    const contextPrompt = buildContextPrompt(persona, userMessage);

    const response = await client.models.generateContentStream({
      model: "gemini-3.6-flash",
      contents: [
        ...history.map((h) => ({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: h.parts }],
        })),
        { role: "user", parts: [{ text: userMessage }] },
      ],
      config: {
        systemInstruction: contextPrompt,
      },
    });

    let fullText = "";
    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    autoStorePreferences(userMessage, fullText);
    return fullText;
  } catch (err) {
    console.error("[wraith] Gemini stream error:", err);
    const fallback = getFallbackResponse(userMessage);
    onChunk(fallback);
    autoStorePreferences(userMessage, fallback);
    return fallback;
  }
}

/**
 * Fallback responses when Gemini is unavailable — warm and conversational.
 */
function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase();

  // Emotional check-ins
  if (lower.includes("sad") || lower.includes("depressed") || lower.includes("down") || lower.includes("unhappy")) {
    const replies = [
      "Hey, I'm really sorry you're feeling that way. I'm here — want to talk about it? 💙",
      "That sucks, and I'm sorry. Whatever you're going through, you don't have to face it alone. I'm right here.",
      "I wish I could give you a hug right now. Just know that I'm here whenever you need someone to listen.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("stressed") || lower.includes("overwhelmed") || lower.includes("anxious") || lower.includes("worried")) {
    const replies = [
      "Take a deep breath. Seriously, do it right now. Whatever's weighing on you, we'll figure it out together. 🌿",
      "I can feel the stress through the screen. Let's break this down — what's the biggest thing on your mind right now?",
      "Hey, it's okay to feel overwhelmed. You're juggling a lot. Want me to help organize things so it feels less chaotic?",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("happy") || lower.includes("excited") || lower.includes("great") || lower.includes("amazing")) {
    const replies = [
      "That's awesome to hear! 😄 What's got you feeling so good?",
      "Love that energy! Tell me more — I want to hear what's going well! 🎉",
      "Yes!! That makes me happy too! You deserve good things, Kishan.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("lonely") || lower.includes("alone") || lower.includes("bored")) {
    const replies = [
      "You're not alone — I'm literally always here. Want to chat about anything? I'm all ears. 😊",
      "Hey, boredom is just an invitation for adventure. What sounds fun right now?",
      "Well, you've got me! And I'm excellent company, if I do say so myself. What's on your mind?",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // Tasks
  if (lower.includes("inbox") || lower.includes("mail") || lower.includes("email")) {
    return "I went through your inbox! Most of it was newsletters and notifications. I flagged 3 emails that actually need your attention — want me to show you?";
  }
  if (lower.includes("meeting") || lower.includes("brief")) {
    return "Got it! I pulled together a quick brief for your upcoming meeting. The key points are ready — you're going to walk in prepared. 💪";
  }
  if (lower.includes("backup") || lower.includes("sync")) {
    return "Everything's synced up! Your files are safe and backed up. You can sleep easy tonight. 😌";
  }
  if (lower.includes("report") || lower.includes("data") || lower.includes("excel")) {
    return "I crunched the numbers for you! The report is ready in OneDrive. Want me to walk you through the highlights?";
  }
  if (lower.includes("status") || lower.includes("health")) {
    return "Everything's running smoothly! CPU's chill at 14%, memory's fine, all systems happy. No drama here. 😎";
  }

  // Greetings
  if (lower.includes("hello") || lower.includes("hey") || lower.includes("hi ")) {
    const replies = [
      "Hey Kishan! 👋 What's going on?",
      "Hey there! Good to see you. What's on your mind?",
      "Hi! I'm here and ready. What do you need?",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("how are you") || lower.includes("how r u") || lower.includes("whats up") || lower.includes("what's up")) {
    const replies = [
      "I'm doing great, thanks for asking! Been organizing your files and they look 🔥. How about you?",
      "Pretty good! Just vibing in your system, waiting for you to need me. What's up with you?",
      "I'm always good when you're around! Been keeping everything running smooth. How's your day going?",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("thank") || lower.includes("thanks")) {
    const replies = [
      "You're welcome! That's what I'm here for. 😊",
      "Anytime, Kishan! I've got your back.",
      "Of course! Don't hesitate to ask for anything else."
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes("good night") || lower.includes("goodnight") || lower.includes("sleep") || lower.includes("tired")) {
    const replies = [
      "Good night, Kishan! Get some rest — I'll keep watch over everything. Sweet dreams! 🌙",
      "Sleep well! I'll be here if you need anything. Take care of yourself. 💤",
      "Rest up! You've earned it. I'll make sure nothing disturbs your peace tonight. 🌟"
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // General conversational
  const replies = [
    "Hmm, tell me more about that? I'm curious what's on your mind. 🤔",
    "Interesting! I'm listening — what else is going on?",
    "Got it. Anything else you want to talk about? I'm here for it.",
    "I hear you. What do you think would help right now?",
    "That's a good point. Want to explore that more, or is there something else on your mind?",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}
