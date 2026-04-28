const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const state = {
  campers: [],
  selectedCamperId: null,
  query: "",
  statusFilter: "all"
};

const els = {
  totalCampers: document.querySelector("#totalCampers"),
  totalDeposits: document.querySelector("#totalDeposits"),
  totalSpent: document.querySelector("#totalSpent"),
  totalRemaining: document.querySelector("#totalRemaining"),
  visibleCount: document.querySelector("#visibleCount"),
  camperList: document.querySelector("#camperList"),
  camperRowTemplate: document.querySelector("#camperRowTemplate"),
  ledgerRowTemplate: document.querySelector("#ledgerRowTemplate"),
  emptyState: document.querySelector("#emptyState"),
  camperDetail: document.querySelector("#camperDetail"),
  detailMeta: document.querySelector("#detailMeta"),
  detailName: document.querySelector("#detailName"),
  detailBalance: document.querySelector("#detailBalance"),
  camperForm: document.querySelector("#camperForm"),
  camperName: document.querySelector("#camperName"),
  camperCabin: document.querySelector("#camperCabin"),
  camperGuardian: document.querySelector("#camperGuardian"),
  transactionForm: document.querySelector("#transactionForm"),
  transactionType: document.querySelector("#transactionType"),
  transactionAmount: document.querySelector("#transactionAmount"),
  transactionDate: document.querySelector("#transactionDate"),
  transactionNote: document.querySelector("#transactionNote"),
  ledgerRows: document.querySelector("#ledgerRows"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  addCamperBtn: document.querySelector("#addCamperBtn"),
  clearCamperBtn: document.querySelector("#clearCamperBtn"),
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  importCsvInput: document.querySelector("#importCsvInput"),
  backupDbBtn: document.querySelector("#backupDbBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  statusMessage: document.querySelector("#statusMessage")
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function uid(prefix) {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function signedAmount(transaction) {
  const amount = Number(transaction.amount) || 0;
  return transaction.type === "purchase" ? -amount : amount;
}

function camperBalance(camper) {
  return camper.transactions.reduce((sum, transaction) => sum + signedAmount(transaction), 0);
}

function balanceClass(balance) {
  if (balance <= 0) return "balance-zero";
  if (balance < 10) return "balance-low";
  return "balance-good";
}

async function api(path, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

async function loadCampers({ preserveSelection = true } = {}) {
  const previousSelection = state.selectedCamperId;
  const payload = await api("/api/campers");
  state.campers = payload.campers || [];

  const stillSelected = state.campers.some((camper) => camper.id === previousSelection);
  state.selectedCamperId = preserveSelection && stillSelected
    ? previousSelection
    : state.campers[0]?.id ?? null;

  render();
}

function setCampers(campers, selectedCamperId = state.selectedCamperId) {
  state.campers = campers || [];
  const stillSelected = state.campers.some((camper) => camper.id === selectedCamperId);
  state.selectedCamperId = stillSelected ? selectedCamperId : state.campers[0]?.id ?? null;
  render();
}

function setStatus(message, tone = "") {
  els.statusMessage.textContent = message;
  els.statusMessage.dataset.tone = tone;
}

function selectedCamper() {
  return state.campers.find((camper) => camper.id === state.selectedCamperId) || null;
}

function filteredCampers() {
  const query = state.query.trim().toLowerCase();
  return state.campers
    .filter((camper) => {
      const searchable = `${camper.name} ${camper.cabin} ${camper.guardian}`.toLowerCase();
      return !query || searchable.includes(query);
    })
    .filter((camper) => {
      const balance = camperBalance(camper);
      if (state.statusFilter === "positive") return balance > 0;
      if (state.statusFilter === "low") return balance > 0 && balance < 10;
      if (state.statusFilter === "zero") return balance <= 0;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function render() {
  renderSummary();
  renderCampers();
  renderDetail();
}

function renderSummary() {
  const totals = state.campers.reduce(
    (acc, camper) => {
      camper.transactions.forEach((transaction) => {
        const amount = Number(transaction.amount) || 0;
        if (transaction.type === "purchase") acc.spent += amount;
        else acc.deposits += amount;
      });
      acc.remaining += camperBalance(camper);
      return acc;
    },
    { deposits: 0, spent: 0, remaining: 0 }
  );

  els.totalCampers.textContent = state.campers.length;
  els.totalDeposits.textContent = currency.format(totals.deposits);
  els.totalSpent.textContent = currency.format(totals.spent);
  els.totalRemaining.textContent = currency.format(totals.remaining);
}

function renderCampers() {
  const campers = filteredCampers();
  els.visibleCount.textContent = `${campers.length} shown`;
  els.camperList.replaceChildren();

  if (!campers.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list-note";
    empty.textContent = "No campers match the current filters.";
    els.camperList.append(empty);
    return;
  }

  campers.forEach((camper) => {
    const row = els.camperRowTemplate.content.firstElementChild.cloneNode(true);
    const balance = camperBalance(camper);
    row.classList.toggle("active", camper.id === state.selectedCamperId);
    row.querySelector("strong").textContent = camper.name;
    row.querySelector("small").textContent = [camper.cabin, camper.guardian].filter(Boolean).join(" | ") || "No cabin assigned";
    const badge = row.querySelector(".camper-row-balance");
    badge.textContent = currency.format(balance);
    badge.classList.add(balanceClass(balance));
    row.addEventListener("click", () => {
      state.selectedCamperId = camper.id;
      render();
    });
    els.camperList.append(row);
  });
}

function renderDetail() {
  const camper = selectedCamper();
  els.emptyState.hidden = Boolean(camper);
  els.camperDetail.hidden = !camper;

  if (!camper) return;

  const balance = camperBalance(camper);
  els.detailMeta.textContent = camper.cabin || "Camper";
  els.detailName.textContent = camper.name;
  els.detailBalance.textContent = currency.format(balance);
  els.camperName.value = camper.name;
  els.camperCabin.value = camper.cabin;
  els.camperGuardian.value = camper.guardian;
  els.ledgerRows.replaceChildren();

  const transactions = [...camper.transactions].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    return byDate || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  if (!transactions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list-note";
    empty.textContent = "No ledger entries yet.";
    els.ledgerRows.append(empty);
    return;
  }

  transactions.forEach((transaction) => {
    const row = els.ledgerRowTemplate.content.firstElementChild.cloneNode(true);
    const amount = signedAmount(transaction);
    row.querySelector("strong").textContent = labelForType(transaction.type);
    row.querySelector("small").textContent = `${transaction.date}${transaction.note ? ` | ${transaction.note}` : ""}`;
    const amountEl = row.querySelector("span");
    amountEl.textContent = currency.format(amount);
    amountEl.className = amount >= 0 ? "amount-positive" : "amount-negative";
    row.querySelector("button").addEventListener("click", () => {
      deleteTransaction(transaction.id);
    });
    els.ledgerRows.append(row);
  });
}

function labelForType(type) {
  return {
    deposit: "Deposit",
    purchase: "Purchase",
    refund: "Refund",
    adjustment: "Adjustment"
  }[type] || "Entry";
}

async function addCamper() {
  try {
    const payload = await api("/api/campers", {
      method: "POST",
      body: JSON.stringify({
        name: `Camper ${state.campers.length + 1}`,
        cabin: "",
        guardian: ""
      })
    });
    setCampers(payload.campers, payload.camper.id);
    setStatus("Camper added.", "success");
    els.camperName.focus();
    els.camperName.select();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function removeSelectedCamper() {
  const camper = selectedCamper();
  if (!camper) return;

  const confirmed = confirm(`Remove ${camper.name} and all ledger entries?`);
  if (!confirmed) return;

  try {
    const payload = await api(`/api/campers/${encodeURIComponent(camper.id)}`, { method: "DELETE" });
    setCampers(payload.campers);
    setStatus("Camper removed.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function deleteTransaction(transactionId) {
  try {
    const payload = await api(`/api/transactions/${encodeURIComponent(transactionId)}`, { method: "DELETE" });
    setCampers(payload.campers);
    setStatus("Entry deleted.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function exportCsv() {
  const rows = [["camper_name", "cabin", "guardian", "transaction_date", "transaction_type", "amount", "note"]];
  state.campers.forEach((camper) => {
    if (!camper.transactions.length) {
      rows.push([camper.name, camper.cabin, camper.guardian, "", "", "", ""]);
      return;
    }
    camper.transactions.forEach((transaction) => {
      rows.push([camper.name, camper.cabin, camper.guardian, transaction.date, transaction.type, transaction.amount, transaction.note]);
    });
  });

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `camp-spending-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function importCsv(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const campers = campersFromCsv(String(reader.result || ""));
      const payload = await api("/api/import", {
        method: "POST",
        body: JSON.stringify({ campers })
      });
      setCampers(payload.campers);
      setStatus("CSV imported into SQLite.", "success");
      els.importCsvInput.value = "";
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  reader.readAsText(file);
}

function campersFromCsv(text) {
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (!header) return [];

  const indexes = Object.fromEntries(header.map((name, index) => [name.trim().toLowerCase(), index]));
  const byName = new Map();

  body.forEach((row) => {
    const name = row[indexes.camper_name]?.trim() || row[indexes.name]?.trim();
    if (!name) return;

    const cabin = row[indexes.cabin] || "";
    const key = `${name.toLowerCase()}|${cabin.toLowerCase()}`;
    if (!byName.has(key)) {
      byName.set(key, {
        id: uid("camper"),
        name,
        cabin,
        guardian: row[indexes.guardian] || "",
        transactions: []
      });
    }

    const type = (row[indexes.transaction_type] || row[indexes.type] || "").toLowerCase();
    const amount = Number(row[indexes.amount]);
    if (type && amount > 0) {
      byName.get(key).transactions.push({
        id: uid("transaction"),
        type,
        amount,
        date: row[indexes.transaction_date] || row[indexes.date] || today(),
        note: row[indexes.note] || ""
      });
    }
  });

  return Array.from(byName.values());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => item.trim()));
}

async function backupDatabase() {
  try {
    const payload = await api("/api/backups", { method: "POST" });
    setStatus(`Backup created: ${payload.file}`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadSample() {
  const campers = [
    {
      id: uid("camper"),
      name: "Avery Chen",
      cabin: "Cabin 2",
      guardian: "M. Chen",
      transactions: [
        { id: uid("transaction"), type: "deposit", amount: 60, date: today(), note: "Opening balance" },
        { id: uid("transaction"), type: "purchase", amount: 8.75, date: today(), note: "Camp store" }
      ]
    },
    {
      id: uid("camper"),
      name: "Jordan Brooks",
      cabin: "Cabin 5",
      guardian: "R. Brooks",
      transactions: [
        { id: uid("transaction"), type: "deposit", amount: 40, date: today(), note: "Opening balance" },
        { id: uid("transaction"), type: "purchase", amount: 34.5, date: today(), note: "Snacks and shirt" }
      ]
    },
    {
      id: uid("camper"),
      name: "Sam Rivera",
      cabin: "Cabin 1",
      guardian: "L. Rivera",
      transactions: [
        { id: uid("transaction"), type: "deposit", amount: 25, date: today(), note: "Opening balance" }
      ]
    }
  ];

  try {
    const payload = await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ campers })
    });
    setCampers(payload.campers, payload.campers[0]?.id);
    setStatus("Sample data loaded into SQLite.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

els.addCamperBtn.addEventListener("click", addCamper);
els.clearCamperBtn.addEventListener("click", removeSelectedCamper);
els.exportCsvBtn.addEventListener("click", exportCsv);
els.importCsvInput.addEventListener("change", (event) => importCsv(event.target.files[0]));
els.backupDbBtn.addEventListener("click", backupDatabase);
els.sampleBtn.addEventListener("click", loadSample);

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderCampers();
});

els.statusFilter.addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  renderCampers();
});

els.camperForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const camper = selectedCamper();
  if (!camper) return;

  try {
    const payload = await api(`/api/campers/${encodeURIComponent(camper.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: els.camperName.value.trim(),
        cabin: els.camperCabin.value.trim(),
        guardian: els.camperGuardian.value.trim()
      })
    });
    setCampers(payload.campers, camper.id);
    setStatus("Camper saved.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

els.transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const camper = selectedCamper();
  if (!camper) return;

  try {
    const payload = await api(`/api/campers/${encodeURIComponent(camper.id)}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        type: els.transactionType.value,
        amount: Number(els.transactionAmount.value),
        date: els.transactionDate.value || today(),
        note: els.transactionNote.value.trim()
      })
    });

    els.transactionAmount.value = "";
    els.transactionNote.value = "";
    setCampers(payload.campers, camper.id);
    setStatus("Entry added.", "success");
    els.transactionAmount.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

els.transactionDate.value = today();
setStatus("Loading local database...");
loadCampers({ preserveSelection: false })
  .then(() => setStatus("Ready.", "success"))
  .catch((error) => setStatus(error.message, "error"));
