import { calendar2026 } from "./data/calendar-2026.js";
import { handleModeration } from "./moderation.js";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Православни бот ради ☦️", { status: 200 });
    }

    let update;

    try {
      update = await request.json();
    } catch (error) {
      return new Response("Bad request", { status: 400 });
    }

    const message = update.message || update.edited_message;

    if (!message) {
      return new Response("OK", { status: 200 });
    }
    
    const chatId = message.chat.id;
    const threadId = message.message_thread_id;

    const moderationEnabled = String(env.ENABLE_MODERATION || "true").toLowerCase() !== "false";

    if (moderationEnabled) {
      const moderationResponse = await handleModeration({
        message,
        env,
        chatId,
        threadId,
        sendGroupMessage: sendMessage
      });
      
      if (moderationResponse) {
        return moderationResponse;
      }
    }
    
    if (!message.text) {
      return new Response("OK", { status: 200 });
    }
    
    const text = message.text.trim().toLowerCase();

    const todayKey = getTodayKey();
    const tomorrowKey = getTomorrowKey();
    const today = calendar2026[todayKey];
    const tomorrow = calendar2026[tomorrowKey];

    let reply = "";

    if (isCommand(text, ["/chatid", "/четид"])) {
      reply = `Chat ID: <code>${chatId}</code>`;
    }

    if (isCommand(text, ["/start", "/help", "/pomoc", "/помоћ"])) {
      reply = formatHelp();
    }

    else if (isCommand(text, ["/pravila", "/правила"])) {
      reply = `☦️ <b>Правила групе</b>

1. <b>Без псовки, вређања и личних напада.</b>
Не нападамо човека, не понижавамо, не исмевамо и не лепимо етикете. Ако се не слажеш, одговори мирно и јасно.

2. <b>Критикуј аргумент, не човека.</b>
Дозвољена је оштра расправа, али не и гордост, ругање, провокација и лична мржња.

3. <b>За озбиљне тврдње о Цркви, историји, светитељима, канонима и богословљу дај извор.</b>
Не ширимо гласине, полуистине и “чуо сам” приче као да су сигурна истина.

4. <b>Без спама, рекламирања, троловања и намерних провокација.</b>
Група није место за хаос, празно препуцавање и скретање сваке теме у свађу.

5. <b>Без непристојних слика, снимака, мимова, линкова и садржаја који саблажњава.</b>
Све што је вулгарно, развратно, богохулно, демонско, порнографско, насилно ради шока, или намерно гадно, биће брисано.

6. <b>О тешким гресима говоримо трезвено, не саблажњиво.</b>
О блуду, разврату, абортусу, насиљу, јересима, окултизму, дрогама, алкохолизму и сличним темама може се говорити само ради покајања, поуке, разобличења греха или тражења помоћи. Забрањено је непотребно детаљисање, вулгарни описи, шале, хвалисање грехом, радозналост из страсти и коришћење таквих тема у погрешну сврху.

7. <b>Без богохуљења и ругања светињама.</b>
Не допушта се исмевање Господа, Пресвете Богородице, светитеља, Светог Писма, Светих Тајни, икона, храма, свештенства и православне вере.

8. <b>Не ширимо очајање, страх и духовну панику.</b>
Може се говорити о тешким стварима, али не тако да се људи бацају у безнађе, мржњу, параноју или осуду свих око себе. Православље води ка покајању, трезвености и нади у Господа.

9. <b>Не дајемо духовне савете као да смо духовници.</b>
Можемо поделити мишљење, цитат Светих Отаца или лично искуство, али за исповест, епитимију, брачне проблеме, тешке грехе и озбиљне духовне муке човек треба да иде свештенику.

10. <b>Чувајмо мир, али не по цену истине.</b>
Мир није ћутање пред лажју, али ни истина се не брани бесом, прљавим речима и гордошћу.

☦️ <b>Циљ групе</b>
Да се међусобно изграђујемо у православној вери, трезвености и љубави према истини. Ко је дошао да се свађа, саблажњава или прави циркус, није за ову групу.`;
    }

    else if (isCommand(text, ["/kalendar", "/календар"])) {
      if (!today) {
        reply = missingDateMessage(todayKey);
      } else if (today.icon) {
        return sendPhoto(chatId, today.icon, formatCalendarCaption(today), threadId);
      } else {
        reply = formatCalendar(today);
      }
    }

    else if (isCommand(text, ["/post", "/пост"])) {
      reply = today ? formatPost(today) : missingDateMessage(todayKey);
    }

    else if (isCommand(text, ["/sutra", "/сутра"])) {
      reply = tomorrow ? formatTomorrow(tomorrow) : missingDateMessage(tomorrowKey);
    }

    else if (isCommand(text, ["/nedelja", "/недеља"])) {
      reply = formatWeek();
    }

    else if (isCommand(text, ["/svetitelj", "/светитељ"])) {
      if (!today) {
        reply = missingDateMessage(todayKey);
      } else if (today.icon) {
        return sendPhoto(chatId, today.icon, formatSaintCaption(today), threadId);
      } else {
        reply = formatSaintCommand(today);
      }
    }

    else if (isCommand(text, ["/ikona", "/икона"])) {
      if (!today) {
        reply = missingDateMessage(todayKey);
      } else if (!today.icon) {
        reply = `☦️ <b>Икона дана</b>

${e(today.title || "Није уписано")}

Икона још није додата.`;
      } else {
        return sendPhoto(chatId, today.icon, `☦️ <b>Икона дана</b>

${e(today.title || "Није уписано")}`, threadId);
      }
    }

    else if (isCommand(text, ["/svpismo", "/svpisмо", "/свписмо"])) {
      reply = today ? formatScripture(today) : missingDateMessage(todayKey);
    }

    else if (isCommand(text, ["/prolog", "/пролог"])) {
      reply = today
        ? `☦️ <b>Охридски пролог</b>\n\n${e(today.prolog || "Пролог још није уписан за овај датум.")}`
        : missingDateMessage(todayKey);
    }

    else if (isCommand(text, ["/tropar", "/тропар"])) {
      reply = today ? formatTropar(today) : missingDateMessage(todayKey);
    }

    else if (isCommand(text, ["/kondak", "/кондак"])) {
      reply = today ? formatKondak(today) : missingDateMessage(todayKey);
    }

   else if (isCommand(text, ["/molitva", "/молитва"])) {
      reply = formatRandomPrayer();
    }

    else if (isCommand(text, ["/glas", "/глас"])) {
      reply = today ? formatToneCommand(today) : missingDateMessage(todayKey);
    }
    
    else if (isCommand(text, ["/citat", "/цитат"])) {
      reply = formatRandomQuote();
    }

    else if (isCommand(text, ["/linkovi", "/линкови"])) {
      reply = `☦️ <b>Корисни линкови</b>

<b>Охридски пролог</b>
https://www.pravoslavnikalendar.rs/prolog/

<b>Свето Писмо</b>
https://www.svetopismo.info/

<b>Светосавље</b>
https://svetosavlje.org/

<b>СПЦ</b>
https://spc.rs/`;
    }

    if (!reply) {
      return new Response("OK", { status: 200 });
    }

    return sendMessage(chatId, reply, threadId);
  }
};

