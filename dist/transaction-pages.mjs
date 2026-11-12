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
  const ending = String(record?.virtual_card_last_five || "").trim();
  if (!token) return { error: "missing virtual card token" };
  if (!alias && !/^\d{5}$/.test(ending)) return { error: "missing virtual card alias and usable ending" };
  return {
    token,
    label: alias ? `${card}_${alias}` : `${card}_virtual_${ending}`,
    warning: alias ? "" : "missing virtual card alias; using card ending",
  };
}
