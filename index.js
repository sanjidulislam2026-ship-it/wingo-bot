import fs from "fs";
import http from "http";

const BOT_TOKEN = process.env.BOT_TOKEN || "9089131613:AAFvNW7YJEZ-xiwxRl7B6s6sR5-110cBcKQ";
const ADMIN_ID = process.env.ADMIN_ID || "";
const TARGETS_FILE = "./targets.json";
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot is running");
}).listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

function loadTargets() {
  try {
    if (fs.existsSync(TARGETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
      if (Array.isArray(raw)) return new Set(raw.map(String));
    }
  } catch (err) {
    console.error("Load targets error:", err.message);
  }
  return new Set();
}

function saveTargets(setObj) {
  try {
    fs.writeFileSync(TARGETS_FILE, JSON.stringify([...setObj], null, 2));
  } catch (err) {
    console.error("Save targets error:", err.message);
  }
}

const targets = loadTargets();

function addTarget(chatId) {
  if (!chatId) return;
  const idStr = String(chatId);
  if (!targets.has(idStr)) {
    targets.add(idStr);
    saveTargets(targets);
  }
}

function getColorEmoji(num) {
  if (num === 0) return "🔴🟣";
  if (num === 5) return "🟢🟣";
  return num % 2 === 0 ? "🔴" : "🟢";
}

function format17DigitPeriod(rawIssue) {
  const digitsOnly = String(rawIssue || "").replace(/\D/g, "");
  if (digitsOnly.length === 17) return digitsOnly;
  if (digitsOnly.length > 0) return digitsOnly.padEnd(17, "0").slice(0, 17);

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const secOfDay = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const slot = String(Math.floor(secOfDay / 30) + 1).padStart(4, "0");
  return `${yyyy}${mm}${dd}10005${slot}`.slice(0, 17);
}

async function fetchWinGoLiveData(marketType = "WinGo_30S") {
  try {
    const response = await fetch(
      `https://draw.ar-lottery01.com/WinGo/${marketType}/GetHistoryIssuePage.json?t=${Date.now()}`,
      { cache: "no-store" }
    );
    const data = await response.json();

    const historyList = data.list || (data.data && data.data.list) || [];

    if (historyList.length > 0) {
      console.log("Latest Draw Data:", historyList[0]);
      return historyList;
    }
  } catch (error) {
    console.error("API Fetch Error:", error);
  }
  return [];
}

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    console.error("Telegram send error:", err.message);
  }
}

async function broadcastMessage(text) {
  for (const id of targets) {
    await sendTelegramMessage(id, text);
  }
}

let lastSentPeriod = "";

async function generateAndSendSignal() {
  const historyList = await fetchWinGoLiveData("WinGo_30S");
  const latest = historyList.length > 0 ? historyList[0] : null;

  const rawIssue = latest ? (latest.issueNumber ?? latest.issue ?? latest.period ?? "") : "";
  let period = format17DigitPeriod(rawIssue);

  if (/^\d{17}$/.test(rawIssue)) {
    const nextIssue = String(BigInt(rawIssue) + 1n);
    if (nextIssue.length === 17) period = nextIssue;
  }

  if (period === lastSentPeriod) return;
  lastSentPeriod = period;

  const rawNum = latest ? Number(latest.number ?? latest.num ?? NaN) : NaN;
  const baseNum = !Number.isNaN(rawNum) && rawNum >= 0 && rawNum <= 9 ? rawNum : Number(period.slice(-1));
  const num = (baseNum + 3) % 10;
  const signal = num >= 5 ? "BIG" : "SMALL";
  const color = getColorEmoji(num);

  const msg =
    `♻️WINGO 30S SIGNAL♻️\n` +
    ` ⏰ Period: ${period}\n` +
    ` ♻️ Number: ${num}\n` +
    ` 📊 Signal: ${signal} \n` +
    ` 🎁 Calar : ${color}\n\n` +
    ` 📢 hasan vai`;

  await broadcastMessage(msg);
  console.log("Broadcasted signal -> Period:", period, "| Num:", num, "| Signal:", signal, "| Targets:", targets.size);
}

let offset = 0;

async function pollTelegramUpdates() {
  if (!BOT_TOKEN || BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=5`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      offset = update.update_id + 1;

      if (update.my_chat_member?.chat?.id) {
        addTarget(update.my_chat_member.chat.id);
      }

      const msg = update.message;
      if (!msg?.chat?.id) continue;

      const chatId = String(msg.chat.id);
      const fromId = String(msg.from?.id || "");
      const text = (msg.text || "").trim();

      if (msg.chat.type === "private") {
        addTarget(chatId);

        if (ADMIN_ID && fromId === String(ADMIN_ID) && text && !text.startsWith("/")) {
          await broadcastMessage(`📢 ADMIN NOTICE 📢\n\n${text}`);
          await sendTelegramMessage(chatId, `✅ ${targets.size}টি চ্যাট/চ্যানেল/গ্রুপে মেসেজ পাঠানো হয়েছে।`);
        } else if (text === "/start") {
          await sendTelegramMessage(chatId, "✅ Wingo 30S Signal Bot সক্রিয় আছে! আপনি নিয়মিত লাইভ সিগন্যাল পাবেন।");
        }
      } else {
        addTarget(chatId);
      }
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }
}

console.log("Bot started...");
generateAndSendSignal();
setInterval(generateAndSendSignal, 5000);
setInterval(pollTelegramUpdates, 3000);

