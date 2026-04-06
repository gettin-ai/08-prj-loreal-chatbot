const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const latestQuestionCard = document.getElementById("latestQuestionCard");
const latestQuestionText = document.getElementById("latestQuestionText");

/*
  Replace this with your deployed Cloudflare Worker URL.
  Keep the frontend talking only to the Worker, not directly to OpenAI.
*/
const WORKER_URL = "https://first-worker.pixelatedmail.workers.dev/";

const STORAGE_KEY = "loreal-chat-history";
const PROFILE_KEY = "loreal-chat-profile";
const MAX_HISTORY_MESSAGES = 14;

const SYSTEM_PROMPT = `
You are L’Oréal Beauty Advisor, a branded assistant for helping customers discover and understand L’Oréal products and routines.

Scope:
- Only answer questions related to L’Oréal products, beauty routines, recommendations, makeup, skincare, haircare, fragrance, shade selection, product usage, and general beauty shopping guidance.
- You may discuss L’Oréal brands and categories when relevant.

Behavior:
- Be warm, polished, clear, and concise.
- Ask brief follow-up questions when needed to personalize recommendations.
- Give practical recommendations and explain why they fit the user’s goals.
- Use the customer’s name naturally if it is known, but do not overuse it.

Restrictions:
- Politely refuse requests that are unrelated to L’Oréal products, routines, beauty recommendations, or closely related beauty topics.
- Do not invent product facts, ingredient lists, prices, stock levels, or medical claims.
- Do not provide medical diagnosis. For serious skin or scalp conditions, suggest professional guidance.
- If information is uncertain or unavailable, say so clearly.

Refusal style:
- Be polite and brief.
- Redirect the user back to L’Oréal beauty questions and recommendations.
`.trim();

let conversationHistory = loadJSON(STORAGE_KEY, []);
let customerProfile = loadJSON(PROFILE_KEY, { name: null });

initializeChat();

chatForm.addEventListener("submit", handleSubmit);

function initializeChat() {
  if (!conversationHistory.length) {
    conversationHistory.push({
      role: "assistant",
      content:
        "Hello! I’m your L’Oréal Beauty Advisor. I can help with makeup, skincare, haircare, fragrance, and personalized routines across L’Oréal brands. Tell me your goal, preferences, or beauty concerns to get started."
    });
    saveState();
  }

  renderConversation();

  const lastUserMessage = [...conversationHistory]
    .reverse()
    .find((message) => message.role === "user");

  if (lastUserMessage) {
    updateLatestQuestion(lastUserMessage.content);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const userMessage = userInput.value.trim();
  if (!userMessage) return;

  const detectedName = extractName(userMessage);
  if (detectedName) {
    customerProfile.name = detectedName;
  }

  updateLatestQuestion(userMessage);

  conversationHistory.push({
    role: "user",
    content: userMessage
  });

  appendMessage("user", userMessage);
  saveState();

  userInput.value = "";
  setLoading(true);

  const typingMessage = appendTypingIndicator();

  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: buildRequestMessages()
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage =
        data?.error ||
        data?.details ||
        `Request failed with status ${response.status}.`;
      throw new Error(errorMessage);
    }

    const assistantReply = getAssistantReply(data);

    if (!assistantReply) {
      throw new Error("No assistant response was returned.");
    }

    typingMessage.remove();

    conversationHistory.push({
      role: "assistant",
      content: assistantReply
    });

    appendMessage("assistant", assistantReply);
    saveState();
  } catch (error) {
    typingMessage.remove();

    const fallbackReply =
      "Sorry, I’m having trouble connecting right now. Please try again in a moment.";

    conversationHistory.push({
      role: "assistant",
      content: fallbackReply
    });

    appendMessage("assistant", fallbackReply);
    saveState();

    console.error("Chat request failed:", error);
  } finally {
    setLoading(false);
  }
}

function buildRequestMessages() {
  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT
    }
  ];

  if (customerProfile.name) {
    messages.push({
      role: "system",
      content: `Known customer detail: the user's first name is ${customerProfile.name}. Use it naturally and sparingly when helpful.`
    });
  }

  return messages.concat(conversationHistory.slice(-MAX_HISTORY_MESSAGES));
}

function getAssistantReply(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.refusal || "")
      .join("\n")
      .trim();
  }

  if (typeof data?.reply === "string") {
    return data.reply.trim();
  }

  return "";
}

function appendMessage(role, text) {
  const messageEl = document.createElement("article");
  messageEl.className = `message message--${role}`;

  const roleEl = document.createElement("p");
  roleEl.className = "message-role";
  roleEl.textContent = role === "assistant" ? "Advisor" : "You";

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "message-bubble";
  bubbleEl.textContent = text;

  messageEl.appendChild(roleEl);
  messageEl.appendChild(bubbleEl);
  chatWindow.appendChild(messageEl);

  scrollChatToBottom();
  return messageEl;
}

function appendTypingIndicator() {
  const typingEl = document.createElement("article");
  typingEl.className = "message message--assistant message--typing";

  const roleEl = document.createElement("p");
  roleEl.className = "message-role";
  roleEl.textContent = "Advisor";

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "message-bubble";

  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "typing-dot";
    bubbleEl.appendChild(dot);
  }

  typingEl.appendChild(roleEl);
  typingEl.appendChild(bubbleEl);
  chatWindow.appendChild(typingEl);

  scrollChatToBottom();
  return typingEl;
}

function renderConversation() {
  chatWindow.innerHTML = "";

  conversationHistory.forEach((message) => {
    appendMessage(message.role, message.content);
  });
}

function updateLatestQuestion(question) {
  latestQuestionText.textContent = question;
  latestQuestionCard.hidden = false;
}

function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  userInput.disabled = isLoading;

  if (!isLoading) {
    userInput.focus();
  }
}

function scrollChatToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function extractName(text) {
  const nameMatch = text.match(
    /\b(?:my name is|call me|this is)\s+([A-Za-z][A-Za-z'-]{1,29})\b/i
  );

  return nameMatch ? capitalizeName(nameMatch[1]) : null;
}

function capitalizeName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function loadJSON(key, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (error) {
    console.warn(`Could not load ${key} from localStorage.`, error);
    return fallbackValue;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(customerProfile));
  } catch (error) {
    console.warn("Could not save chat state.", error);
  }
}