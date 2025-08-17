// Text ➜ Any File Bot (Node.js + Telegraf)
// Env: BOT_TOKEN=xxxxxxxxx (Render → Environment Variables)

import 'dotenv/config';
import { Telegraf, Markup, session } from 'telegraf';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

const BOT_TOKEN = process.env.BOT_TOKEN || 'REPLACE_WITH_YOUR_TOKEN';
if (!BOT_TOKEN || BOT_TOKEN.startsWith('REPLACE')) {
  console.error('❌ BOT_TOKEN missing. Set env var BOT_TOKEN.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- Supported extensions ---
const SUPPORTED = {
  txt: 'txt',
  py: 'py',
  css: 'css',
  js: 'js',
  html: 'html',
  json: 'json',
  csv: 'csv',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'md',
  pdf: 'pdf',
  xls: 'xlsx',
  xlsx: 'xlsx',
};

function normalizeExt(input) {
  if (!input) return '';
  const e = input.toString().trim().toLowerCase().replace('.', '');
  return SUPPORTED[e] || '';
}

function tsName(prefix, ext) {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${prefix}_${ts}.${ext}`;
}

// ---- File makers ----
function makePlainFile(text, ext) {
  const buf = Buffer.from(text ?? '', 'utf8');
  return { buffer: buf, filename: tsName('text', ext) };
}

function makePdf(text) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () =>
      resolve({ buffer: Buffer.concat(chunks), filename: tsName('text', 'pdf') })
    );

    doc.pipe(stream);
    doc.fontSize(12);
    const lines = (text ?? '').split(/\r?\n/);
    lines.forEach((line) => {
      // pdfkit স্বয়ংক্রিয়ভাবে লাইন ব্রেক হ্যান্ডল করে
      doc.text(line === '' ? ' ' : line, { width: 520 });
    });
    doc.end();
  });
}

async function makeXlsx(text) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Text');
  const lines = (text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => ws.getCell(i + 1, 1).value = line);
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), filename: tsName('text', 'xlsx') };
}

function typeKeyboard() {
  const order = ['txt', 'py', 'css', 'js', 'html', 'json', 'csv', 'xml', 'yaml', 'md', 'pdf', 'xlsx'];
  const rows = [];
  for (let i = 0; i < order.length; i += 4) {
    rows.push(order.slice(i, i + 4).map((e) => Markup.button.callback(e, `ext:${e}`)));
  }
  rows.push([Markup.button.callback('⬅️ Start over', 'startover')]);
  return Markup.inlineKeyboard(rows);
}

async function setCommands(ctx) {
  try {
    await ctx.telegram.setMyCommands([
      { command: 'start', description: 'Open bot menu / welcome' },
      { command: 'generate', description: 'Start text → file generator' },
      { command: 'help', description: 'How to use' },
    ]);
  } catch { /* ignore on some hosting */ }
}

// ---- Handlers ----
bot.start(async (ctx) => {
  await setCommands(ctx);
  const keyboard = Markup.keyboard([
    ['▶️ Start text to File Generate (/generate)'],
    ['ℹ️ More menu', '❓ Help (/help)'],
  ]).resize();

  const msg =
    '👋 *Welcome to Text ➜ Any File Bot!*\n\n' +
    'এখানে যেকোনো টেক্সট থেকে এক ক্লিকে ফাইল বানাতে পারো — txt, py, css, js, html, pdf, xls(xlsx), ইত্যাদি।\n\n' +
    'কীভাবে ব্যবহার করবে:\n' +
    '1) `/generate` চাপো বা নিচের বাটন ব্যবহার করো\n' +
    '2) তোমার টেক্সট পাঠাও\n' +
    '3) ফাইল টাইপ সিলেক্ট করো ✅\n\n' +
    'Ready? 🚀';
  await ctx.reply(msg, { parse_mode: 'Markdown', ...keyboard });
  ctx.session.state = undefined;
  ctx.session.text = undefined;
});

bot.command('help', async (ctx) => {
  const text =
    '🛠 *Help*\n' +
    '- `/generate` → টেক্সট পাঠাও, তারপর টাইপ বাছাই করো।\n' +
    '- Supported: txt, py, css, js, html, json, csv, xml, yaml, md, pdf, xls/xlsx\n' +
    '- অন্য মেসেজ দিলে: “Please /generate click.. Tmi boilo valo moto..”';
  await ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.hears('ℹ️ More menu', async (ctx) => ctx.telegram.sendMessage(ctx.chat.id,
  'More → মূলত Help-ই। উপরের /help দেখো 😊'
));

bot.command('generate', async (ctx) => {
  ctx.session.state = 'await_text';
  ctx.session.text = undefined;
  await ctx.reply('📝 Please enter your text…');
});

bot.hears('▶️ Start text to File Generate (/generate)', (ctx) => bot.handleUpdate({ ...ctx.update, message: { ...ctx.message, text: '/generate' } }));

// Step 1: get text
bot.on('text', async (ctx, next) => {
  if (ctx.message.text?.startsWith('/')) return next();

  if (ctx.session.state === 'await_text') {
    ctx.session.text = ctx.message.text || '';
    ctx.session.state = 'choose_type';
    await ctx.reply('✅ Got it!\n🔽 Choose your file type:', typeKeyboard());
    return;
  }

  if (ctx.session.state === 'choose_type') {
    // allow typed extension (e.g., "txt" or ".pdf")
    const ext = normalizeExt(ctx.message.text);
    if (!ext) {
      await ctx.reply('❌ Unsupported type. Try again ↓', typeKeyboard());
      return;
    }
    await generateAndSend(ctx, ext);
    ctx.session.state = undefined;
    ctx.session.text = undefined;
    return;
  }

  // Fallback
  await ctx.reply('Please /generate click.. Tmi boilo valo moto.. 🙂');
});

// Step 2: choose type via buttons
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  if (data === 'startover') {
    ctx.session.state = 'await_text';
    ctx.session.text = undefined;
    await ctx.editMessageText('📝 Please enter your text…');
    return;
  }

  if (!data.startsWith('ext:')) {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Invalid choice. Try again:', typeKeyboard());
    return;
  }

  const ext = data.split(':')[1];
  await ctx.answerCbQuery();
  await ctx.editMessageText(`📦 Generating \`${ext}\` file…`, { parse_mode: 'Markdown' });
  await generateAndSend(ctx, ext);
  ctx.session.state = undefined;
  ctx.session.text = undefined;
});

async function generateAndSend(ctx, ext) {
  const text = ctx.session.text ?? '';
  let file;

  if (['txt', 'py', 'css', 'js', 'html', 'json', 'csv', 'xml', 'yaml', 'md'].includes(ext)) {
    file = makePlainFile(text, ext);
  } else if (ext === 'pdf') {
    file = await makePdf(text);
  } else if (ext === 'xlsx') {
    file = await makeXlsx(text);
  } else {
    await ctx.reply('❌ Unsupported type.');
    return;
  }

  await ctx.replyWithDocument(
    { source: file.buffer, filename: file.filename },
    { caption: `Here is your \`${ext}\` file ✅`, parse_mode: 'Markdown' }
  );
}

// Any other updates → polite fallback
bot.on('message', async (ctx) => {
  if (!ctx.message.text) {
    await ctx.reply('Please /generate click.. Tmi boilo valo moto.. 🙂');
  }
});

// Start the bot
bot.launch().then(() => console.log('🚀 Bot is running (Telegraf)'));

// Graceful stop (Render restarts, etc.)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
