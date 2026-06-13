import originalWorker from "./index.js";

const BIBLE_TRANSLATION = "srkdekavski";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return originalWorker.fetch(request, env, ctx);

    const cloned = request.clone();
    let update;

    try {
      update = await cloned.json();
    } catch {
      return originalWorker.fetch(request, env, ctx);
    }

    const message = update.message || update.edited_message;
    if (!message?.text) return originalWorker.fetch(request, env, ctx);

    const text = message.text.trim();
    const lower = text.toLowerCase();
    const chatId = message.chat.id;
    const threadId = message.message_thread_id;

    if (isCommand(lower, ["/citanja", "/читања", "/dnevna_citanja", "/дневна_читања", "/dnevnacitanja", "/дневначитања"])) {
      const rewritten = rewriteMessageText(update, "/svpismo");
      return originalWorker.fetch(jsonRequest(request, rewritten), env, ctx);
    }

    if (isCommand(lower, ["/svpismo", "/свписмо"])) {
      const args = getCommandArgs(text);

      if (!args) {
        return originalWorker.fetch(request, env, ctx);
      }

      return handleBibleLookup({ chatId, threadId, args });
    }

    return originalWorker.fetch(request, env, ctx);
  }
};

function isCommand(text, commands) {
  return commands.some((command) => text === command || text.startsWith(command + " ") || text.startsWith(command + "@"));
}

function getCommandArgs(text) {
  return String(text || "").replace(/^\/\S+\s*/u, "").trim();
}

async function handleBibleLookup({ chatId, threadId, args }) {
  const parsed = parseBibleReference(args);

  if (!parsed.ok) {
    return sendMessage(
      chatId,
      "📖 <b>Свето Писмо</b>\n\nНе препознајем референцу. Пробај овако:\n<code>/свписмо Римљанима 2:14-15</code>\n<code>/svpismo Jovan 3:16</code>\n<code>/свписмо Пророк Осија 3:2</code>",
      threadId
    );
  }

  const result = await fetchBiblePassage(parsed.queryReference);

  if (!result.ok) {
    return sendMessage(chatId, `📖 <b>Свето Писмо</b>\n\nНисам успео да нађем цитат. Разлог: ${escapeHtml(result.error || "непозната грешка")}`, threadId);
  }

  return sendMessage(chatId, formatBiblePassage(parsed.displayReference, result.verses), threadId);
}

function parseBibleReference(input) {
  const raw = normalizeReferenceAliases(String(input || "").trim().replace(/\s+/g, " "));
  const match = raw.match(/^(.+?)\s+(\d+)\s*:\s*([\d\s,\-–—]+)$/u);
  if (!match) return { ok: false };

  const bookKey = normalizeBookInput(match[1]);
  const book = BOOKS[bookKey];
  const chapter = match[2].trim();
  const verses = match[3].replace(/[–—]/g, "-").replace(/\s+/g, "").trim();

  if (!book || !/^\d+([\-,]\d+)*$/u.test(verses)) return { ok: false };

  return {
    ok: true,
    queryReference: `${book.queryName} ${chapter}:${verses}`,
    displayReference: `${book.displayName} ${chapter}:${verses}`
  };
}

function normalizeReferenceAliases(value) {
  return value
    .replace(/^(пророк|свети пророк)\s+осије?\b/i, "Осија")
    .replace(/^књига\s+пророка\s+осије?\b/i, "Осија")
    .replace(/^(prorok|sveti prorok)\s+osije?\b/i, "Osija")
    .replace(/^knjiga\s+proroka\s+osije?\b/i, "Osija")
    .replace(/^(пророк|свети пророк)\s+исаија\b/i, "Исаија")
    .replace(/^књига\s+пророка\s+исаије\b/i, "Исаија")
    .replace(/^(пророк|свети пророк)\s+јеремија\b/i, "Јеремија")
    .replace(/^књига\s+пророка\s+јеремије\b/i, "Јеремија")
    .replace(/^(пророк|свети пророк)\s+језекиљ\b/i, "Језекиљ")
    .replace(/^књига\s+пророка\s+језекиља\b/i, "Језекиљ")
    .replace(/^(пророк|свети пророк)\s+данило\b/i, "Данило")
    .replace(/^књига\s+пророка\s+данила\b/i, "Данило");
}

