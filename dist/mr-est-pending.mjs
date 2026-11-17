// Source rules: https://www.americanexpress.com/us/rewards-info/business.html
// Business Gold: top two eligible categories per statement, $150k/year at 4x.
// Business Platinum: eligible categories or a single $5k purchase, $2m/year at 2x.
const BG = new Set(['electronics', 'advertising', 'gas', 'restaurant', 'wireless', 'transit']);
const BP = new Set(['electronics', 'construction', 'shipping']);
const US = /^(?:US|USA|UNITED STATES|UNITED STATES OF AMERICA)$/i;

export function mrAccountDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function rewardCategory(transaction) {
  const merchant = transaction.extendedDetails?.merchant;
  const country = merchant?.address?.countryName || merchant?.address?.countryCode || '';
  const detail = transaction.extendedDetails?.category;
  const category = `${detail?.categoryName || ''} ${detail?.subcategoryName || ''}`.trim();
  const description = String(transaction.displayDescription || transaction.description || '');
  if (String(transaction.subType).toLowerCase() === 'payment' || /\b(?:(?:ONLINE|MOBILE|AUTOPAY) PAYMENT|THANK YOU FOR YOUR PAYMENT|PAYMENT RECEIVED)\b/i.test(description)) return 'excluded';
  if (/\b(?:statement credit|wireless credit|airline fee reimbursement|hotel credit|purchase with MR points|points for amex trvl|ADJ REDIST|ADJ FOR BALANCE)\b/i.test(description)) return 'excluded';
  if (String(transaction.type).toUpperCase() === 'CREDIT' && /\bpay with points\b/i.test(description)) return 'excluded';
  if (/\b(?:annual fee|membership fee|late fee|interest charge|cash advance)\b/i.test(description)) return 'excluded';
  if (String(transaction.type).toUpperCase()==='CREDIT' && /\b(?:FLEXIBLE BUSINESS CREDIT|WALMART PLUS MONTHLY)\b/i.test(description)) return 'excluded';
  // Membership subscriptions / office-supply stores are outside both bonus
  // category lists; a BP single purchase >=$5k is still handled separately.
  if (/\b(?:AMAZON PRIME|WALMART\+? MEMB(?:\d{10})?|WMT PLUS|STAPLES(?:\.COM)?)\b/i.test(description)) return 'other';
  if (!country) return null;
  const transit = /\b(?:transit|parking|taxicab|taxi|rideshar|tolls?|bus|subway|train|ferr)\b/i.test(category);
  if (!US.test(country)) return transit ? 'transit' : 'other';
  if (/\b(?:electronic|computer hardware|computer software|software|cloud computing)\b/i.test(category)) return 'electronics';
  // Amex gives these two merchants as examples of electronic goods retailers.
  if (/\b(?:NEWEGG|DELL(?: TECHNOLOGIES)?)\b/i.test(description)) return 'electronics';
  if (/\badvertis/i.test(category)) return 'advertising';
  if (/\b(?:gas station|service station|fuel)\b/i.test(category)) return 'gas';
  if (/\brestaurant\b/i.test(category)) return 'restaurant';
  if (/\b(?:wireless|cellular|mobile telephone)\b/i.test(category)) return 'wireless';
  if (transit) return 'transit';
  if (/\b(?:construction material|hardware suppl|building suppl)\b/i.test(category)) return 'construction';
  if (/\b(?:shipping|courier|freight)\b/i.test(category)) return 'shipping';
  // Coarse account-activity categories cannot establish bonus eligibility.
  return null;
}

