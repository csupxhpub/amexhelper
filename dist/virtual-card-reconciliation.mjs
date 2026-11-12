const MERCHANT_DESCRIPTORS = new Map([
  ["newegg com", "newegg"],
  ["pxy neweggg diamond bar ca", "newegg"],
  ["pxy newegg inc diamond bar ca", "newegg"],
  ["msi computer corp us store", "msi"],
  ["pxy bt msi computcity of industry ca", "msi"],
  ["www bestbuy com 888", "bestbuy"],
  ["pxy bestbuycom807richfield mn", "bestbuy"],
  ["tello com", "tello"],
  ["pxy tello us tellatlanta ga", "tello"],
  ["united airlines", "united airlines"],
  ["pxy united airlinhouston tx", "united airlines"],
  ["pxy hilton grand las vegas nv", "hilton grand vacations"],
]);

export function parseVirtualAliasEvidence(text) {
  const entries = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!Array.isArray(entries)) throw new Error("Verified alias evidence must be a JSON array");
  const result = new Map();
  for (const entry of entries) {
    const { card, referenceNumber, chargeDate, postDate, amount, type, virtualCard } = entry || {};
    if (typeof card !== "string" || !card || typeof referenceNumber !== "string" || !referenceNumber.trim()
      || typeof virtualCard !== "string" || !virtualCard.startsWith(`${card}_`) || virtualCard.length <= card.length + 1
      || !Number.isFinite(amount) || !["DEBIT", "CREDIT"].includes(type)) {
      throw new Error("Invalid verified virtual card alias entry");
    }
    strictIsoDate(chargeDate, "Evidence charge date");
    strictIsoDate(postDate, "Evidence post date");
    const key = virtualAliasEvidenceKey(card, referenceNumber, chargeDate, postDate, amount, type);
    if (result.has(key) && result.get(key) !== virtualCard) throw new Error("Conflicting verified virtual card aliases");
    result.set(key, virtualCard);
  }
  return result;
}

function virtualAliasEvidenceKey(card, reference, chargeDate, postDate, amount, type) {
  return JSON.stringify([card, reference, chargeDate, postDate, amount, type]);
}

export function reconcileVirtualCardHistory(rows, virtualTransactions, aliasEvidence = new Map(), matchesMerchantHint = () => false) {
  const groups = new Map();
  const rowGroups = new Map();
  let unmatched = 0;
  let ambiguous = 0;
  for (const transaction of virtualTransactions || []) {
    const money = transaction.transactionAmount;
    const rawAmount = typeof money === "object" ? money?.amount ?? money?.value : money;
    const historyAmount = rawAmount == null || rawAmount === "" ? NaN : Number(String(rawAmount).replace(/[$,\s]/g, ""));
    const chargeDate = isoDatePart(transaction.transactionDate);
    const postDate = isoDatePart(transaction.transactionPostDate);
    const historyType = String(transaction.transactionChargeType || "").toUpperCase();
    const historyMerchant = normalizeVirtualSettlementMerchant(transaction.merchantName);
    const base = rows.flatMap((row, index) => {
      if (!Number.isFinite(historyAmount) || row.amount === "" || row.type !== historyType) return [];
      const rowAmount = Number(row.amount);
      // Virtual settlement credits can report a positive magnitude; ordinary activity reports the signed credit.
      const amountMatches = historyType === "CREDIT"
        ? Math.abs(rowAmount) === Math.abs(historyAmount)
        : rowAmount === historyAmount;
      if (!amountMatches || (money?.currency && row.currency && money.currency !== row.currency)) return [];
      if (row["virtual card"] && row["virtual card"] !== transaction.virtualCard) return [];
      const sameDates = (!chargeDate || (row["charge date"] || row.date) === chargeDate)
        && (!postDate || (row["post date"] || row.date) === postDate);
      return sameDates ? [index] : [];
    });
    const identified = base.filter(index => rows[index]["virtual card"] === transaction.virtualCard);
    const byMerchant = base.filter((index) => {
      const rowMerchant = normalizeVirtualSettlementMerchant(rows[index].description);
      return !historyMerchant || !rowMerchant || rowMerchant.includes(historyMerchant) || historyMerchant.includes(rowMerchant)
        || matchesMerchantHint(transaction.merchantName, rows[index]);
    });
    const candidates = identified.length ? identified : byMerchant.length ? byMerchant : base.length === 1 ? base : [];
    if (!candidates.length) {
      unmatched += 1;
      continue;
    }
    const key = candidates.join(",");
    if (!groups.has(key)) {
      groups.set(key, { candidates, aliases: [] });
      for (const index of candidates) rowGroups.set(index, (rowGroups.get(index) || 0) + 1);
    }
    groups.get(key).aliases.push(transaction.virtualCard);
  }

  for (const { candidates, aliases } of groups.values()) {
    if (candidates.some(index => rowGroups.get(index) !== 1)) {
      ambiguous += aliases.length;
      continue;
    }
    const assignments = matchVirtualAliasEvidence(rows, candidates, aliases, aliasEvidence);
    const balanced = candidates.length === aliases.length;
    for (const index of candidates) {
      const row = rows[index];
      const alias = assignments.get(index);
      if (balanced || alias) row["card type"] = "virtual";
      if (alias) row["virtual card"] = alias;
    }
    ambiguous += aliases.length - assignments.size;
  }
  return { unmatched, ambiguous };
}

function matchVirtualAliasEvidence(rows, candidates, aliases, evidence) {
  const remaining = new Map();
  for (const alias of aliases) remaining.set(alias, (remaining.get(alias) || 0) + 1);
  const assignments = new Map();
  const balanced = candidates.length === aliases.length;
  if (remaining.size > 1 || !balanced) {
    const usedKeys = new Set();
    for (const index of candidates) {
      const row = rows[index];
      const key = virtualAliasEvidenceKey(row.card, row["reference number"], row["charge date"], row["post date"], Number(row.amount), row.type);
      const alias = evidence.get(key);
      if (alias === undefined) continue;
      if (usedKeys.has(key) || !remaining.get(alias)) return new Map();
      usedKeys.add(key);
      remaining.set(alias, remaining.get(alias) - 1);
      assignments.set(index, alias);
    }
  }
  const leftover = [...remaining].filter(([, count]) => count > 0);
  if (balanced && leftover.length === 1) {
    for (const index of candidates) {
      if (!assignments.has(index)) assignments.set(index, leftover[0][0]);
    }
  }
  return assignments;
}

function normalizeVirtualSettlementMerchant(value) {
  const normalized = normalizeMerchantText(value);
  return MERCHANT_DESCRIPTORS.get(normalized) ?? normalized;
}

function normalizeMerchantText(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isoDatePart(value) {
  return String(value || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

function strictIsoDate(value, label) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`${label} is invalid`);
  return text;
}
