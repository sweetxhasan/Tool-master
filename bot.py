import os
import openpyxl
from reportlab.pdfgen import canvas
from PyPDF2 import PdfReader
from telegram import Update, InputFile, BotCommand
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, ContextTypes
)

TOKEN = os.getenv("BOT_TOKEN")  # Render/Server এ env var এ রাখো


# --- START ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome_msg = (
        "👋 **Welcome to Word & File Bot!**\n\n"
        "📌 আমি আপনার জন্য যা করতে পারি:\n"
        "1️⃣ **Word Counter** ➝ আপনার লেখা বা ফাইলের শব্দ/character count করে দিবো।\n"
        "2️⃣ **Text To File** ➝ আপনার লেখা নিয়ে txt / pdf / py / xlsx ফাইল বানিয়ে দিবো।\n\n"
        "👉 নিচের মেনু থেকে আপনার কাজ বেছে নিন।"
    )
    await update.message.reply_text(welcome_msg, parse_mode="Markdown")


# --- WORD COUNTER ---
async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📝 Please enter your words or send a file...")

async def process_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    words = len(text.split())
    chars = len(text)
    lines = text.count("\n") + 1
    await update.message.reply_text(f"✅ Words: {words}\n🔡 Characters: {chars}\n📏 Lines: {lines}")


async def process_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    file = await update.message.document.get_file()
    filename = file.file_path.split("/")[-1]
    await file.download_to_drive(filename)

    text_content = ""
    try:
        if filename.endswith(".txt") or filename.endswith(".py"):
            with open(filename, "r", encoding="utf-8") as f:
                text_content = f.read()

        elif filename.endswith(".xlsx"):
            wb = openpyxl.load_workbook(filename)
            ws = wb.active
            for row in ws.iter_rows(values_only=True):
                text_content += " ".join([str(cell) for cell in row if cell]) + "\n"

        elif filename.endswith(".pdf"):
            reader = PdfReader(filename)
            for page in reader.pages:
                text_content += page.extract_text() + "\n"

        if text_content.strip():
            words = len(text_content.split())
            chars = len(text_content)
            lines = text_content.count("\n") + 1
            await update.message.reply_text(
                f"📄 File: {filename}\n✅ Words: {words}\n🔡 Chars: {chars}\n📏 Lines: {lines}"
            )
        else:
            await update.message.reply_text("⚠️ Could not extract text from this file.")
    except Exception as e:
        await update.message.reply_text(f"⚠️ Error reading file: {e}")

    os.remove(filename)


# --- TEXT TO FILE ---
async def tofile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "✍️ Please enter your text and file type\n\n"
        "Example:\n"
        "`Hello World .txt`\n"
        "`print(\"Hi\") py`\n"
        "`This is PDF pdf`\n",
        parse_mode="Markdown"
    )
    context.user_data["awaiting_text"] = True


async def make_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get("awaiting_text"):
        return
    
    msg = update.message.text.strip()
    parts = msg.rsplit(" ", 1)  # শেষ শব্দটাই ধরব ফাইল টাইপ হিসেবে
    if len(parts) < 2:
        await update.message.reply_text("⚠️ Please provide text and file type (example: Hello World .txt)")
        return

    text, filetype = parts
    filetype = filetype.lower().replace(".", "")

    filename = None

    try:
        if filetype == "txt":
            filename = "output.txt"
            with open(filename, "w", encoding="utf-8") as f:
                f.write(text)

        elif filetype == "pdf":
            filename = "output.pdf"
            c = canvas.Canvas(filename)
            c.drawString(100, 750, text)
            c.save()

        elif filetype == "py":
            filename = "output.py"
            with open(filename, "w", encoding="utf-8") as f:
                f.write(text)

        elif filetype == "xlsx":
            filename = "output.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws["A1"] = text
            wb.save(filename)

        if filename:
            await update.message.reply_document(document=InputFile(filename))
            os.remove(filename)
        else:
            await update.message.reply_text("⚠️ Unknown file type! Use txt/pdf/py/xlsx")

    except Exception as e:
        await update.message.reply_text(f"⚠️ Error creating file: {e}")

    context.user_data["awaiting_text"] = False


# --- MAIN ---
if __name__ == "__main__":
    app = Application.builder().token(TOKEN).build()

    # Menu Commands
    commands = [
        BotCommand("start", "Open Bot Menu"),
        BotCommand("count", "Word Counter"),
        BotCommand("tofile", "Text To File"),
    ]
    app.bot.set_my_commands(commands)

    # Handlers
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("count", count))
    app.add_handler(CommandHandler("tofile", tofile))

    app.add_handler(MessageHandler(filters.Document.ALL, process_file))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, make_file))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, process_text))

    print("🤖 Bot running...")
    app.run_polling()