function cents(value) {
  const text = String(value ?? '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw Error('INVALID_AMOUNT');
  return Math.round(Number(text) * 100);
}

function activityRewardRate(transaction) {
  if (transaction.message?.id !== 'points') return null;
  const label = String(transaction.message.rewardRate ?? '').trim();
  if (!/^\d+(?:\.\d+)?X?$/i.test(label)) return null;
  const rate = Number(label.replace(/X$/i, ''));
  return Number.isFinite(rate) && rate >= 1 ? rate : null;
}

export function mergeTransactionEvidence(transactions, reread) {
  const byId = new Map(), duplicates = new Set();
  for (const t of reread) {
    if (byId.has(t.identifier) || duplicates.has(t.identifier)) { byId.delete(t.identifier); duplicates.add(t.identifier); }
    else byId.set(t.identifier, t);
  }
  return transactions.map(t => {
    const other = byId.get(t.identifier);
    if (!t.identifier || !other || t.type !== other.type || t.status !== other.status
        || t.postDate !== other.postDate || t.chargeDate !== other.chargeDate
        || t.displayDate !== other.displayDate || t.statementEndDate !== other.statementEndDate
        || t.displayDescription !== other.displayDescription || t.description !== other.description
        || t.transactionAmount?.currency !== other.transactionAmount?.currency
        || String(t.transactionAmount?.amount) !== String(other.transactionAmount?.amount)) return t;
    const result = {...t};
    if (activityRewardRate(t) === null && activityRewardRate(other) !== null) result.message = other.message;
    const a=t.extendedDetails||{}, b=other.extendedDetails||{};
    const present = value => Object.fromEntries(Object.entries(value||{}).filter(([,v]) => v !== undefined && v !== null && v !== ''));
    result.extendedDetails={...a,category:{...present(b.category),...present(a.category)},merchant:{...a.merchant,address:{...present(b.merchant?.address),...present(a.merchant?.address)}}};
    return result;
  });
}

// A conservative upper bound is useful only with the original pending floor:
// if even this maximum cannot exceed QUALIFIED, the final total is proven to
// equal original pending. It does not assert an unknown purchase's exact rate.
export function unbilledPointsUpperBound({product,transactions,statementStart,statementEnd,now}) {
  if (!['bg','bp'].includes(product) || !/^\d{4}-\d{2}-\d{2}$/.test(statementStart||'') || !/^\d{4}-\d{2}-\d{2}$/.test(statementEnd||'') || statementStart>statementEnd || statementStart>now || statementEnd<now) return null;
  const seen=new Set();let upper=0;
  try {for(const t of transactions) {
    if(String(t.status).toUpperCase()!=='POSTED')continue;
    const date=String(t.postDate||t.displayDate||t.chargeDate||'').slice(0,10);
    if(!t.identifier||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
    if(date<statementStart||date>statementEnd||date>now||seen.has(t.identifier))continue;
    if(t.statementEndDate&&String(t.statementEndDate).slice(0,10)!==statementEnd)return null;
    seen.add(t.identifier);
    if(rewardCategory(t)==='excluded')continue;
    if(t.transactionAmount?.currency!=='USD')return null;
    const type=String(t.type).toUpperCase();if(!['DEBIT','CREDIT'].includes(type))return null;
    if(type==='CREDIT')continue; // ignoring deductions can only increase the bound
    const amount=Math.abs(cents(t.transactionAmount.amount));
    const explicit=activityRewardRate(t);
    // Missing BP metadata could conceal 5X travel. A merchant-name guess
    // cannot establish a smaller upper bound. Explicit rates can exceed 5X.
    const known=Number.isFinite(explicit)&&explicit>=1;
    const maximum=known?Math.max(explicit,product==='bg'?4:2):product==='bg'?4:5;
    upper+=Math.round(amount/100)*maximum;
  }}catch{return null;}
  return upper;
}

function isPayWithPointsCredit(transaction) {
  return String(transaction.type).toUpperCase() === 'CREDIT'
    && String(transaction.displayDescription || transaction.description || '').trim().toUpperCase() === 'AMEX TRAVEL PAY WITH POINTS CREDIT';
}

function postedInStatement(transaction, { statementStart, now }) {
  const date = statementDate(transaction.postDate || transaction.displayDate || transaction.chargeDate);
  return String(transaction.status).toUpperCase() === 'POSTED' && date >= statementStart && date <= now;
}

function excludeConfirmedTravelRedemptions(transactions, now, transactionPoints) {
  const pairs = new Map();
  for (const transaction of transactions) {
    const description = String(transaction.displayDescription || transaction.description || '').trim().toUpperCase();
    const type = String(transaction.type).toUpperCase();
    const debit = type === 'DEBIT' && description === 'PWP AMERICAN EXPRPHOENIX AZ';
    const credit = isPayWithPointsCredit(transaction);
    if ((!debit && !credit) || String(transaction.status).toUpperCase() !== 'POSTED'
        || !transaction.identifier || !transaction.chargeDate || !transaction.statementEndDate
        || !transaction.postDate || transaction.postDate.slice(0, 10) > now
        || transaction.transactionAmount?.currency !== 'USD') continue;
    let amount;
    try { amount = Math.abs(cents(transaction.transactionAmount.amount)); } catch { continue; }
    if (!amount) continue;
    const key = JSON.stringify([transaction.chargeDate, transaction.statementEndDate, amount]);
    const pair = pairs.get(key) || {debits: [], credits: []};
    (debit ? pair.debits : pair.credits).push(transaction);
    pairs.set(key, pair);
  }
  const excluded = new Set();
  for (const {debits, credits} of pairs.values()) {
    if (debits.length === 1 && credits.length === 1 && debits[0].message?.id !== 'points'
        && !(transactionPoints?.get(debits[0].identifier) > 0)
        && !(transactionPoints?.get(credits[0].identifier) < 0)
        && debits[0].identifier !== credits[0].identifier) excluded.add(debits[0]);
  }
  return transactions.filter(transaction => !excluded.has(transaction));
}

export function estimateUnbilledPoints({ product, transactions, statementStart, statementEnd, year, openedDate, now = mrAccountDate(), transactionPoints, projectableBase }) {
  if (!['bg', 'bp'].includes(product)) return { points: null, reason: 'UNSUPPORTED_PRODUCT' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementStart || '') || !/^\d{4}-\d{2}-\d{2}$/.test(statementEnd || '')
      || statementStart > now || statementEnd < now || statementStart > statementEnd) return { points: null, reason: 'CURRENT_STATEMENT_UNAVAILABLE' };
  let payWithPointsAdjustment = 0;
  const seenCredits = new Set();
  for (const transaction of transactions) {
    if (!isPayWithPointsCredit(transaction) || !postedInStatement(transaction, { statementStart, now })) continue;
    const points = transactionPoints?.get(transaction.identifier);
    if (!Number.isSafeInteger(points) || points > 0
        || (transaction.statementEndDate && statementDate(transaction.statementEndDate) !== statementEnd)) {
      return { points: null, reason: 'PWP_REWARD_ADJUSTMENT_UNVERIFIED' };
    }
    if (seenCredits.has(transaction.identifier)) continue;
    seenCredits.add(transaction.identifier);
    payWithPointsAdjustment += points;
  }
  transactions = excludeConfirmedTravelRedemptions(transactions, now, transactionPoints);
  if (transactionPoints?.size || transactions.some(t => activityRewardRate(t) !== null)) {
    const result = estimateFromRewardRates({product,transactions,statementStart,statementEnd,year,openedDate,now,transactionPoints,projectableBase});
    if (result.points !== null && seenCredits.size) {
      result.points += payWithPointsAdjustment;
      result.audit = { ...result.audit, payWithPointsAdjustment };
    }
    return result;
  }
  const seen = new Set(), entries = [];
  try {
    for (const t of transactions) {
      if (String(t.status).toUpperCase() !== 'POSTED') continue;
      const date = String(t.postDate || t.displayDate || t.chargeDate || '').slice(0, 10);
      if (!date || !t.identifier) return { points: null, reason: 'MISSING_DATE_OR_ID' };
      if (date > now || date < `${year}-01-01`) continue;
      if (seen.has(t.identifier)) continue;
      seen.add(t.identifier);
      const category = rewardCategory(t);
      if (category === 'excluded') continue;
      const value = t.transactionAmount;
      if (value?.currency !== 'USD') return { points: null, reason: 'UNKNOWN_CURRENCY' };
      const type = String(t.type).toUpperCase();
      if (!['DEBIT','CREDIT'].includes(type)) return { points: null, reason: 'UNKNOWN_TRANSACTION_TYPE' };
      const amount = Math.abs(cents(value.amount)) * (type === 'CREDIT' ? -1 : 1);
      const period = String(t.statementEndDate || '').slice(0, 10);
      const current = date >= statementStart && date <= statementEnd;
      if (current && period && period !== statementEnd) return { points: null, reason: 'STATEMENT_DATE_CONFLICT' };
      if (!current && product === 'bg' && !period) return { points: null, reason: 'HISTORICAL_STATEMENT_UNAVAILABLE' };
      entries.push({ amount, category, current, period: current ? statementEnd : period, date, id: t.identifier });
    }
  } catch { return { points: null, reason: 'INVALID_AMOUNT' }; }
  const current = entries.filter(t => t.current);
  if (!current.length) return { points: 0, reason: '' };
  // Refund reward reversals and their original cap allocation are not present
  // in account activity. Do not release bonus capacity on an unproven basis.
  if (entries.some(t => t.amount < 0)) {
    // BP eligibility can be bounded without historical rewardRate labels.
    // Historical refunds must not invalidate an estimate when every possible
    // cap allocation gives the same result; current real refunds stay unknown.
    if (product === 'bp' && !current.some(t => t.amount < 0)) {
      return estimateFromRewardRates({product,transactions,statementStart,statementEnd,year,openedDate,now});
    }
    return { points: null, reason: 'REFUND_REQUIRES_REWARD_ALLOCATION' };
  }
  const allowed = product === 'bg' ? BG : BP;
  const unknown = t => !t.category && !(product === 'bp' && t.amount >= 500000);
  if (current.some(unknown)) {
    return { points: null, reason: 'BONUS_ELIGIBILITY_UNRESOLVED' };
  }
  if (entries.some(unknown)) return { points: null, reason: 'ANNUAL_BONUS_CAP_UNCERTAIN' };
  const periods = new Map();
  if (product === 'bg') {
    for (const t of entries) {
      if (!allowed.has(t.category)) continue;
      const totals = periods.get(t.period) || new Map();
      totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
      periods.set(t.period, totals);
    }
    for (const [period, totals] of periods) periods.set(period, new Set([...totals].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,2).map(([k])=>k)));
  }
  let remaining = product === 'bg' ? 15000000 : 200000000, pointsCents = 0;
  for (const t of entries.sort((a,b)=>a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const eligible = product === 'bg' ? periods.get(t.period)?.has(t.category) : BP.has(t.category) || t.amount >= 500000;
    const bonusAmount = eligible ? Math.min(t.amount, remaining) : 0;
    if (eligible) remaining -= bonusAmount;
    if (t.current) pointsCents += t.amount + bonusAmount * (product === 'bg' ? 3 : 1);
  }
  return { points: Math.round(pointsCents/100), reason: '' };
}

// Account activity supplies an explicit points rewardRate (observed 2X/4X/5X).
// It can still show 4X beyond the annual limit, so always apply the limit.
// Bound unknown historical categories and refunds instead of treating them as
// proven qualifying spend. Publish only when both bounds round identically.
export function estimateFromRewardRates({product,transactions,statementStart,statementEnd,year,openedDate,now,transactionPoints,projectableBase}) {
  const unavailable=reason=>({points:null,reason});
  const normalized=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const merchant=t=>normalized(t.displayDescription||t.description);
  const seen=new Set(), entries=[];
  try { for(const t of transactions){
    if(String(t.status).toUpperCase()!=='POSTED')continue;
    const date=String(t.postDate||t.displayDate||t.chargeDate||'').slice(0,10);
    if(!t.identifier||!/^\d{4}-\d{2}-\d{2}$/.test(date))return unavailable('MISSING_DATE_OR_ID');
    if(date<`${year}-01-01`||date>now||seen.has(t.identifier))continue;
    seen.add(t.identifier);
    if(rewardCategory(t)==='excluded')continue;
    if(t.transactionAmount?.currency!=='USD')return unavailable('UNKNOWN_CURRENCY');
    const type=String(t.type).toUpperCase();if(!['DEBIT','CREDIT'].includes(type))return unavailable('UNKNOWN_TRANSACTION_TYPE');
    const value=Math.abs(cents(t.transactionAmount.amount));
    if(!value)continue;
    const current=date>=statementStart&&date<=statementEnd;
    if(current&&t.statementEndDate&&String(t.statementEndDate).slice(0,10)!==statementEnd)return unavailable('STATEMENT_DATE_CONFLICT');
    entries.push({t,date,current,value,type,rate:activityRewardRate(t),merchant:merchant(t)});
  }}catch{return unavailable('INVALID_AMOUNT');}
  const current=entries.filter(e=>e.current);
  if(!current.length)return {points:0,reason:''};
  const bonusRate=product==='bg'?4:2, limit=product==='bg'?15000000:200000000;
  let refundPoints=0;
  const family=merchant=>{for(const name of ['DELL','NEWEGG','MSI'])if(new RegExp(`\\b${name}`).test(merchant))return name;return merchant;};
  const grossUpper=entries.filter(e=>e.type==='DEBIT').reduce((s,e)=>s+e.value,0);
  for(const refund of current.filter(e=>e.type==='CREDIT')){
    const points=transactionPoints?.get(refund.t.identifier);
    if(Number.isSafeInteger(points)){refundPoints-=points;continue;}
    // A partial refund can be valued without inventing an exact original ID
    // only when the complete card lifetime is present, the cap cannot bind,
    // and EVERY possible prior purchase at this retailer has the same rate.
    if(String(openedDate||'').slice(0,4)!==String(year)||grossUpper>limit)return unavailable('CURRENT_REFUND_REQUIRES_REWARD_ALLOCATION');
    const candidates=entries.filter(e=>e.type==='DEBIT'&&e.date<=refund.date&&family(e.merchant)===family(refund.merchant));
    const rates=new Set(candidates.map(e=>e.rate));
    const refunded=entries.filter(e=>e.type==='CREDIT'&&e.date<=refund.date&&family(e.merchant)===family(refund.merchant)).reduce((s,e)=>s+e.value,0);
    if(!candidates.length||rates.size!==1||!Number.isFinite(candidates[0].rate)||candidates[0].rate<1||candidates.reduce((s,e)=>s+e.value,0)<refunded)return unavailable('CURRENT_REFUND_REQUIRES_REWARD_ALLOCATION');
    refundPoints+=Math.round(refund.value/100)*candidates[0].rate;
  }
  const verifiedMerchants=new Set(entries.filter(e=>e.rate===bonusRate && (product==='bg'||e.value<500000)).map(e=>e.merchant));
  const historicalCategories = new Map();
  if (projectableBase?.size) {
    for (const e of entries) {
      if (e.current || e.type !== 'DEBIT' || !e.merchant) continue;
      // Reuse the established electronics merchant names when a historical
      // purchase on this card actually received 4X.
      const category = rewardCategory(e.t)
        ?? (e.rate === 4 && /\b(?:NEWEGG|DELL|MSI COMPUTER)\b/.test(e.merchant) ? 'electronics' : null);
      if (!category) continue;
      const evidence = historicalCategories.get(e.merchant) ?? { categories: new Set(), hasBonus: false };
      evidence.categories.add(category);
      if (e.rate === 4 && BG.has(category)) evidence.hasBonus = true;
      historicalCategories.set(e.merchant, evidence);
    }
  }
  function projectedCategory(e) {
    const direct = rewardCategory(e.t);
    if (direct) return direct;
    const history = historicalCategories.get(e.merchant);
    if (history?.hasBonus && history.categories.size === 1) return history.categories.values().next().value;
    return null;
  }
  const projectedSpendByCategory = new Map();
  let unclassifiedSpend = 0;
  let currentCredits = 0;
  for (const e of projectableBase?.size ? current : []) {
    if (e.type === 'CREDIT') {
      currentCredits += e.value;
      continue;
    }
    const category = projectedCategory(e);
    if (BG.has(category)) projectedSpendByCategory.set(category, (projectedSpendByCategory.get(category) ?? 0) + e.value);
    else if (!category) unclassifiedSpend += e.value;
  }
  function inProvenTopTwo(category) {
    if (!BG.has(category)) return false;
    const lowerSpend = (projectedSpendByCategory.get(category) ?? 0) - currentCredits;
    if (lowerSpend <= 0) return false;
    return [...BG].filter(other => other !== category
      && (projectedSpendByCategory.get(other) ?? 0) + unclassifiedSpend >= lowerSpend).length < 2;
  }
  const observedCategory=e=>{
    for(const name of ['NEWEGG','DELL','MSI COMPUTER'])if(e.merchant.includes(name)&&[...verifiedMerchants].some(m=>m.includes(name)))return 'electronics';
    return rewardCategory(e.t);
  };
  const currentCategorySpend=new Map();
  for(const e of current){const category=observedCategory(e);if(BG.has(category))currentCategorySpend.set(category,(currentCategorySpend.get(category)||0)+e.value);}
  const topTwo=new Set([...currentCategorySpend].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,2).map(([c])=>c));
  const unclassifiedCurrentBonus=current.some(e=>e.rate===4&&!BG.has(observedCategory(e)));
  function inheritedEligibility(e){
    if(product==='bp')return true;
    // A previous cycle's top category does not automatically stay in the top
    // two. Historical unlabeled purchases remain an annual-cap upper bound.
    if(!e.current||unclassifiedCurrentBonus)return null;
    const category=observedCategory(e);return BG.has(category)?topTwo.has(category):null;
  }
  function eligibility(e){
    if(e.rate>1&&e.rate!==bonusRate)return false;
    if(e.rate===bonusRate)return true;
    if(product==='bp'&&e.value>=500000)return true;
    if(product==='bp'&&/\bTELLO\b/.test(e.merchant))return false; // wireless is not a BP bonus category
    if(verifiedMerchants.has(e.merchant))return inheritedEligibility(e);
    // Merchant statements change city strings. Only carry over a category
    // after observing that same named retailer earning the relevant bonus.
    for(const name of ['NEWEGG','DELL','MSI COMPUTER']){
      if(e.merchant.includes(name)&&[...verifiedMerchants].some(m=>m.includes(name)))return inheritedEligibility(e);
    }
    if(e.rate===1)return false;
    const category=rewardCategory(e.t);
    if(category==='other')return false;
    if(product==='bp'&&category)return BP.has(category);
    return null;
  }
  let known=0,unknown=0,refunds=0,base=0,bonus=0,higher=0,unallocatedSpend=0;
  const bonusEntries=[];
  const projectedEntries = [];
  for(const e of entries){
    if(!e.current){
      if(e.type==='CREDIT'){refunds+=e.value;continue;}
      const eligible=eligibility(e);if(eligible===true)known+=e.value;else if(eligible===null)unknown+=e.value;
      continue;
    }
    if(e.type==='CREDIT')continue;
    const points=transactionPoints?.get(e.t.identifier);
    if ((product === 'bg' || e.rate === null) && Number.isSafeInteger(points)) {
      base+=points;
      const knownBase = points === Math.round(e.value / 100) && rewardCategory(e.t) === 'other'
        && (product === 'bg' || e.value < 500000);
      if (!knownBase) unallocatedSpend+=e.value;
      if (projectableBase?.has(e.t.identifier) && inProvenTopTwo(projectedCategory(e))) projectedEntries.push(e);
      continue;
    }
    base+=Math.round(e.value/100);
    if(e.rate>1&&e.rate!==bonusRate){higher+=Math.round(e.value/100)*(e.rate-1);continue;}
    const eligible=eligibility(e);
    if(eligible===null)return unavailable('CURRENT_BONUS_ELIGIBILITY_UNRESOLVED');
    if(eligible){bonus+=e.value;bonusEntries.push(e);}
  }
  const minimumRemaining=Math.max(0,limit-known-unknown-unallocatedSpend);
  const maximumRemaining=Math.max(0,limit-Math.max(0,known-refunds));
  const calculate=remaining=>{let result=base+higher-refundPoints;for(const e of bonusEntries.sort((a,b)=>a.date.localeCompare(b.date)||a.t.identifier.localeCompare(b.t.identifier))){const allocation=Math.min(remaining,e.value);remaining-=allocation;result+=Math.round(allocation/100)*(bonusRate-1);}return result;};
  const low=calculate(minimumRemaining),high=calculate(maximumRemaining);
  if(low!==high)return unavailable('ANNUAL_BONUS_CAP_UNCERTAIN');
  // Reserve capacity for other current spending before projecting any uplift.
  // Add only the per-transaction bonus that agrees under both cap bounds.
  const projectedSpend = projectedEntries.reduce((sum, entry) => sum + entry.value, 0);
  let lowForProjections = Math.max(0, limit - known - unknown - unallocatedSpend + projectedSpend - bonus);
  let highForProjections = Math.max(0, maximumRemaining - bonus);
  let projectedBonusPoints = 0;
  for (const entry of projectedEntries.sort((a, b) => a.date.localeCompare(b.date) || a.t.identifier.localeCompare(b.t.identifier))) {
    const lowAllocation = Math.min(lowForProjections, entry.value);
    const highAllocation = Math.min(highForProjections, entry.value);
    lowForProjections -= lowAllocation;
    highForProjections -= highAllocation;
    const extra = Math.round(lowAllocation / 100) * 3;
    if (extra === Math.round(highAllocation / 100) * 3) projectedBonusPoints += extra;
  }
  return {points:low+projectedBonusPoints,reason:'',audit:{unbilledBasePoints:base,bonusEligibleCents:bonus,projectedBonusPoints,currentRefundPoints:refundPoints,annualKnownEligibleCents:known,annualUnknownCents:unknown,annualRefundCents:refunds}};
}

