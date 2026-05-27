import commandRouter from "./command-router.js";

const CHAT_REGISTRY_KEY = "known_chats";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return commandRouter.fetch(request, env, ctx);

    const cloned = request.clone();
    let update;

    try {
      update = await cloned.json();
    } catch {
      return commandRouter.fetch(request, env, ctx);
    }

    const message = update.message || update.edited_message;

    if (message?.chat?.id && env.BOT_CHATS) {
      ctx?.waitUntil?.(rememberChat(env, message.chat));
    }

    if (!message?.text) return commandRouter.fetch(request, env, ctx);

    const text = message.text.trim();
    const lower = text.toLowerCase();
    const chatId = message.chat.id;
    const threadId = message.message_thread_id;
    const userId = String(message.from?.id || "");

    if (isCommand(lower, ["/myid", "/мојид"])) {
      return sendMessage(chatId, `Твој Telegram User ID је: <code>${escapeHtml(userId || "непознат")}</code>`, threadId);
    }

    if (isCommand(lower, ["/broadcast", "/објава"])) {
      if (!env.OWNER_USER_ID) {
        return sendMessage(chatId, "⚠️ OWNER_USER_ID није подешен у Cloudflare variables. Укуцај /myid, па тај број стави као OWNER_USER_ID.", threadId);
      }

      if (userId !== String(env.OWNER_USER_ID)) {
        return sendMessage(chatId, "⛔ Немаш дозволу за broadcast.", threadId);
      }

      if (!env.BOT_CHATS) {
        return sendMessage(chatId, "⚠️ BOT_CHATS KV binding није подешен. Додај KV namespace са variable name BOT_CHATS.", threadId);
      }

      const body = text.replace(/^\/\S+\s*/u, "").trim();
      if (!body) {
        return sendMessage(chatId, "☦️ Употреба:\n<code>/broadcast порука коју шаљем свим сачуваним групама/чатовима</code>", threadId);
      }

      const result = await broadcastToKnownChats(env, body);
      return sendMessage(chatId, `✅ Broadcast завршен.\n\nПослато: ${result.sent}\nНије успело: ${result.failed}\nУкупно познатих chat-ова: ${result.total}`, threadId);
    }

    return commandRouter.fetch(request, env, ctx);
  }
};

function isCommand(text, commands) {
  return commands.some((command) => text === command || text.startsWith(command + " ") || text.startsWith(command + "@"));
}

async function rememberChat(env, chat) {
  try {
    const raw = await env.BOT_CHATS.get(CHAT_REGISTRY_KEY);
    const chats = raw ? JSON.parse(raw) : [];
    const chatId = String(chat.id);

    const existing = chats.find((item) => String(item.id) === chatId);
    const saved = {
      id: chat.id,
      type: chat.type || "unknown",
      title: chat.title || chat.username || chat.first_name || "unknown",
      updatedAt: new Date().toISOString()
    };

    const next = existing
      ? chats.map((item) => String(item.id) === chatId ? { ...item, ...saved } : item)
      : [...chats, saved];

    await env.BOT_CHATS.put(CHAT_REGISTRY_KEY, JSON.stringify(next.slice(-500)));
  } catch (error) {
    console.log("rememberChat failed", error?.message || error);
  }
}

async function broadcastToKnownChats(env, text) {
  const raw = await env.BOT_CHATS.get(CHAT_REGISTRY_KEY);
  const chats = raw ? JSON.parse(raw) : [];

  let sent = 0;
  let failed = 0;

  for (const chat of chats) {
    const result = await telegramApi(env, "sendMessage", {
      chat_id: chat.id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    if (result.ok) sent += 1;
    else failed += 1;
  }

  return { sent, failed, total: chats.length };
}

async function telegramApi(env, method, body) {
  if (!env.BOT_TOKEN) return { ok: false, description: "BOT_TOKEN није подешен." };

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await response.json();
  } catch (error) {
    return { ok: false, description: error?.message || "Telegram request није успео." };
  }
}

function sendMessage(chatId, text, threadId) {
  const payload = { method: "sendMessage", chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (threadId !== undefined && threadId !== null) payload.message_thread_id = threadId;
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
