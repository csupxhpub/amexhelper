export async function readTransactionPages(firstOffset, readPage) {
  const limit = 100;
  const transactions = [];
  let total = null;
  for (let page = 0; page < 1000; page += 1) {
    const offset = firstOffset + transactions.length;
    const { rows, count } = await readPage(limit, offset);
    if (!Array.isArray(rows)) throw new Error("Transaction page is missing its rows");
    if (count != null) {
      const reported = typeof count === "string" && /^\d+$/.test(count) ? Number(count) : count;
      if (!Number.isSafeInteger(reported) || reported < 0) throw new Error("Invalid transaction page total");
      if (total !== null && reported !== total) throw new Error("Transaction page total changed during export");
      total = reported;
    }
    transactions.push(...rows);
    if (total !== null) {
      if (transactions.length === total) return transactions;
      if (!rows.length || transactions.length > total) throw new Error("Transaction pages do not match the reported total");
    } else if (rows.length < limit) {
      return transactions;
    }
  }
  throw new Error("Transaction pagination exceeded its page limit");
}

export function accountActivityPage(response) {
  const data = response?.activityData;
  if (!data || typeof data !== "object") throw new Error("Account activity response is missing activity data");
  const count = data.totalTransactionCount;
  const groups = data.data ?? (count === 0 || count === "0" ? [] : null);
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group?.transactions))) {
    throw new Error("Account activity response is missing transaction groups");
  }
  return { rows: groups.flatMap(group => group.transactions), count };
}

export function validateVirtualCardHistoryResponse(response) {
  const hasErrors = Array.isArray(response?.errors) ? response.errors.length > 0 : Boolean(response?.errors);
  if (!response || typeof response !== "object" || response.code || response.error || hasErrors) {
    throw new Error("Virtual card history returned an invalid response");
  }
  const hasTotal = response.totalTransactions != null;
  const total = hasTotal ? Number(response.totalTransactions) : null;
  if (hasTotal && (!Number.isInteger(total) || total < 0)) throw new Error("Invalid virtual card history total");
  const transactions = response.settledTransactions?.transactions;
  if (transactions == null && (!hasTotal || total === 0)) {
    return { ...response, settledTransactions: { transactions: [] } };
  }
  if (!Array.isArray(transactions)) throw new Error("Virtual card history response is missing settledTransactions.transactions");
  return response;
}

export function virtualCardHistoryPage(response) {
  const checked = validateVirtualCardHistoryResponse(response);
  return { rows: checked.settledTransactions.transactions, count: checked.totalTransactions };
}

export function virtualCardHistoryIdentity(card, record) {
  const token = String(record?.encrypted_virtual_card_number || "");
  const alias = String(record?.accounting_fields?.accounting_field_7 || "").normalize("NFKC").trim();
  const candidate = String(record?.virtual_card_last_five || "").trim();
  const ending = /^\d{5}$/.test(candidate) ? candidate : "";
  if (!token) return { error: "missing virtual card token" };
  return {
    token,
    ending,
    label: alias ? `${card}_${alias}` : ending ? `${card}_virtual_${ending}` : "",
    warning: alias ? "" : ending ? "missing virtual card alias; using card ending" : "missing virtual card alias and usable ending",
  };
}

export const VIRTUAL_TRANSACTION_HEADERS = [
  "master card", "virtual card", "virtual card ending", "charge date", "post date",
  "merchant", "amount", "currency", "type", "settlement type",
];

export function virtualCardSettlementRows(masterCard, settlements = []) {
  return settlements.map(settlement => {
    const money = settlement.transactionAmount;
    return {
      "master card": masterCard,
      "virtual card": settlement.virtualCard ?? "",
      "virtual card ending": settlement.virtualCardEnding ?? "",
      "charge date": settlement.transactionDate ?? "",
      "post date": settlement.transactionPostDate ?? "",
      merchant: settlement.merchantName ?? "",
      amount: typeof money === "object" ? money?.amount ?? money?.value ?? "" : money ?? "",
      currency: money?.currency ?? "",
      type: settlement.transactionChargeType ?? "",
      "settlement type": settlement.transactionType ?? "",
    };
  }).sort((a, b) => String(a["post date"] || a["charge date"]).localeCompare(String(b["post date"] || b["charge date"]))
    || a["virtual card"].localeCompare(b["virtual card"])
    || String(a["charge date"]).localeCompare(String(b["charge date"]))
    || String(a.merchant).localeCompare(String(b.merchant)));
}