export function sumEstimates(rows) {
  if (rows.some(r => r['est pending'] === '' || r['est pending'] == null || !Number.isFinite(Number(r['est pending'])))) return '';
  return rows.reduce((sum,r)=>sum+Number(r['est pending']),0);
}

export function pendingBreakdown(response) {
  if (response?.status?.code !== '0000') throw Error('PENDING_BREAKDOWN_UNAVAILABLE');
  let billed = 0, unbilled = 0;
  const seen = new Set();
  for (const row of response.summary || []) {
    if (row.summariesBy?.transactionCategory !== 'REWARD') continue;
    const status = row.summariesBy.transactionStatus;
    if (!['PENDING','QUALIFIED'].includes(status)) throw Error('UNKNOWN_PENDING_STATUS');
    if (seen.has(status)) throw Error('DUPLICATE_PENDING_STATUS');
    seen.add(status);
    const value = row.totalAmount?.amount?.value;
    if (value === '' || value == null || !Number.isFinite(Number(value))) throw Error('PENDING_BREAKDOWN_AMOUNT_UNAVAILABLE');
    if (status === 'PENDING') billed = Number(value);
    else unbilled = Number(value);
  }
  if (seen.size !== 2) throw Error('PENDING_BREAKDOWN_INCOMPLETE');
  return { billed, unbilled };
}