function normalizeBookInput(value) {
  return transliterateSerbian(String(value || "").toLowerCase()).replace(/[.]/g, "").replace(/\s+/g, " ").trim();
}

function transliterateSerbian(value) {
  const map = {
    "а":"a","б":"b","в":"v","г":"g","д":"d","ђ":"dj","е":"e","ж":"z","з":"z","и":"i","ј":"j","к":"k","л":"l","љ":"lj","м":"m","н":"n","њ":"nj","о":"o","п":"p","р":"r","с":"s","т":"t","ћ":"c","у":"u","ф":"f","х":"h","ц":"c","ч":"c","џ":"dz","ш":"s",
    "š":"s","č":"c","ć":"c","ž":"z","đ":"dj"
  };
  return Array.from(value).map((char) => map[char] || char).join("");
}

async function fetchBiblePassage(queryReference) {
  const url = `https://query.getbible.net/v2/${BIBLE_TRANSLATION}/${encodeURIComponent(queryReference)}`;

  try {
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) return { ok: false, error: `GetBible HTTP ${response.status}` };

    const data = await response.json();
    const verses = extractVerses(data);
    if (!verses.length) return { ok: false, error: "GetBible је вратио одговор без стихова" };
    return { ok: true, verses };
  } catch (error) {
    return { ok: false, error: error?.message || "GetBible request није успео" };
  }
}

function extractVerses(data) {
  const verses = [];

  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;

    const text = value.text || value.verse_text || value.scripture;
    const verse = value.verse || value.verse_nr || value.verse_number || value.nr;

    if (text && verse !== undefined) {
      verses.push({ verse, text: cleanBibleText(text) });
      return;
    }

    Object.values(value).forEach(walk);
  }

  walk(data);
  return verses;
}