const prayers = [
  {
    title: "Исусова молитва",
    text: `Господе Исусе Христе, Сине Божији, помилуј ме грешног.`
  },
  {
    title: "Молитва Пресветој Богородици",
    text: `Пресвета Богородице, спаси нас.`
  },
  {
    title: "Оче наш",
    text: `Оче наш, Који си на небесима,
да се свети име Твоје,
да дође Царство Твоје,
да буде воља Твоја
и на земљи као на небу.

Хлеб наш насушни дај нам данас;
и опрости нам дугове наше
као што и ми опраштамо дужницима својим;
и не уведи нас у искушење,
но избави нас од злога. Амин.`
  },
  {
    title: "Богородице Дјево",
    text: `Богородице Дјево, радуј се, Благодатна Маријо,
Господ је с Тобом;
благословена си Ти међу женама,
и благословен је плод утробе Твоје,
јер си родила Спаситеља душа наших.`
  },
  {
    title: "Царе Небески",
    text: `Царе Небески, Утешитељу, Душе Истине,
Који си свуда и све испуњаваш,
Ризницо добара и Даваоче живота,
дођи и усели се у нас,
и очисти нас од сваке нечистоте,
и спаси, Благи, душе наше.`
  },
  {
    title: "Молитва пред почетак рада",
    text: `Господе Исусе Христе, Сине Божији,
благослови дело које почињем,
просвети ум мој, укрепи вољу моју
и управи све на спасење душе моје. Амин.`
  },
  {
    title: "Кратка молитва у невољи",
    text: `Господе, помози ми.
Господе, укрепи ме.
Господе, не остави ме.`
  },
  {
    title: "Молитва за смирење",
    text: `Господе, даруј ми да видим своја сагрешења
и да не осуђујем брата свога,
јер си благословен у векове векова. Амин.`
  },
  {
    title: "Молитва Анђелу чувару",
    text: `Анђеле Христов, чувару мој свети,
покрове душе и тела мога,
опрости ми све чиме те ожалостих,
и заштити ме од свакога зла. Амин.`
  },
  {
    title: "Молитва пре јела",
    text: `Очи свију у Тебе се, Господе, уздају,
и Ти им дајеш храну у право време.
Отвараш руку Своју
и испуњаваш све живо благошћу. Амин.`
  },
  {
    title: "Молитва после јела",
    text: `Благодаримо Ти, Христе Боже наш,
што си нас наситио земаљским добрима Својим.
Не лиши нас ни Небеског Царства Твога. Амин.`
  }
];

