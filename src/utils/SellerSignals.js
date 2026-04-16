const normalizeText = (value = "") => String(value || "").trim();

const slugifyLoose = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const toSafeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const compactSoldText = (value) => {
  const sold = Math.max(0, toSafeNumber(value, 0));
  if (sold >= 1000000) return `${(sold / 1000000).toFixed(1).replace(/\.0$/, "")}M+`;
  if (sold >= 1000) return `${(sold / 1000).toFixed(sold < 10000 ? 1 : 0).replace(/\.0$/, "")}K+`;
  if (sold >= 100) return `${(sold / 1000).toFixed(1)}K+`;
  return `${Math.floor(sold)}+`;
};

const pickStoreBadgeSlugs = (badges = []) => {
  const slugs = new Set();
  (badges || []).forEach((badge) => {
    const slug = slugifyLoose(badge?.slug || badge?.name);
    if (slug) slugs.add(slug);
  });
  return slugs;
};

const computeStarSellerScore = ({
  healthscore = 0,
  averageRating = 0,
  totalSales = 0,
  returnRate = 1,
  cancellationRate = 1,
  productCount = 0,
  engagementScore = 0,
}) => {
  const safeHealth = Math.max(0, Math.min(100, toSafeNumber(healthscore, 0)));
  const safeRating = Math.max(0, Math.min(5, toSafeNumber(averageRating, 0)));
  const safeSales = Math.max(0, toSafeNumber(totalSales, 0));
  const safeReturnRate = Math.max(0, Math.min(1, toSafeNumber(returnRate, 1)));
  const safeCancelRate = Math.max(0, Math.min(1, toSafeNumber(cancellationRate, 1)));
  const safeProductCount = Math.max(0, toSafeNumber(productCount, 0));
  const safeEngagement = Math.max(0, toSafeNumber(engagementScore, 0));

  const score =
    safeHealth * 0.28 +
    (safeRating / 5) * 100 * 0.22 +
    Math.min(100, Math.log10(safeSales + 1) * 28) * 0.2 +
    (1 - safeReturnRate) * 100 * 0.1 +
    (1 - safeCancelRate) * 100 * 0.08 +
    Math.min(100, safeProductCount * 2.2) * 0.06 +
    Math.min(100, safeEngagement * 0.8) * 0.06;

  return {
    score: Number(score.toFixed(2)),
    isstarseller: score >= 80,
  };
};

const buildProductAchievementLabel = ({
  categoryname = "",
  categoryrank = null,
  totalsold = 0,
  reviewcount = 0,
  returnrate = 0,
  engagementscore = 0,
}) => {
  const rank = toSafeNumber(categoryrank, 0);
  const sold = toSafeNumber(totalsold, 0);
  const reviews = toSafeNumber(reviewcount, 0);
  const returns = Math.max(0, Math.min(1, toSafeNumber(returnrate, 0)));
  const engagement = toSafeNumber(engagementscore, 0);
  const safeCategory = normalizeText(categoryname) || "Category";

  if (rank === 1 && sold >= 50) return `No.1 Product in ${safeCategory}`;
  if (rank > 1 && rank <= 3 && sold >= 30) return `Top ${rank} ${safeCategory}`;
  if (sold >= 120 && reviews >= 20 && returns <= 0.08 && engagement >= 20) return `Best Product in ${safeCategory}`;
  return "";
};

const buildProductCardBadges = ({
  product = {},
  storebadges = [],
  starseller = false,
  categoryrank = null,
  categoryname = "",
  engagementscore = 0,
  returnrate = 0,
}) => {
  const badges = [];
  const badgeSlugs = pickStoreBadgeSlugs(storebadges);
  const sold = Math.max(0, toSafeNumber(product?.totalsold, 0));

  if (product?.deliveryschema?.isfreeshipping) {
    badges.push({
      key: "free-delivery",
      label: "Free Delivery",
      image: "/app/assets/freedeliverybadge.png",
      tone: "emerald",
    });
  }

  if (badgeSlugs.has("official-store") || badgeSlugs.has("verified-store") || badgeSlugs.has("verified")) {
    badges.push({
      key: "verified-seller",
      label: "Verified Seller",
      image: "/app/assets/verifiedbadge.png",
      tone: "slate",
    });
  }

  if (starseller || badgeSlugs.has("star-seller")) {
    badges.push({
      key: "star-seller",
      label: "Star Seller",
      image: "/app/assets/starsellerbadge.png",
      tone: "amber",
    });
  }

  if (badgeSlugs.has("fast-delivery")) {
    badges.push({
      key: "fast-delivery",
      label: "Fast Delivery",
      image: "/app/assets/fastbadge.png",
      tone: "sky",
    });
  }

  if (sold >= 120) {
    badges.push({
      key: "best-seller",
      label: "Best Seller",
      tone: "rose",
    });
  }

  const rank = toSafeNumber(categoryrank, 0);
  if (rank > 0 && rank <= 5) {
    badges.push({
      key: "category-rank",
      label: `#${rank} in Category`,
      tone: "indigo",
    });
  }

  const achievement = buildProductAchievementLabel({
    categoryname,
    categoryrank: rank,
    totalsold: sold,
    reviewcount: product?.reviewcount,
    returnrate,
    engagementscore,
  });

  return {
    badges: badges.slice(0, 5),
    soldtext: compactSoldText(sold),
    achievement,
  };
};

module.exports = {
  normalizeText,
  slugifyLoose,
  toSafeNumber,
  compactSoldText,
  pickStoreBadgeSlugs,
  computeStarSellerScore,
  buildProductAchievementLabel,
  buildProductCardBadges,
};