export function combinePendingEstimate(originalPending, billedPending, originalUnbilled, recalculatedUnbilled) {
  if ([originalPending,billedPending,originalUnbilled,recalculatedUnbilled].some(v => v === '' || v == null || !Number.isFinite(Number(v)))) return '';
  const [original,billed,unbilled,recalculated] = [originalPending,billedPending,originalUnbilled,recalculatedUnbilled].map(Number);
  if (Math.abs(billed + unbilled - original) > 0.000001) return '';
  return Math.max(original, billed + recalculated);
}

const MR_REWARD_RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

export async function readQualifiedRewardTransactions(readPage) {
  const records = [];
  let expectedCount;
  for (let offset = 0, page = 0; page < 100; page++) {
    const result = await readPage({ productType: 'AEXP_CARD_ACCOUNT', category: 'REWARD', transactionsFor: 'LOYALTY_ACCOUNT', period: 'P2M', offset, limit: 100 });
    const count = result.metadata?.totalRecords;
    const rows = result.transactions;
    if (page === 0 && count === 0 && Array.isArray(rows) && !rows.length && ['0000', '0004'].includes(result.status?.code)) return [];
    if (result.status?.code !== '0000' || !Number.isSafeInteger(count) || !Array.isArray(rows) || !rows.length) throw Error('MR_REWARD_TRANSACTIONS_INCOMPLETE');
    expectedCount ??= count;
    if (count !== expectedCount) break;
    records.push(...rows);
    if (records.length === count) return records;
    if (records.length > count) break;
    offset = result.metadata.nextIndex > offset ? result.metadata.nextIndex : offset + rows.length;
  }
  throw Error('MR_REWARD_TRANSACTIONS_INCOMPLETE');
}