const quotes = [
  {
    text: "Какве су нам мисли, такав нам је живот.",
    source: "Старац Тадеј Витовнички"
  },
  {
    text: "Ако су нам мисли мирне, тихе, пуне љубави и доброте, онда је и у нама мир.",
    source: "Старац Тадеј Витовнички"
  },
  {
    text: "Која год мисао разара мир, та је од пакла и треба је одбацити.",
    source: "Старац Тадеј Витовнички"
  },
  {
    text: "Бог је сав љубав.",
    source: "Старац Тадеј Витовнички"
  },
  {
    text: "Завист разара унутрашњи мир и спокој душе.",
    source: "Старац Тадеј Витовнички"
  },

  {
    text: "Гледај да бол свога ближњег учиниш својим болом.",
    source: "Свети Пајсије Светогорац"
  },
  {
    text: "Што се човек више удаљава од Бога, то ствари постају теже.",
    source: "Свети Пајсије Светогорац"
  },
  {
    text: "Када човек има добру помисао, све види чисто.",
    source: "Свети Пајсије Светогорац"
  },
  {
    text: "Молитва има велику силу када се врши са смирењем.",
    source: "Свети Пајсије Светогорац"
  },
  {
    text: "Онај ко има смирење има и благодат Божију.",
    source: "Свети Пајсије Светогорац"
  },

  {
    text: "Стекни дух мира, и хиљаде око тебе ће се спасти.",
    source: "Свети Серафим Саровски"
  },
  {
    text: "Радости моја, Христос васкрсе!",
    source: "Свети Серафим Саровски"
  },

  {
    text: "Ништа није равно молитви, јер она и немогуће чини могућим.",
    source: "Свети Јован Златоуст"
  },
  {
    text: "Не говори ми: много сам сагрешио, па не могу да се спасем.",
    source: "Свети Јован Златоуст"
  },
  {
    text: "Ко самога себе осуђује, тај лакше подноси увреде од других.",
    source: "Свети Јован Златоуст"
  },

  {
    text: "Мир у души рађа се од смирења.",
    source: "Свети Силуан Атонски"
  },
  {
    text: "Држи ум свој у аду и не очајавај.",
    source: "Свети Силуан Атонски"
  },

  {
    text: "Ко је познао себе, већи је од онога који је видео анђеле.",
    source: "Свети Исак Сирин"
  },
  {
    text: "Смирење и без дела многа сагрешења опрашта.",
    source: "Свети Исак Сирин"
  },

  {
    text: "Ко верује сновима, личи на човека који трчи за својом сенком.",
    source: "Свети Јован Лествичник"
  },
  {
    text: "Мајка молитве је тишина.",
    source: "Свети Јован Лествичник"
  },

  {
    text: "Моли се Богу тако као да сва помоћ зависи од Њега, а труди се као да све зависи од тебе.",
    source: "Свети Филарет Московски"
  },

  {
    text: "Нема ништа јаче од човека који се искрено каје.",
    source: "Свети Николај Жички"
  },
  {
    text: "Ко Бога има, све има.",
    source: "Свети Николај Жички"
  }
];