function cleanBibleText(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function formatBiblePassage(reference, verses) {
  const lines = verses.slice(0, 30).map((v) => `${v.verse}. ${escapeHtml(v.text)}`);
  const truncated = verses.length > 30 ? "\n\n<i>Приказано је првих 30 стихова.</i>" : "";
  return `📖 <b>${escapeHtml(reference)}</b>\n\n${lines.join("\n")}${truncated}\n\n<i>Превод: Даничић-Караџић, екавски.</i>`;
}

function rewriteMessageText(update, newText) {
  const copy = JSON.parse(JSON.stringify(update));
  if (copy.message?.text) copy.message.text = newText;
  if (copy.edited_message?.text) copy.edited_message.text = newText;
  return copy;
}

function jsonRequest(originalRequest, body) {
  return new Request(originalRequest.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function sendMessage(chatId, text, threadId) {
  const payload = { method: "sendMessage", chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (threadId !== undefined && threadId !== null) payload.message_thread_id = threadId;
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function b(queryName, displayName) {
  return { queryName, displayName };
}

const BOOKS = {
  "postanje": b("Genesis", "Постање"), "1 mojsijeva": b("Genesis", "Постање"),
  "izlazak": b("Exodus", "Излазак"), "2 mojsijeva": b("Exodus", "Излазак"),
  "levitska": b("Leviticus", "Левитска"), "3 mojsijeva": b("Leviticus", "Левитска"),
  "brojevi": b("Numbers", "Бројеви"), "4 mojsijeva": b("Numbers", "Бројеви"),
  "ponovljeni zakoni": b("Deuteronomy", "Поновљени закони"), "5 mojsijeva": b("Deuteronomy", "Поновљени закони"),
  "isus navin": b("Joshua", "Исус Навин"), "sudije": b("Judges", "Судије"), "ruta": b("Ruth", "Рута"),
  "1 samuilova": b("1 Samuel", "1. Самуилова"), "2 samuilova": b("2 Samuel", "2. Самуилова"),
  "1 carevima": b("1 Kings", "1. Царевима"), "2 carevima": b("2 Kings", "2. Царевима"),
  "1 dnevnika": b("1 Chronicles", "1. Дневника"), "2 dnevnika": b("2 Chronicles", "2. Дневника"),
  "jezdra": b("Ezra", "Јездра"), "nemija": b("Nehemiah", "Немија"), "jestira": b("Esther", "Јестира"),
  "jov": b("Job", "Јов"), "psalam": b("Psalms", "Псалам"), "psalmi": b("Psalms", "Псалми"),
  "price": b("Proverbs", "Приче"), "propovednik": b("Ecclesiastes", "Проповедник"),
  "pesma nad pesmama": b("Song of Solomon", "Песма над песмама"),
  "isaija": b("Isaiah", "Исаија"), "jeremija": b("Jeremiah", "Јеремија"), "plac jeremijin": b("Lamentations", "Плач Јеремијин"),
  "jezekilj": b("Ezekiel", "Језекиљ"), "danilo": b("Daniel", "Данило"),
  "osija": b("Hosea", "Осија"), "osije": b("Hosea", "Осија"), "joil": b("Joel", "Јоил"), "amos": b("Amos", "Амос"),
  "avdija": b("Obadiah", "Авдија"), "jona": b("Jonah", "Јона"), "mihej": b("Micah", "Михеј"), "naum": b("Nahum", "Наум"),
  "avakum": b("Habakkuk", "Авакум"), "sofonija": b("Zephaniah", "Софонија"), "agej": b("Haggai", "Агеј"),
  "zaharija": b("Zechariah", "Захарија"), "malahija": b("Malachi", "Малахија"),
  "matej": b("Matthew", "Матеј"), "mt": b("Matthew", "Матеј"), "marko": b("Mark", "Марко"), "mk": b("Mark", "Марко"),
  "luka": b("Luke", "Лука"), "lk": b("Luke", "Лука"), "jovan": b("John", "Јован"), "jn": b("John", "Јован"),
  "dela": b("Acts", "Дела апостолска"), "dap": b("Acts", "Дела апостолска"), "rimljanima": b("Romans", "Римљанима"), "rim": b("Romans", "Римљанима"),
  "1 korincanima": b("1 Corinthians", "1. Коринћанима"), "1 kor": b("1 Corinthians", "1. Коринћанима"),
  "2 korincanima": b("2 Corinthians", "2. Коринћанима"), "2 kor": b("2 Corinthians", "2. Коринћанима"),
  "galatima": b("Galatians", "Галатима"), "efescima": b("Ephesians", "Ефесцима"), "filibljanima": b("Philippians", "Филибљанима"),
  "kolosanima": b("Colossians", "Колошанима"), "1 solunjanima": b("1 Thessalonians", "1. Солуњанима"), "2 solunjanima": b("2 Thessalonians", "2. Солуњанима"),
  "1 timotiju": b("1 Timothy", "1. Тимотију"), "2 timotiju": b("2 Timothy", "2. Тимотију"), "titu": b("Titus", "Титу"),
  "filimonu": b("Philemon", "Филимону"), "jevrejima": b("Hebrews", "Јеврејима"), "jevrecima": b("Hebrews", "Јеврејима"),
  "jakovljeva": b("James", "Јаковљева"), "1 petrova": b("1 Peter", "1. Петрова"), "2 petrova": b("2 Peter", "2. Петрова"),
  "1 jovanova": b("1 John", "1. Јованова"), "2 jovanova": b("2 John", "2. Јованова"), "3 jovanova": b("3 John", "3. Јованова"),
  "judina": b("Jude", "Јудина"), "otkrivenje": b("Revelation", "Откривење")
};