function pointsForTransactions(input, rewards) {
  const candidates = new Map();
  for (const reward of rewards) {
    if (!reward.id || reward.category !== 'REWARD' || !['BASE', 'ACCELERATED'].includes(reward.type) || reward.status !== 'QUALIFIED') continue;
    candidates.set(reward.id, candidates.has(reward.id) ? null : reward);
  }
  const matches = new Map();
  const projectableBase = new Set();
  for (const t of input.transactions) {
    const reward = candidates.get(t.identifier);
    const redemptionCredit = isPayWithPointsCredit(t);
    if (!reward || !postedInStatement(t, input) || t.transactionAmount?.currency !== 'USD'
        || (!redemptionCredit && (rewardCategory(t) === 'excluded' || (input.product !== 'bg' && activityRewardRate(t) !== null)))) continue;
    const rewardDate = statementDate(reward.postedDate);
    if (!rewardDate || ![t.chargeDate, t.postDate, t.displayDate].some(value => statementDate(value) === rewardDate)) continue;
    const type = String(t.type).toUpperCase();
    if (!['DEBIT', 'CREDIT'].includes(type)) continue;
    const amount = Number(t.transactionAmount.amount);
    const sign = type === 'DEBIT' ? 1 : -1;
    const points = reward.rewardAmount?.value;
    const baseMatches = reward.baseAmount?.value === sign * Math.round(Math.abs(amount))
      || (redemptionCredit && reward.baseAmount?.value === 0 && points === 0);
    if (!Number.isFinite(amount) || !baseMatches
        || reward.rewardAmount?.currencyCode !== 'MR' || reward.rewardAmount?.currencyType !== 'POINTS'
        || !Number.isSafeInteger(points) || sign * points < 0) continue;
    matches.set(t.identifier, points);
    const activityRate = activityRewardRate(t);
    if (input.product === 'bg' && type === 'DEBIT' && Number(reward.multiplier) === 1 && points === reward.baseAmount.value
        && (activityRate === null || activityRate === 1 || activityRate === 4)) projectableBase.add(t.identifier);
  }
  return { transactionPoints: matches, projectableBase };
}