function sendMessage(chatId, text, threadId = undefined) {
  const payload = {
    method: "sendMessage",
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (threadId !== undefined && threadId !== null) {
    payload.message_thread_id = threadId;
  }

  return new Response(
    JSON.stringify(payload),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function sendPhoto(chatId, photoUrl, caption, threadId = undefined) {
  const payload = {
    method: "sendPhoto",
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: "HTML"
  };

  if (threadId !== undefined && threadId !== null) {
    payload.message_thread_id = threadId;
  }

  return new Response(
    JSON.stringify(payload),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function isCommand(text, commands) {
  return commands.some((command) =>
    text === command ||
    text.startsWith(command + "@") ||
    text.startsWith(command + " ")
  );
}

function formatSaintCaption(data) {
  return `☦️ <b>Светитељ дана</b>

<b>${e(data.title || "Није уписано")}</b>

<b>Остали помени</b>
${formatOtherSaints(data.saints, data.title)}`;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function formatCalendarCaption(data) {
  return `☦️ <b>Календар за данас</b>

📅 <b>Датум:</b> ${e(data.civilDate)}
🕊 <b>Црквени датум:</b> ${e(data.churchDate || "Није уписано")}
📆 <b>Дан:</b> ${e(data.day || "Није уписано")}
🎵 <b>${formatToneLine(data)}</b>

<b>${e(data.title || "Није уписано")}</b>

<b>Пост</b>
${formatFastStatus(data)}

<b>Читања</b>
Апостол: ${e(data.apostle || "Није уписано")}
Јеванђеље: ${e(data.gospel || "Није уписано")}`;
}

function getTomorrowKey() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return formatDateKey(date);
}

function addDaysKey(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function formatDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;

  return `${year}-${month}-${day}`;
}

function formatHelp() {
  return `☦️ <b>Православни бот</b>

<b>Основне команде</b>
/календар  Данашњи црквени календар
/светитељ  Светитељ или празник дана
/пост      Да ли је данас пост
/свписмо   Дневна читања
/тропар    Тропар дана
/кондак    Кондак дана
/глас      Глас недеље

<b>Преглед дана</b>
/сутра     Преглед за сутрашњи дан
/недеља    Наредних 7 дана

<b>Духовни садржај</b>
/пролог    Охридски пролог
/молитва   Насумична молитва
/цитат     Насумичан православни цитат
/икона     Икона дана

<b>Остало</b>
/правила   Правила групе
/линкови   Корисни православни линкови`;
}

function getWeekToneByDateKey(dateKey) {
  const thomasSunday2026 = "2026-04-19";

  const currentSunday = getSundayOfWeek(dateKey);

  if (currentSunday < thomasSunday2026) {
    return "";
  }

  const diffDays = daysBetween(thomasSunday2026, currentSunday);
  const weeks = Math.floor(diffDays / 7);

  const tone = (weeks % 8) + 1;

  return `${tone}. глас`;
}

function getSundayOfWeek(dateKey) {
  const date = new Date(dateKey + "T12:00:00Z");
  const day = date.getUTCDay(); // 0 = недеља

  date.setUTCDate(date.getUTCDate() - day);

  return date.toISOString().slice(0, 10);
}

function daysBetween(startKey, endKey) {
  const start = new Date(startKey + "T12:00:00Z");
  const end = new Date(endKey + "T12:00:00Z");

  return Math.round((end - start) / 86400000);
}

function formatToneLine(data) {
  const tone = getWeekToneByDateKey(data.date);

  if (!tone) {
    return "Глас није израчунат за овај датум.";
  }

  return `Глас недеље: ${e(tone)}`;
}

function formatToneCommand(data) {
  const tone = getWeekToneByDateKey(data.date);

  if (!tone) {
    return `☦️ <b>Глас недеље</b>

📅 ${e(data.civilDate)}

Глас није израчунат за овај датум.`;
  }

  return `☦️ <b>Глас недеље</b>

📅 ${e(data.civilDate)}
📆 ${e(data.day || "Није уписано")}

🎵 <b>${e(tone)}</b>

${e(data.title || "")}`;
}

function formatCalendar(data) {
  return `☦️ <b>Календар за данас</b>

📅 <b>Датум:</b> ${e(data.civilDate)}
🕊 <b>Црквени датум:</b> ${e(data.churchDate || "Није уписано")}
📆 <b>Дан:</b> ${e(data.day || "Није уписано")}
🎵 <b>${formatToneLine(data)}</b>

<b>Празник / светитељ дана</b>
${e(data.title || "Није уписано")}

<b>Остали светитељи</b>
${formatOtherSaints(data.saints, data.title)}

<b>Тип празника</b>
${e(data.feastType || "Није уписано")}

<b>Пост</b>
${formatFastStatus(data)}

<b>Читања</b>
Апостол: ${e(data.apostle || "Није уписано")}
Јеванђеље: ${e(data.gospel || "Није уписано")}

<b>Напомена</b>
${e(data.note || "Нема напомене.")}`;
}

function formatTomorrow(data) {
  return `☦️ <b>Сутра</b>

📅 ${e(data.civilDate)}
🕊 Црквени датум: ${e(data.churchDate || "Није уписано")}
📆 ${e(data.day || "Није уписано")}

<b>Празник / светитељ дана</b>
${e(data.title || "Није уписано")}

<b>Остали светитељи</b>
${formatOtherSaints(data.saints, data.title)}

<b>Пост</b>
${formatFastStatus(data)}

<b>Читања</b>
Апостол: ${e(data.apostle || "Није уписано")}
Јеванђеље: ${e(data.gospel || "Није уписано")}`;
}

function formatWeek() {
  const lines = ["☦️ <b>Наредних 7 дана</b>", ""];

  for (let i = 0; i < 7; i++) {
    const key = addDaysKey(i);
    const data = calendar2026[key];

    if (!data) {
      lines.push(`<b>${e(key)}</b>`);
      lines.push("Подаци још нису уписани.");
      lines.push("");
      continue;
    }

    lines.push(`<b>${e(data.civilDate)}, ${e(data.day || "")}</b>`);
    lines.push(`🎵 ${formatToneLine(data)}`);
    lines.push(e(data.title || "Није уписано"));
    lines.push(formatFastLine(data));
    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatPost(data) {
  return `☦️ <b>Пост за данас</b>

📅 ${e(data.civilDate)}

${formatFastStatus(data)}

<b>Напомена</b>
${e(data.note || "Нема напомене.")}`;
}

function formatSaintCommand(data) {
  return `☦️ <b>Светитељ дана</b>

${e(data.title || "Није уписано")}

<b>Остали помени</b>
${formatOtherSaints(data.saints, data.title)}`;
}

function formatScripture(data) {
  return `☦️ <b>Свето Писмо за данас</b>

<b>Апостол</b>
${e(data.apostle || "Није уписано")}

<b>Јеванђеље</b>
${e(data.gospel || "Није уписано")}`;
}

function formatTropar(data) {
  return `☦️ <b>Тропар дана</b>

<b>${e(data.title || "")}</b>

${e(data.tropar || "Тропар још није уписан за овај датум.")}`;
}

function formatKondak(data) {
  return `☦️ <b>Кондак дана</b>

<b>${e(data.title || "")}</b>

${e(data.kondak || "Кондак још није уписан за овај датум.")}`;
}

function formatIcon(data) {
  return `☦️ <b>Икона дана</b>

${e(data.title || "Није уписано")}

${data.icon ? e(data.icon) : "Икона још није додата."}`;
}

function formatOtherSaints(saints, title) {
  if (!saints || saints.length === 0) {
    return "Није уписано";
  }

  const filtered = saints.filter((saint) => saint && saint !== title);
  const list = filtered.length > 0 ? filtered : saints;

  return list.map((saint) => `• ${e(saint)}`).join("\n");
}

function formatFastLine(data) {
  return formatFastStatus(data);
}

function hasFast(data) {
  const fasting = `${data.fasting || ""} ${data.fastingType || ""}`.toLowerCase();

  if (
    fasting.includes("нема поста") ||
    fasting.includes("без поста") ||
    fasting.includes("разрешено") ||
    fasting.includes("разрешење")
  ) {
    return false;
  }

  return (
    fasting.includes("пост") ||
    fasting.includes("вода") ||
    fasting.includes("уље") ||
    fasting.includes("риба")
  );
}

function formatFastStatus(data) {
  if (hasFast(data)) {
    return `🔴 Пост: ${e(data.fastingType || data.fasting || "да")}`;
  }

  return `🟢 Без поста`;
}

function missingDateMessage(dateKey) {
  return `☦️ За датум ${e(dateKey)} још нису додати подаци у календар.

Додај тај датум у:
src/data/calendar-2026.js`;
}

function formatRandomPrayer() {
  const prayer = prayers[Math.floor(Math.random() * prayers.length)];

  return `☦️ <b>${e(prayer.title)}</b>

${e(prayer.text)}`;
}

function formatRandomQuote() {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  return `☦️ <b>Духовни цитат</b>

${e(quote.text)}

<i>${e(quote.source)}</i>`;
}

function e(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
