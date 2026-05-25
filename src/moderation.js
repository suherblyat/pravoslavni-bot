export async function handleModeration({ message, env, chatId, threadId, sendGroupMessage }) {
  if (!message) return null;

  if (message.new_chat_members && env.MOD_STATE) {
    for (const member of message.new_chat_members) {
      if (!member?.id || member.is_bot) continue;
      await env.MOD_STATE.delete(warnKey(chatId, member.id));
      await sendAdminNotice({
        env,
        message: { ...message, from: member },
        chatId,
        originalText: "Корисник је ушао у групу. Опомене су ресетоване.",
        title: "Reset опомена",
        severity: "LOW",
        reason: "Корисник је поново ушао у групу.",
        recommendation: "Број опомена је обрисан за овог корисника.",
        warningCount: null,
        moderationAction: "reset_warnings"
      });
    }
    return null;
  }

  if (!message.text) return null;
  if (message.from?.is_bot) return null;

  const originalText = message.text.trim();
  const commandText = originalText.toLowerCase().trim();

  if (isCommand(commandText, ["/admintest", "/админтест"])) {
    const result = await sendAdminRaw(env, "✅ Admin test из Worker-а ради. Ако видиш ово, ADMIN_CHAT_ID и BOT_TOKEN су runtime исправни.");
    return sendGroupMessage(chatId, formatAdminTestResult(env, result, threadId), threadId);
  }

  if (isCommand(commandText)) return null;

  const text = normalizeText(originalText);

  const obvious = getObviousViolation(text, env);
  if (obvious) {
    const memberStatus = await getMemberStatus({ env, chatId, userId: message.from.id });
    const isPrivileged = memberStatus === "creator" || memberStatus === "administrator";

    if (isPrivileged) {
      await sendAdminNotice({
        env,
        message,
        chatId,
        originalText,
        title: "Опомена админа/власника",
        severity: "MEDIUM",
        reason: obvious,
        recommendation: "Корисник је admin/owner. Бот не броји казне и не покушава mute/ban.",
        warningCount: null,
        moderationAction: "admin_exempt"
      });
      return sendGroupMessage(chatId, formatPublicWarning(obvious, null), threadId);
    }

    const action = await registerWarning({ env, message, chatId, reason: obvious, originalText });

    await sendAdminNotice({
      env,
      message,
      chatId,
      originalText,
      title: action.title,
      severity: action.severity,
      reason: obvious,
      recommendation: action.recommendation,
      warningCount: action.warningCount,
      moderationAction: action.action
    });

    if (action.action === "mute") {
      const result = await muteUser({ env, chatId, userId: message.from.id, minutes: 10 });
      await sendAdminNotice({
        env,
        message,
        chatId,
        originalText,
        title: result.ok ? "Mute извршен" : "Mute није успео",
        severity: result.ok ? "HIGH" : "ERROR",
        reason: result.ok ? "Корисник је ућуткан на 10 минута." : result.description,
        recommendation: result.ok ? "Прати да ли наставља после mute-а." : "Провери да ли је бот admin и има Restrict members дозволу.",
        warningCount: action.warningCount,
        moderationAction: "mute_result"
      });
      return sendGroupMessage(chatId, result.ok ? formatMuteWarning(obvious, action.warningCount) : formatPublicWarning(obvious, action.warningCount), threadId);
    }

    if (action.action === "ban") {
      const result = await banUser({ env, chatId, userId: message.from.id });
      await sendAdminNotice({
        env,
        message,
        chatId,
        originalText,
        title: result.ok ? "Ban извршен" : "Ban није успео",
        severity: result.ok ? "CRITICAL" : "ERROR",
        reason: result.ok ? "Корисник је уклоњен из групе." : result.description,
        recommendation: result.ok ? "Провери да ли треба очистити поруке ручно." : "Провери да ли је бот admin и има Ban users дозволу. Бот не може да банује owner/admin-а.",
        warningCount: action.warningCount,
        moderationAction: "ban_result"
      });
      return sendGroupMessage(chatId, result.ok ? formatBanWarning(obvious, action.warningCount) : formatPublicWarning(obvious, action.warningCount), threadId);
    }

    return sendGroupMessage(chatId, formatPublicWarning(obvious, action.warningCount), threadId);
  }

  const risk = calculateRisk(text, message, env);
  if (risk.score < 4) return null;

  const aiResult = await analyzeWithAI({ text: originalText, risk, message, env });
  if (aiResult.decision !== "OK") {
    await sendAdminNotice({
      env,
      message,
      chatId,
      originalText,
      title: "AI модерација",
      severity: aiResult.severity || "MEDIUM",
      reason: aiResult.reason || risk.reasons.join(", "),
      recommendation: aiResult.recommendation || "Провери ручно.",
      risk
    });
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/š/g, "s").replace(/č/g, "c").replace(/ć/g, "c").replace(/ž/g, "z").replace(/đ/g, "dj")
    .replace(/ђ/g, "дј")
    .replace(/[0]/g, "o").replace(/[1!]/g, "i").replace(/[3]/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s").replace(/[7]/g, "t")
    .replace(/[?.:,;()\[\]{}"'`´“”‘’_+=*~|\\/<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCommand(text, commands = null) {
  if (!text.startsWith("/")) return false;
  if (!commands) return true;
  return commands.some((command) => text === command || text.startsWith(command + "@") || text.startsWith(command + " "));
}

function getObviousViolation(text, env = {}) {
  if (hasProfanity(text, HARD_PROFANITY) || hasProfanity(text, getEnvList(env.EXTRA_HARD_TERMS))) return "псовка / простачки речник";
  if (hasPhraseOrWordPrefix(text, HARD_INSULTS) || hasPhraseOrWordPrefix(text, getEnvList(env.EXTRA_HARD_INSULTS))) return "лична увреда";
  if (hasPhraseOrWordPrefix(text, HARD_VULGARITY)) return "вулгаран или саблажњив говор";
  if (hasSpamLink(text)) return "спам линк";
  if (isCapsSpam(text)) return "caps spam";
  if (hasDirectBlasphemy(text)) return "ругање светињама";
  return null;
}

function hasProfanity(text, terms) {
  const words = text.split(/\s+/).filter(Boolean);

  return terms.some((term) => {
    const cleanTerm = normalizeText(term);
    if (!cleanTerm) return false;

    if (cleanTerm.includes(" ")) {
      return text.includes(cleanTerm);
    }

    return words.some((word) => word === cleanTerm || word.startsWith(cleanTerm));
  });
}

function hasPhraseOrWordPrefix(text, terms) {
  const words = text.split(/\s+/).filter(Boolean);

  return terms.some((term) => {
    const cleanTerm = normalizeText(term);
    if (!cleanTerm) return false;

    if (cleanTerm.includes(" ")) {
      return text.includes(cleanTerm);
    }

    return words.some((word) => word === cleanTerm || word.startsWith(cleanTerm));
  });
}

async function registerWarning({ env, message, chatId, reason, originalText }) {
  const userId = message.from?.id;
  if (!env.MOD_STATE || !userId) return { warningCount: null, action: "warn", title: "Јавна опомена", severity: "HIGH", recommendation: "Нема MOD_STATE binding-а, казне се не памте." };

  const key = warnKey(chatId, userId);
  const existing = await env.MOD_STATE.get(key, "json");
  const warningCount = Number(existing?.count || 0) + 1;

  await env.MOD_STATE.put(key, JSON.stringify({
    count: warningCount,
    lastReason: reason,
    lastMessage: originalText.slice(0, 500),
    updatedAt: new Date().toISOString()
  }), { expirationTtl: 60 * 60 * 24 * 30 });

  if (warningCount >= 5) return { warningCount, action: "ban", title: "Бан после више опомена", severity: "CRITICAL", recommendation: "Корисник је достигао 5 опомена. Бот покушава ban/kick." };
  if (warningCount >= 3) return { warningCount, action: "mute", title: "Mute после 3 опомене", severity: "HIGH", recommendation: "Корисник је достигао 3 опомене. Бот покушава mute на 10 минута." };
  return { warningCount, action: "warn", title: "Јавна опомена", severity: "HIGH", recommendation: "Бот је јавно опоменуо корисника без AI анализе, јер је прекршај очигледан." };
}

function warnKey(chatId, userId) {
  return `warn:${chatId}:${userId}`;
}

async function getMemberStatus({ env, chatId, userId }) {
  if (!env.BOT_TOKEN || !userId) return "unknown";
  const result = await telegramApi(env, "getChatMember", { chat_id: chatId, user_id: userId });
  return result?.result?.status || "unknown";
}

async function muteUser({ env, chatId, userId, minutes }) {
  if (!env.BOT_TOKEN) return { ok: false, description: "BOT_TOKEN није подешен у runtime env." };
  const untilDate = Math.floor(Date.now() / 1000) + minutes * 60;
  return telegramApi(env, "restrictChatMember", {
    chat_id: chatId,
    user_id: userId,
    until_date: untilDate,
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false
    }
  });
}

async function banUser({ env, chatId, userId }) {
  if (!env.BOT_TOKEN) return { ok: false, description: "BOT_TOKEN није подешен у runtime env." };
  return telegramApi(env, "banChatMember", { chat_id: chatId, user_id: userId, revoke_messages: false });
}

async function sendAdminNotice({ env, message, chatId, originalText, title, severity, reason, recommendation, risk, warningCount, moderationAction }) {
  if (!env.BOT_TOKEN || !env.ADMIN_CHAT_ID) return { ok: false, description: "BOT_TOKEN или ADMIN_CHAT_ID није подешен у runtime env." };

  const user = message.from?.username ? `@${message.from.username}` : `${message.from?.first_name || "Непознат"} ${message.from?.last_name || ""}`.trim();
  const riskLine = risk ? `<b>Локални ризик:</b> ${escapeHtml(risk.score)}\n<b>Локални разлози:</b> ${escapeHtml(risk.reasons.join(", ") || "нема")}\n` : "";
  const countLine = warningCount !== undefined && warningCount !== null ? `<b>Број опомена:</b> ${escapeHtml(warningCount)}\n` : "";
  const actionLine = moderationAction ? `<b>Акција:</b> ${escapeHtml(moderationAction)}\n` : "";

  const report = `⚠️ <b>${escapeHtml(title)}</b>\n\n` +
    `<b>Корисник:</b> ${escapeHtml(user)}\n` +
    `<b>User ID:</b> ${escapeHtml(message.from?.id || "?")}\n` +
    `<b>Chat ID:</b> ${escapeHtml(chatId)}\n` +
    `<b>Ниво:</b> ${escapeHtml(severity || "MEDIUM")}\n` +
    countLine + actionLine + riskLine +
    `<b>Разлог:</b> ${escapeHtml(reason || "-")}\n` +
    `<b>Предлог:</b> ${escapeHtml(recommendation || "Провери ручно.")}\n\n` +
    `<b>Порука:</b>\n${escapeHtml(originalText.slice(0, 3000))}`;

  return sendAdminRaw(env, report);
}

async function sendAdminRaw(env, text) {
  if (!env.BOT_TOKEN || !env.ADMIN_CHAT_ID) {
    return { ok: false, description: "BOT_TOKEN или ADMIN_CHAT_ID није подешен у runtime env." };
  }

  const payload = {
    chat_id: env.ADMIN_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (env.ADMIN_THREAD_ID) {
    payload.message_thread_id = Number(env.ADMIN_THREAD_ID);
  }

  return telegramApi(env, "sendMessage", payload);
}
async function telegramApi(env, method, body) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    return data || { ok: false, description: `Telegram API није вратио JSON. HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, description: error?.message || "Telegram API request није успео." };
  }
}

function formatAdminTestResult(env, result, currentThreadId = null) {
  return `🧪 <b>Admin test</b>\n\n` +
    `<b>BOT_TOKEN:</b> ${env.BOT_TOKEN ? "постоји" : "НЕ ПОСТОЈИ"}\n` +
    `<b>ADMIN_CHAT_ID:</b> ${escapeHtml(env.ADMIN_CHAT_ID || "НЕ ПОСТОЈИ")}\n` +
    `<b>ADMIN_THREAD_ID:</b> ${escapeHtml(env.ADMIN_THREAD_ID || "НИЈЕ ПОДЕШЕН")}\n` +
    `<b>Current thread ID:</b> ${escapeHtml(currentThreadId || "нема thread-а")}\n` +
    `<b>Telegram result:</b> ${escapeHtml(JSON.stringify(result))}`;
}

function formatPublicWarning(reason, warningCount) {
  const countText = warningCount ? `\n\nОпомена: ${warningCount}/3` : "";
  return `☦️ <b>Опомена</b>\n\nПазимо на речник и тон. Без псовки, увреда, спама и саблажњивог говора.${countText}\n\n<i>Разлог: ${escapeHtml(reason)}</i>`;
}

function formatMuteWarning(reason, warningCount) {
  return `☦️ <b>Корисник је ућуткан на 10 минута</b>\n\nРазлог: ${escapeHtml(reason)}\nОпомена: ${escapeHtml(warningCount)}/5`;
}

function formatBanWarning(reason, warningCount) {
  return `☦️ <b>Корисник је уклоњен из групе</b>\n\nРазлог: ${escapeHtml(reason)}\nОпомена: ${escapeHtml(warningCount)}`;
}

function calculateRisk(text, message, env = {}) {
  const reasons = [];
  let score = 0;
  const sensitiveTheology = hasAny(text, THEOLOGY_SENSITIVE);
  const churchCriticism = hasAny(text, CHURCH_CRITICISM);
  const clergyAccusation = hasAny(text, CLERGY_ACCUSATION);
  const clergyMoneyAccusation = hasAny(text, CLERGY_TERMS) && hasAny(text, MONEY_ACCUSATION_TERMS);
  const sexualTopic = hasAny(text, SEXUAL_TOPIC);
  const moralDangerTopic = hasAny(text, MORAL_DANGER_TOPIC);
  const occultTopic = hasAny(text, OCCULT_TOPIC);
  const aggressiveTone = hasAny(text, AGGRESSIVE_TONE);
  const mockingTone = hasAny(text, MOCKING_PHRASES);
  const extraReviewHit = hasAny(text, getEnvList(env.EXTRA_REVIEW_TERMS));
  const longMessage = text.length > 700;

  score += addRisk(reasons, sensitiveTheology && aggressiveTone, 3, "осетљива богословска тема + оштар тон");
  score += addRisk(reasons, sensitiveTheology && mockingTone, 3, "осетљива богословска тема + могуће ругање");
  score += addRisk(reasons, sensitiveTheology && churchCriticism, 3, "осетљива богословска тема + критика Цркве");
  score += addRisk(reasons, churchCriticism, 3, "могућа критика Цркве");
  score += addRisk(reasons, clergyAccusation, 3, "могућа оптужба на свештенство/епископе");
  score += addRisk(reasons, clergyMoneyAccusation, 4, "оптужба да свештенство краде/узима новац");
  score += addRisk(reasons, sexualTopic, 3, "осетљива морална тема");
  score += addRisk(reasons, moralDangerTopic, 2, "осетљива тема греха/зависности/саблазни");
  score += addRisk(reasons, occultTopic, 3, "окултна/демонска тема");
  score += addRisk(reasons, aggressiveTone, 2, "оштрији тон");
  score += addRisk(reasons, mockingTone, 2, "могуће ругање/провокација");
  score += addRisk(reasons, extraReviewHit, 4, "поклапање са приватном review листом");
  score += addRisk(reasons, longMessage && (aggressiveTone || mockingTone || churchCriticism || clergyAccusation || clergyMoneyAccusation), 1, "дугачак оштрији rant");
  return { score, reasons };
}

function addRisk(reasons, condition, points, reason) {
  if (!condition) return 0;
  reasons.push(reason);
  return points;
}

async function analyzeWithAI({ text, risk, message, env }) {
  if (!env.AI) return { decision: "ADMIN_REVIEW", severity: risk.score >= 7 ? "HIGH" : "MEDIUM", reason: "AI binding није подешен, али локални филтер је означио поруку.", recommendation: "Провери ручно." };
  try {
    const prompt = `Ти си православни AI модератор Telegram групе. Не пишеш кориснику и не пишеш у групу. Само помажеш админу. Само помињање речи као јерес, секта, католик, протестант, папа, ислам није прекршај. Врати само JSON: {"decision":"OK" или "ADMIN_REVIEW","severity":"LOW" или "MEDIUM" или "HIGH","reason":"кратак разлог","recommendation":"кратка препорука"}\n\nРизик: ${risk.score}\nРазлози: ${risk.reasons.join(", ")}\nПорука: ${text.slice(0, 2000)}`;
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Одговараш само валидним JSON-ом." }, { role: "user", content: prompt }] });
    const raw = result.response || result.text || "";
    return safeJson(raw) || { decision: "ADMIN_REVIEW", severity: risk.score >= 7 ? "HIGH" : "MEDIUM", reason: "AI није вратио чист JSON, али порука је сумњива.", recommendation: "Провери ручно." };
  } catch {
    return { decision: "ADMIN_REVIEW", severity: risk.score >= 7 ? "HIGH" : "MEDIUM", reason: "AI анализа није успела, али локални филтер је означио поруку.", recommendation: "Провери ручно." };
  }
}

function hasAny(text, words) { return words.some((word) => text.includes(word)); }
function getEnvList(value) { return String(value || "").split(",").map((item) => normalizeText(item)).filter(Boolean); }
function hasSpamLink(text) { return /https?:\/\/|t\.me\/|telegram\.me\/|www\.|\.com|\.net|\.org|\.ru|\.xyz|\.top|\.click|\.shop|\.site/.test(text) && /joinchat|start=|ref=|promo|airdrop|crypto|casino|bet|bonus|telegram channel|zarada|brza zarada/.test(text); }
function isCapsSpam(text) { const letters = text.replace(/[^A-ZА-ЯЉЊЂЋЏŠĐČĆŽ]/g, ""); return text.length > 40 && letters.length / text.length > 0.6; }
function hasDirectBlasphemy(text) { return hasAny(text, BLASPHEMY_TARGETS) && hasAny(text, MOCKING_PHRASES); }
function safeJson(raw) { try { return JSON.parse(String(raw || "").replace(/```json|```/g, "").trim()); } catch { return null; } }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const HARD_PROFANITY = ["jeb", "јеб", "jbg", "јбг", "kur", "кур", "piz", "пиз", "pick", "пич", "govn", "говн", "sran", "срањ", "majku ti", "мајку ти", "mamu ti", "маму ти", "mater ti", "матер ти", "mrs u", "мрш у", "odjebi", "одјеби"];
const HARD_INSULTS = ["idiot", "идиот", "debil", "дебил", "kreten", "кретен", "retard", "ретард", "budalo", "будало", "budala", "будала", "majmune", "мајмуне", "majmun", "мајмун", "glup si", "глуп си", "glupa si", "глупа си", "stoko", "стоко", "stoka", "стока", "smece", "смеће", "olos", "олош", "moron", "морон", "imbecil", "имбецил"];
const HARD_VULGARITY = ["porno link", "порно линк", "onlyfans", "gole slike", "голе слике", "nudes", "nude"];
const CLERGY_TERMS = ["свештеник", "svestenik", "свештеници", "svestenici", "поп", "pop", "попови", "popovi", "епископ", "episkop", "епископи", "episkopi", "владика", "vladika", "владике", "vladike", "патријарх", "patrijarh", "свештенство", "svestenstvo"];
const MONEY_ACCUSATION_TERMS = ["краде", "krade", "краду", "kradu", "лопов", "lopov", "лопови", "lopovi", "узима паре", "uzima pare", "узимају паре", "uzimaju pare", "само паре", "samo pare", "новац", "novac", "бизнис", "biznis", "мафија", "mafija", "наплаћују", "naplacuju"];
const THEOLOGY_SENSITIVE = ["јерес", "jeres", "јеретик", "jeretik", "секта", "sekta", "унија", "unija", "унијат", "unijat", "filioque", "филиокве", "католик", "katolik", "папа", "papa", "ватикан", "vatikan", "протестант", "protestant", "ислам", "islam", "канон", "kanon", "догма", "dogma", "екумен", "ekumen", "раскол", "raskol", "новотар", "novotar"];
const CHURCH_CRITICISM = ["црква је бизнис", "crkva je biznis", "све је то бизнис", "sve je to biznis", "црква узима паре", "crkva uzima pare", "лажу народ", "lazu narod", "варају народ", "varaju narod", "црква пере мозак", "crkva pere mozak", "поповска мафија", "popovska mafija", "религија је бајка", "religija je bajka", "православље је мит", "pravoslavlje je mit"];
const CLERGY_ACCUSATION = ["попови су", "popovi su", "свештеници су", "svestenici su", "епископи су", "episkopi su", "владике су", "vladike su", "сви попови", "svi popovi", "сви свештеници", "svi svestenici", "све владике", "sve vladike"];
const SEXUAL_TOPIC = ["блуд", "blud", "разврат", "razvrat", "порно", "porno", "секс", "seks", "проститу", "prostitu", "абортус", "abortus", "прељуб", "preljub", "похота", "pohota", "страст", "strast"];
const MORAL_DANGER_TOPIC = ["дрога", "droga", "наркотик", "narkotik", "алкохолиз", "alkoholiz", "коцка", "kocka", "кладионица", "kladionica", "зависност", "zavisnost", "насиље", "nasilje", "мржња", "mrznja"];
const OCCULT_TOPIC = ["врач", "vrac", "магија", "magija", "окулт", "okult", "тарот", "tarot", "астролог", "astrolog", "хороскоп", "horoskop", "сатан", "satan", "демон", "demon", "ђаво", "djavo", "ритуал", "ritual"];
const AGGRESSIVE_TONE = ["срам те", "sram te", "ћути", "cuti", "зачепи", "zacepi", "немаш појма", "nemas pojma", "лажеш", "lazes", "лажов", "lazov", "ко си ти", "ko si ti", "мрш", "mrs", "не лупај", "ne lupaj", "лупаш", "lupas", "провокатор", "provokator", "трол", "trol"];
const MOCKING_PHRASES = ["хаха", "haha", "lol", "лол", "lmao", "смешно", "smesno", "глупост", "glupost", "бајка", "bajka", "мит", "mit", "измишљотина", "izmisljotina", "циркус", "cirkus", "затуцан", "zatucan"];
const BLASPHEMY_TARGETS = ["господ", "gospod", "исус", "isus", "христ", "hrist", "богородиц", "bogorodic", "светитељ", "svetitelj", "икон", "ikon", "литурги", "liturgi", "причешћ", "pricesc", "крст", "krst", "јеванђељ", "jevandjelj", "свето писмо", "sveto pismo", "свете тајне", "svete tajne", "храм", "hram", "манастир", "manastir", "мошти", "mosti"];