function loyaltyPendingRequest(accountToken) {
  return {accountToken,productType:'AEXP_CARD_ACCOUNT',period:'P6M',transactionStatus:['PENDING','QUALIFIED'],category:['REWARD'],summariesBy:['category','transactionStatus'],periodType:'CALENDAR_PERIOD',summariesFor:'LOYALTY_ACCOUNT'};
}

export async function readTotalEstimatedMrPending(cards, originalPending, {
  readActivity, rereadAnnualActivity = readActivity, readRecentActivity, readVitals, readRewards, readBreakdown,
  log, audit, onEstimate = log, onFallback = log,
}) {
  const basic = [...new Map(cards.filter(c => !c.relationship || c.relationship === 'BASIC').map(c => [c.account_token,c])).values()];
  const supported = basic.filter(c => /_(?:bg|bp)_/.test(c.card));
  if (!Number.isFinite(originalPending)) return '';
  if (!supported.length) return originalPending;
  try {
    const recalculated = await readEstimatedMrPending(supported, { readActivity, rereadAnnualActivity, readRecentActivity, readVitals, readRewards, log, audit });
    const accountToken = basic[0]?.account_token;
    if (!accountToken) throw Error('PENDING_BREAKDOWN_TOKEN_UNAVAILABLE');
    const {billed,unbilled} = pendingBreakdown(await readBreakdown(loyaltyPendingRequest(accountToken)));
    if (basic.length !== supported.length && unbilled !== 0) throw Error('MIXED_CARD_UNBILLED_BREAKDOWN_REQUIRED');
    const total = combinePendingEstimate(originalPending,billed,unbilled,recalculated);
    if (total === '') throw Error('PENDING_BREAKDOWN_RECONCILIATION_FAILED');
    if (recalculated === unbilled) {
      onEstimate(`MR recalculated pending matches Amex pending for ${basic[0].card}`);
    } else if (total === originalPending) {
      onEstimate(`MR recalculated pending is lower; retained Amex pending for ${basic[0].card}`);
    }
    return total;
  } catch(error) {
    onFallback(`MR est pending uses Amex pending for ${error.message}`);
    return originalPending;
  }
}

