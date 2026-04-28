const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const port = Number(process.env.PORT) || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const backupDir = path.join(rootDir, "backups");
const dbPath = process.env.DB_PATH || path.join(dataDir, "camp-spending.db");
const transactionTypes = new Set(["deposit", "purchase", "refund", "adjustment"]);

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS campers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cabin TEXT NOT NULL DEFAULT '',
    guardian TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    camper_id TEXT NOT NULL REFERENCES campers(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'purchase', 'refund', 'adjustment')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_camper_id ON transactions(camper_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
`);

app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(rootDir, "styles.css"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(rootDir, "app.js"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, database: path.relative(rootDir, dbPath) });
});

app.get("/api/campers", (_req, res) => {
  res.json({ campers: readCampers() });
});

app.post("/api/campers", (req, res) => {
  const camper = normalizeCamperInput(req.body);

  db.prepare(`
    INSERT INTO campers (id, name, cabin, guardian)
    VALUES (@id, @name, @cabin, @guardian)
  `).run(camper);

  res.status(201).json({ camper, campers: readCampers() });
});

app.put("/api/campers/:id", (req, res) => {
  const camper = normalizeCamperInput({ ...req.body, id: req.params.id });
  const result = db.prepare(`
    UPDATE campers
    SET name = @name,
        cabin = @cabin,
        guardian = @guardian,
        updated_at = datetime('now')
    WHERE id = @id
  `).run(camper);

  if (!result.changes) throw httpError(404, "Camper not found.");
  res.json({ camper, campers: readCampers() });
});

app.delete("/api/campers/:id", (req, res) => {
  const result = db.prepare("DELETE FROM campers WHERE id = ?").run(req.params.id);
  if (!result.changes) throw httpError(404, "Camper not found.");
  res.json({ campers: readCampers() });
});

app.post("/api/campers/:id/transactions", (req, res) => {
  const camperExists = db.prepare("SELECT id FROM campers WHERE id = ?").get(req.params.id);
  if (!camperExists) throw httpError(404, "Camper not found.");

  const transaction = normalizeTransactionInput({ ...req.body, camperId: req.params.id });

  db.prepare(`
    INSERT INTO transactions (id, camper_id, type, amount_cents, date, note)
    VALUES (@id, @camperId, @type, @amountCents, @date, @note)
  `).run(transaction);

  res.status(201).json({ transaction: toClientTransaction(transaction), campers: readCampers() });
});

app.delete("/api/transactions/:id", (req, res) => {
  const result = db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
  if (!result.changes) throw httpError(404, "Transaction not found.");
  res.json({ campers: readCampers() });
});

app.post("/api/import", (req, res) => {
  const campers = Array.isArray(req.body.campers) ? req.body.campers : null;
  if (!campers) throw httpError(400, "Expected a campers array.");

  replaceAllData(campers);
  res.json({ campers: readCampers() });
});

app.post("/api/backups", async (_req, res, next) => {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d+Z$/, "")
      .replace(/[-:]/g, "")
      .replace("T", "-");
    const destination = path.join(backupDir, `camp-spending-${stamp}.db`);

    await db.backup(destination);
    res.json({ file: path.relative(rootDir, destination).replaceAll(path.sep, "/") });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  const message = status >= 500 ? "Something went wrong." : error.message;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`Camp Spending Tracker running at http://localhost:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});

function readCampers() {
  const campers = db.prepare(`
    SELECT id, name, cabin, guardian, created_at AS createdAt, updated_at AS updatedAt
    FROM campers
    ORDER BY lower(name), lower(cabin)
  `).all().map((camper) => ({ ...camper, transactions: [] }));

  const byId = new Map(campers.map((camper) => [camper.id, camper]));
  const transactions = db.prepare(`
    SELECT
      id,
      camper_id AS camperId,
      type,
      amount_cents AS amountCents,
      date,
      note,
      created_at AS createdAt
    FROM transactions
    ORDER BY date DESC, created_at DESC
  `).all();

  transactions.forEach((transaction) => {
    const camper = byId.get(transaction.camperId);
    if (camper) camper.transactions.push(toClientTransaction(transaction));
  });

  return campers;
}

function replaceAllData(rawCampers) {
  const importData = rawCampers.map((camper) => ({
    camper: normalizeCamperInput(camper),
    transactions: Array.isArray(camper.transactions)
      ? camper.transactions.map((transaction) => normalizeTransactionInput(transaction))
      : []
  }));

  const insertCamper = db.prepare(`
    INSERT INTO campers (id, name, cabin, guardian)
    VALUES (@id, @name, @cabin, @guardian)
  `);
  const insertTransaction = db.prepare(`
    INSERT INTO transactions (id, camper_id, type, amount_cents, date, note)
    VALUES (@id, @camperId, @type, @amountCents, @date, @note)
  `);

  const commit = db.transaction((items) => {
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM campers").run();

    items.forEach((item) => {
      insertCamper.run(item.camper);
      item.transactions.forEach((transaction) => {
        insertTransaction.run({ ...transaction, camperId: item.camper.id });
      });
    });
  });

  commit(importData);
}

function normalizeCamperInput(input = {}) {
  const name = cleanText(input.name, 120);
  if (!name) throw httpError(400, "Camper name is required.");

  return {
    id: cleanText(input.id, 80) || `camper-${randomUUID()}`,
    name,
    cabin: cleanText(input.cabin, 80),
    guardian: cleanText(input.guardian, 120)
  };
}

function normalizeTransactionInput(input = {}) {
  const type = cleanText(input.type, 30).toLowerCase();
  if (!transactionTypes.has(type)) throw httpError(400, "Invalid transaction type.");

  return {
    id: cleanText(input.id, 80) || `transaction-${randomUUID()}`,
    camperId: cleanText(input.camperId, 80),
    type,
    amountCents: amountToCents(input.amount ?? input.amountCents / 100),
    date: normalizeDate(input.date),
    note: cleanText(input.note, 220)
  };
}

function amountToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw httpError(400, "Amount must be greater than zero.");
  }
  return Math.round((number + Number.EPSILON) * 100);
}

function normalizeDate(value) {
  const text = cleanText(value, 20);
  if (!text) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, "Date must use YYYY-MM-DD.");
  return text;
}

function toClientTransaction(transaction) {
  return {
    id: transaction.id,
    camperId: transaction.camperId,
    type: transaction.type,
    amount: Number((transaction.amountCents / 100).toFixed(2)),
    date: transaction.date,
    note: transaction.note || "",
    createdAt: transaction.createdAt
  };
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
