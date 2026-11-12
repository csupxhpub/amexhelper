const AIRLINE_IATA_BY_SELECTION_CODE = {
  AAL: "AA",
  ASA: "AS",
  DAL: "DL",
  FFT: "F9",
  HAL: "HA",
  JBU: "B6",
  NKS: "NK",
  SWA: "WN",
  UAL: "UA",
};

export function airlineCodeFromBenefits(benefits) {
  const benefit = benefits?.benefits?.["airline-bonus"] || benefits?.benefits?.["airline-fee-credit"] || {};
  return benefitAirlineCode(benefit);
}

export function airlineFeeCodeForTracker(product, tracker, benefit, airlineCode, normalizeName) {
  if (product !== "bp") return "";
  const identity = normalizeName([
    tracker?.benefitId,
    tracker?.sorBenefitId,
    tracker?.benefitName,
    benefit?.benefitName,
    benefit?.benefitTitle,
    benefit?.benefitShortTitle,
  ].filter(Boolean).join(" "));
  const isAirlineFeeBenefit = /\bafc\b|\bairline fee\b|\bairline incidental\b/.test(identity);
  return isAirlineFeeBenefit ? airlineCode : "";
}

function airlineIataCode(selectionCode, selectionName) {
  const normalizedCode = String(selectionCode || "").toUpperCase();
  if (AIRLINE_IATA_BY_SELECTION_CODE[normalizedCode]) return AIRLINE_IATA_BY_SELECTION_CODE[normalizedCode];
  const normalizedName = String(selectionName || "").toLowerCase();
  if (normalizedName.includes("delta")) return "DL";
  if (normalizedName.includes("united")) return "UA";
  if (normalizedName.includes("american")) return "AA";
  if (normalizedName.includes("southwest")) return "WN";
  if (normalizedName.includes("jetblue")) return "B6";
  if (normalizedName.includes("alaska")) return "AS";
  return "NULL";
}

function benefitAirlineCode(benefit) {
  const status = benefit?.enrollmentApplication?.enrollmentStatus || benefit?.layoutType || "";
  if (status !== "ENROLLED") return "NULL";
  const selectionCode = benefit?.enrollmentApplication?.selectionCode || "";
  const selectionName = benefit?.enrollmentApplication?.selectionName
    || benefit?.summary?.layout?.ENROLLED?.showStatus?.include
    || benefit?.details?.layout?.ENROLLED?.showStatus?.include
    || "";
  return airlineIataCode(selectionCode, selectionName);
}