const rewardEvidenceReasons = new Set(['CURRENT_BONUS_ELIGIBILITY_UNRESOLVED', 'BONUS_ELIGIBILITY_UNRESOLVED', 'ANNUAL_BONUS_CAP_UNCERTAIN']);

export async function retryMrRewardEvidence(input, reread, onRetry, wait = delay => new Promise(resolve => setTimeout(resolve, delay))) {
  let result = estimateUnbilledPoints(input);
  if (!rewardEvidenceReasons.has(result.reason)) {
    return { input, result, unresolved: false };
  }

  for (const [index, delay] of MR_REWARD_RETRY_DELAYS_MS.entries()) {
    const scope = result.reason === 'ANNUAL_BONUS_CAP_UNCERTAIN' ? 'annual' : 'current statement';
    onRetry(index + 1, MR_REWARD_RETRY_DELAYS_MS.length, delay, scope);
    await wait(delay);
    const transactions = await reread(scope);
    if (transactions === null) continue;
    input = { ...input, transactions: mergeTransactionEvidence(input.transactions, transactions) };
    result = estimateUnbilledPoints(input);
    if (!rewardEvidenceReasons.has(result.reason)) return { input, result, unresolved: false };
  }
  return { input, result, unresolved: true };
}

function statementDate(value) {
  const date = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function statementEvidence(vitals, today) {
  const reported = Array.isArray(vitals?.statementPeriods) ? vitals.statementPeriods : [];
  const periods = reported.map(period => ({ start: statementDate(period?.statementStartDate), end: statementDate(period?.statementEndDate) }));
  const charges = vitals?.balanceCreditDetails?.balanceDetails?.recentChargesData;
  const balancePeriod = { start: statementDate(charges?.billingCycleStartDate), end: statementDate(charges?.billingCycleEndDate) };
  const valid = period => period.start && period.end && period.start <= period.end;
  const current = [...periods, balancePeriod].find(period => valid(period) && period.start <= today && today <= period.end);
  if (current) return { current };
  const latest = periods.filter(valid).sort((a, b) => b.end.localeCompare(a.end))[0];
  if (latest && latest.start === balancePeriod.start && latest.end === balancePeriod.end && latest.end < today
      && Date.parse(today) - Date.parse(latest.end) === 86_400_000) return { justClosed: latest.end };
  return {};
}

async function readEstimatedMrPending(selected, { readActivity, rereadAnnualActivity, readRecentActivity, readVitals, readRewards, log, audit }) {
  let total = 0;
  let rewards;
  for (const card of selected) {
    try {
      const today = mrAccountDate();
      const year = Number(today.slice(0,4));
      let evidence = statementEvidence(card.mr_vitals, today);
      if (!evidence.current && readVitals) {
        try {
          evidence = statementEvidence(await readVitals(card.account_token), today);
        } catch { log(`could not reread statement period for ${card.card}`); }
      }
      const period = evidence.current;
      const product = card.card.split('_')[1];
      const readCardActivity = () => readActivity(card.account_token, year);
      if (!period) {
        if (evidence.justClosed) {
          const transactions = await readCardActivity();
          const hasUnverifiedPosted = transactions.some(t => {
            if (String(t.status).toUpperCase() !== 'POSTED') return false;
            const date = statementDate(t.postDate || t.displayDate || t.chargeDate);
            return !date || date > evidence.justClosed || statementDate(t.statementEndDate) > evidence.justClosed;
          });
          if (!hasUnverifiedPosted) {
            await audit?.(card, { product, transactions, lastStatementEnd: evidence.justClosed, year, now: today }, { points: 0, reason: '', audit: { noPostedActivityAfterClose: true } });
            continue;
          }
        }
        throw new Error('CURRENT_STATEMENT_UNAVAILABLE');
      }
      if (period.start.slice(0, 4) !== String(year)) throw new Error('CURRENT_YEAR_STATEMENT_UNAVAILABLE');
      const transactions = await readCardActivity();
      const calculation = { product, transactions, statementStart: period.start, statementEnd: period.end, year, openedDate:card.open_date, now: today };
      if (readRewards && transactions.some(t => postedInStatement(t, calculation)
        && (isPayWithPointsCredit(t) || ((product === 'bg' || activityRewardRate(t) === null) && rewardCategory(t) !== 'excluded')))) {
        rewards ??= Promise.resolve().then(readRewards).catch(() => {
          log('MR transaction points unavailable from loyalty activity');
          return [];
        });
        Object.assign(calculation, pointsForTransactions(calculation, await rewards));
        if (calculation.transactionPoints.size) log(`MR matched ${calculation.transactionPoints.size} transaction point record(s) for ${card.card}`);
      }
      const { input, result } = await retryMrRewardEvidence(
        calculation,
        async scope => {
          try {
            if (scope === 'annual') return await rereadAnnualActivity(card.account_token, year);
            const recent = await readRecentActivity(card.account_token);
            return recent.filter(transaction => {
              const date = statementDate(transaction.postDate || transaction.displayDate || transaction.chargeDate);
              return date >= period.start && date <= today;
            });
          } catch {
            log(`could not reread ${scope} reward evidence for ${card.card}`);
            return null;
          }
        },
        (attempt, maxAttempts, delay, scope) => log(`retrying ${scope} reward evidence for ${card.card} (${attempt}/${maxAttempts}) in ${delay}ms`),
      );
      await audit?.(card, input, result);
      if (result.points === null) throw new Error(result.reason);
      total += result.points;
    } catch(error) {
      throw new Error(`${card.card} ${error.message}`, { cause: error });
    }
  }
  return total;
}
