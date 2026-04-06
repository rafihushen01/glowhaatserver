const DEFAULT_DELIVERY_CHARGE = 110;
const DHAKA_DELIVERY_CHARGE = 90;

const toSafeString = (value) => (value == null ? "" : String(value).trim());

const normalizeText = (value) =>
  toSafeString(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const isDhakaDistrict = (district) => {
  const normalized = normalizeText(district);
  if (!normalized) return false;
  return normalized === "dhaka" || normalized.includes("dhaka") || normalized.includes("ঢাকা");
};

const calculateDeliveryCharge = ({ district = "", hasFreeDelivery = false } = {}) => {
  if (hasFreeDelivery) return 0;
  if (isDhakaDistrict(district)) return DHAKA_DELIVERY_CHARGE;
  return DEFAULT_DELIVERY_CHARGE;
};

module.exports = {
  DEFAULT_DELIVERY_CHARGE,
  DHAKA_DELIVERY_CHARGE,
  isDhakaDistrict,
  calculateDeliveryCharge,
};
