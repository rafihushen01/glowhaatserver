const uploadoncloudinary = require("../utils/Cloudinary.js");
const mongoose = require("mongoose");
const Item = require("../models/Item.js");
const generateUniqueSlug = require("../utils/GenerateUniqueSlug.js");
const Nav = require("../models/Nav.js");
const Order = require("../models/Order.js");
const Homebanner = require("../models/Homebanner.js");
const UserProductBehavior = require("../models/UserProductBehavior.js");
const SellerRequest = require("../models/SellerRequest.js");
const { enrichProductsWithCardMeta } = require("../utils/ProductCardMeta");

const buildCategoryTree = async (categoryids) => {
  const categories = await Nav.find({
    _id: { $in: categoryids },
    isactive: true,
    isdeleted: false,
  })
    .sort({ depth: 1 })
    .lean();

  if (!categories.length) return [];

  let tree = null;
  for (let i = categories.length - 1; i >= 0; i -= 1) {
    const cat = categories[i];
    tree = {
      name: cat.name,
      link: cat.link || cat.path,
      children: tree ? [tree] : [],
    };
  }

  return [tree];
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }

  if (value === null || value === undefined) return fallback;
  return Boolean(value);
};

const normalizeBooleanFields = (body, fieldDefaults) => {
  Object.entries(fieldDefaults).forEach(([field, fallback]) => {
    if (hasOwn(body, field)) {
      body[field] = parseBoolean(body[field], fallback);
      return;
    }

    body[field] = fallback;
  });
};

const safeJsonParse = (value, fallback) => {
  try {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "object") return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeText = (value) => String(value || "").trim();

const slugifyLoose = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean);
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];

    if (raw.startsWith("[") && raw.endsWith("]")) {
      const parsed = safeJsonParse(raw, []);
      return Array.isArray(parsed) ? parsed.map((entry) => normalizeText(entry)).filter(Boolean) : [];
    }

    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const extractCategoryNamesFromTree = (nodes = [], collector = []) => {
  if (!Array.isArray(nodes)) return collector;

  nodes.forEach((node) => {
    if (!node || typeof node !== "object") return;
    if (node.name) collector.push(node.name);
    if (Array.isArray(node.children) && node.children.length) {
      extractCategoryNamesFromTree(node.children, collector);
    }
  });

  return collector;
};

const extractCategoryTokens = (item) => {
  const tokens = new Set();
  const addToken = (value) => {
    const slug = slugifyLoose(value);
    if (slug) tokens.add(slug);
  };

  if (Array.isArray(item.categorytree)) {
    item.categorytree.forEach(addToken);

    const joinedTree = item.categorytree.map((name) => slugifyLoose(name)).filter(Boolean).join("-");
    if (joinedTree) tokens.add(joinedTree);
  }

  if (typeof item.categorypath === "string" && item.categorypath.trim()) {
    const parts = item.categorypath
      .split(/\s*(?:>|\/|\\|,|\|)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    parts.forEach(addToken);

    const joinedPath = parts.map((part) => slugifyLoose(part)).filter(Boolean).join("-");
    if (joinedPath) tokens.add(joinedPath);
  }

  const categoryNames = extractCategoryNamesFromTree(item.category || []);
  if (categoryNames.length) {
    categoryNames.forEach(addToken);
    const joinedNested = categoryNames.map((name) => slugifyLoose(name)).filter(Boolean).join("-");
    if (joinedNested) tokens.add(joinedNested);
  }

  return Array.from(tokens);
};

const extractLeafCategoryNamesFromTree = (nodes = [], collector = []) => {
  if (!Array.isArray(nodes)) return collector;

  nodes.forEach((node) => {
    if (!node || typeof node !== "object") return;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren) {
      extractLeafCategoryNamesFromTree(node.children, collector);
      return;
    }

    if (node.name) collector.push(node.name);
  });

  return collector;
};

const extractLeafCategoryTokens = (item) => {
  const tokens = new Set();
  const addToken = (value) => {
    const slug = slugifyLoose(value);
    if (slug) tokens.add(slug);
  };

  if (Array.isArray(item.categorytree) && item.categorytree.length) {
    addToken(item.categorytree[item.categorytree.length - 1]);
  }

  if (typeof item.categorypath === "string" && item.categorypath.trim()) {
    const parts = item.categorypath
      .split(/\s*(?:>|\/|\\|,|\|)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length) addToken(parts[parts.length - 1]);
  }

  const leafNames = extractLeafCategoryNamesFromTree(item.category || []);
  if (leafNames.length) {
    leafNames.forEach(addToken);
  }

  if (!tokens.size) {
    const fallbackTokens = extractCategoryTokens(item);
    if (fallbackTokens.length) addToken(fallbackTokens[fallbackTokens.length - 1]);
  }

  return Array.from(tokens);
};

const getAllPrices = (product) => {
  const prices = [];

  [product.price, product.baseprice, product.sellingprice].forEach((candidate) => {
    const numeric = toNumberOrNull(candidate);
    if (numeric !== null && numeric >= 0) prices.push(numeric);
  });

  (product.variants || []).forEach((variant) => {
    (variant.options || []).forEach((option) => {
      const optionPrice = toNumberOrNull(option.currentprice);
      if (optionPrice !== null && optionPrice >= 0) {
        prices.push(optionPrice);
        return;
      }

      const basePrice = toNumberOrNull(option.baseprice);
      if (basePrice !== null && basePrice >= 0) prices.push(basePrice);
    });
  });

  return prices;
};

const getProductPrice = (product) => {
  const prices = getAllPrices(product);
  if (!prices.length) return 0;
  return Math.min(...prices);
};

const getTotalStock = (product) => {
  let total = 0;
  (product.variants || []).forEach((variant) => {
    (variant.options || []).forEach((option) => {
      const stock = toNumberOrNull(option.stock);
      if (stock !== null && stock > 0) total += stock;
    });
  });
  return total;
};

const getVariantValues = (product, targetType) => {
  const normalizedTarget = slugifyLoose(targetType);
  const values = new Set();

  (product.variants || []).forEach((variant) => {
    const typeSlug = slugifyLoose(variant.varianttype || "");
    if (!typeSlug.includes(normalizedTarget)) return;

    if (variant.name) values.add(normalizeText(variant.name));
    (variant.options || []).forEach((option) => {
      if (option.name) values.add(normalizeText(option.name));
    });
  });

  return Array.from(values).filter(Boolean);
};

const itemBelongsToSegment = (item, slug) => {
  const normalizedSlug = slugifyLoose(slug);
  if (!normalizedSlug || normalizedSlug === "all") return true;

  const leafTokens = extractLeafCategoryTokens(item);
  if (!leafTokens.length) return false;
  return leafTokens.includes(normalizedSlug);
};

const buildIncomingFilters = (source = {}) => {
  return {
    colors: normalizeArray(source.colors).map((value) => value.toLowerCase()),
    sizes: normalizeArray(source.sizes).map((value) => value.toLowerCase()),
    brands: normalizeArray(source.brands).map((value) => value.toLowerCase()),
    availability: normalizeText(source.availability).toLowerCase(),
    search: normalizeText(source.search || source.q).toLowerCase(),
    minprice: toNumberOrNull(source.minprice),
    maxprice: toNumberOrNull(source.maxprice),
    minrating: toNumberOrNull(source.minrating),
    maxrating: toNumberOrNull(source.maxrating),
    sort: normalizeText(source.sort || "newest").toLowerCase(),
  };
};

const matchSearch = (product, search) => {
  if (!search) return true;

  const fields = [
    product.name,
    product.brand,
    product.categorypath,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.categorytree) ? product.categorytree : []),
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);

  return fields.some((field) => field.includes(search));
};

const applySegmentFilters = (products, filters) => {
  const { colors, sizes, brands, availability, search, minprice, maxprice, minrating, maxrating } = filters;

  return products.filter((product) => {
    const productColors = getVariantValues(product, "color").map((value) => value.toLowerCase());
    const productSizes = getVariantValues(product, "size").map((value) => value.toLowerCase());
    const productBrand = normalizeText(product.brand).toLowerCase();
    const productPrices = getAllPrices(product);
    const productRatingRaw = toNumberOrNull(product.star);
    const productRating = productRatingRaw !== null ? Math.max(0, productRatingRaw) : 0;
    const totalStock = getTotalStock(product);

    const hasColorMatch = !colors.length || colors.some((color) => productColors.includes(color));
    const hasSizeMatch = !sizes.length || sizes.some((size) => productSizes.includes(size));
    const hasBrandMatch = !brands.length || (productBrand && brands.includes(productBrand));

    let hasAvailabilityMatch = true;
    if (availability === "in_stock") {
      hasAvailabilityMatch = totalStock > 0;
    } else if (availability === "out_of_stock") {
      hasAvailabilityMatch = totalStock <= 0;
    }

    let hasPriceMatch = true;
    if (minprice !== null || maxprice !== null) {
      hasPriceMatch = productPrices.some((price) => {
        if (minprice !== null && price < minprice) return false;
        if (maxprice !== null && price > maxprice) return false;
        return true;
      });
    }

    const hasSearchMatch = matchSearch(product, search);
    let hasRatingMatch = true;
    if (minrating !== null && productRating < minrating) hasRatingMatch = false;
    if (maxrating !== null && productRating > maxrating) hasRatingMatch = false;

    return hasColorMatch && hasSizeMatch && hasBrandMatch && hasAvailabilityMatch && hasPriceMatch && hasSearchMatch && hasRatingMatch;
  });
};

const sortProducts = (products, sort) => {
  const sorted = [...products];

  if (sort === "price_low_high") {
    sorted.sort((a, b) => getProductPrice(a) - getProductPrice(b));
    return sorted;
  }

  if (sort === "price_high_low") {
    sorted.sort((a, b) => getProductPrice(b) - getProductPrice(a));
    return sorted;
  }

  if (sort === "name_az") {
    sorted.sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name)));
    return sorted;
  }

  if (sort === "oldest") {
    sorted.sort((a, b) => new Date(a.createdAt || a.createdat || 0) - new Date(b.createdAt || b.createdat || 0));
    return sorted;
  }

  if (sort === "most_popular" || sort === "less_popular") {
    sorted.sort((a, b) => {
      const aScore = Number(a.popularityscore || 0);
      const bScore = Number(b.popularityscore || 0);
      if (aScore === bScore) {
        return new Date(b.createdAt || b.createdat || 0) - new Date(a.createdAt || a.createdat || 0);
      }
      return sort === "most_popular" ? bScore - aScore : aScore - bScore;
    });
    return sorted;
  }

  sorted.sort((a, b) => new Date(b.createdAt || b.createdat || 0) - new Date(a.createdAt || a.createdat || 0));
  return sorted;
};

const buildProductPopularityMap = async (products) => {
  if (!Array.isArray(products) || !products.length) return new Map();

  const validProductIds = products
    .map((product) => String(product?._id || ""))
    .filter((id) => /^[a-fA-F0-9]{24}$/.test(id));

  if (!validProductIds.length) return new Map();
  const validProductObjectIds = validProductIds.map((id) => new mongoose.Types.ObjectId(id));

  const [orderStats, repeatStats] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          status: { $in: ["delivered", "returned", "canceled"] },
          "items.productid": { $in: validProductObjectIds },
        },
      },
      { $unwind: "$items" },
      {
        $match: {
          "items.productid": { $in: validProductObjectIds },
        },
      },
      {
        $group: {
          _id: "$items.productid",
          deliveredqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
          deliveredorders: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, 1, 0],
            },
          },
          canceledqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "canceled"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
          returnedqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "returned"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          status: "delivered",
          "items.productid": { $in: validProductObjectIds },
        },
      },
      { $unwind: "$items" },
      {
        $match: {
          "items.productid": { $in: validProductObjectIds },
        },
      },
      {
        $group: {
          _id: {
            productid: "$items.productid",
            userid: "$userid",
          },
          deliveredordersbyuser: { $sum: 1 },
          deliveredqtybyuser: { $sum: { $ifNull: ["$items.quantity", 0] } },
        },
      },
      {
        $group: {
          _id: "$_id.productid",
          repeatcustomers: {
            $sum: {
              $cond: [{ $gt: ["$deliveredordersbyuser", 1] }, 1, 0],
            },
          },
          repeatunits: {
            $sum: {
              $cond: [{ $gt: ["$deliveredordersbyuser", 1] }, "$deliveredqtybyuser", 0],
            },
          },
        },
      },
    ]),
  ]);

  const statsByProduct = new Map();
  orderStats.forEach((entry) => {
    statsByProduct.set(String(entry._id), {
      deliveredqty: Number(entry.deliveredqty || 0),
      deliveredorders: Number(entry.deliveredorders || 0),
      canceledqty: Number(entry.canceledqty || 0),
      returnedqty: Number(entry.returnedqty || 0),
      repeatcustomers: 0,
      repeatunits: 0,
    });
  });

  repeatStats.forEach((entry) => {
    const key = String(entry._id);
    const existing = statsByProduct.get(key) || {
      deliveredqty: 0,
      deliveredorders: 0,
      canceledqty: 0,
      returnedqty: 0,
      repeatcustomers: 0,
      repeatunits: 0,
    };

    existing.repeatcustomers = Number(entry.repeatcustomers || 0);
    existing.repeatunits = Number(entry.repeatunits || 0);
    statsByProduct.set(key, existing);
  });

  const scoreMap = new Map();
  products.forEach((product) => {
    const productId = String(product._id || "");
    const stats = statsByProduct.get(productId) || {
      deliveredqty: 0,
      deliveredorders: 0,
      canceledqty: 0,
      returnedqty: 0,
      repeatcustomers: 0,
      repeatunits: 0,
    };

    const rating = Math.max(0, Math.min(5, Number(product.star || 0)));
    const reviewCount = Math.max(0, Number(product.reviewcount || 0));

    const ratingWeight = rating >= 4 ? rating * 6 : rating * 2;
    const reviewWeight = Math.min(50, reviewCount) * 0.8;
    const purchaseWeight = stats.deliveredqty * 3 + stats.deliveredorders * 2;
    const repeatWeight = stats.repeatcustomers * 10 + stats.repeatunits * 2;
    const cancelPenalty = stats.canceledqty * 3;
    const returnPenalty = stats.returnedqty * 5;

    const now = Date.now();
    const sponsorActive =
      Boolean(product?.sponsorship?.isactive) &&
      product?.sponsorship?.endsat &&
      new Date(product.sponsorship.endsat).getTime() > now;
    const sponsorWeight = sponsorActive
      ? Number(product?.sponsorship?.boostedscore || product?.sponsorship?.amount || 0)
      : 0;

    const score =
      purchaseWeight +
      repeatWeight +
      ratingWeight +
      reviewWeight +
      sponsorWeight -
      cancelPenalty -
      returnPenalty;
    scoreMap.set(productId, Number(score.toFixed(3)));
  });

  return scoreMap;
};

const getProductsBySegmentSlug = async (slug) => {
  const products = await Item.find({ isactive: true }).select("-__v").lean();
  return products.filter((item) => itemBelongsToSegment(item, slug));
};

const DISCOVERY_WINDOWS = [4, 7, 14, 30];

const normalizeWindowDays = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return DISCOVERY_WINDOWS.includes(n) ? n : 30;
};

const normalizeRank = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rank = Math.trunc(n);
  if (rank < 1 || rank > 40) return null;
  return rank;
};

const normalizePage = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
};

const normalizeLimit = (value, fallback = 30, max = 60) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
};

const resolveWindowStart = (days) => {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000);
};

const toObjectIds = (products = []) =>
  products
    .map((p) => String(p?._id || ""))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

const getProductCategoryTokens = (product) => {
  const tokens = new Set([
    ...extractCategoryTokens(product),
    ...extractLeafCategoryTokens(product),
  ]);
  return Array.from(tokens);
};

const productMatchesCategory = (product, categoryslug) => {
  const normalized = slugifyLoose(categoryslug);
  if (!normalized || normalized === "all") return true;
  const tokens = getProductCategoryTokens(product);
  return tokens.includes(normalized);
};

const productMatchesBrand = (product, brand) => {
  const normalized = normalizeText(brand).toLowerCase();
  if (!normalized) return true;
  return normalizeText(product?.brand).toLowerCase() === normalized;
};

const productHasColor = (product, color) => {
  const normalized = normalizeText(color).toLowerCase();
  if (!normalized) return true;
  const colors = getVariantValues(product, "color").map((entry) => normalizeText(entry).toLowerCase());
  return colors.includes(normalized);
};

const buildProductSignalMap = async (productObjectIds = [], startDate = null) => {
  if (!productObjectIds.length) return new Map();

  const match = { productid: { $in: productObjectIds } };
  if (startDate) match.lastinteractedat = { $gte: startDate };

  const rows = await UserProductBehavior.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$productid",
        clickcount: { $sum: "$clickcount" },
        detailviewcount: { $sum: "$detailviewcount" },
        signalscore: { $sum: "$signalscore" },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        clickcount: Number(row.clickcount || 0),
        detailviewcount: Number(row.detailviewcount || 0),
        signalscore: Number(row.signalscore || 0),
      },
    ])
  );
};

const buildBestSellerRankings = async ({ products = [], days = 30, categoryslug = "" }) => {
  const filtered = products.filter((product) => productMatchesCategory(product, categoryslug));
  if (!filtered.length) return [];

  const productObjectIds = toObjectIds(filtered);
  if (!productObjectIds.length) return [];

  const startDate = resolveWindowStart(days);

  const [orderRows, repeatRows, signalMap] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ["delivered", "returned", "canceled"] },
          "items.productid": { $in: productObjectIds },
        },
      },
      { $unwind: "$items" },
      { $match: { "items.productid": { $in: productObjectIds } } },
      {
        $group: {
          _id: "$items.productid",
          deliveredqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
          deliveredorders: {
            $sum: {
              $cond: [{ $eq: ["$status", "delivered"] }, 1, 0],
            },
          },
          canceledqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "canceled"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
          returnedqty: {
            $sum: {
              $cond: [{ $eq: ["$status", "returned"] }, { $ifNull: ["$items.quantity", 0] }, 0],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: "delivered",
          "items.productid": { $in: productObjectIds },
        },
      },
      { $unwind: "$items" },
      { $match: { "items.productid": { $in: productObjectIds } } },
      {
        $group: {
          _id: {
            productid: "$items.productid",
            customerkey: {
              $cond: [
                { $ifNull: ["$userid", false] },
                { $toString: "$userid" },
                "$ownerid",
              ],
            },
          },
          deliveredordersbycustomer: { $sum: 1 },
          deliveredqtybycustomer: { $sum: { $ifNull: ["$items.quantity", 0] } },
        },
      },
      {
        $group: {
          _id: "$_id.productid",
          repeatcustomers: {
            $sum: {
              $cond: [{ $gt: ["$deliveredordersbycustomer", 1] }, 1, 0],
            },
          },
          repeatqty: {
            $sum: {
              $cond: [{ $gt: ["$deliveredordersbycustomer", 1] }, "$deliveredqtybycustomer", 0],
            },
          },
        },
      },
    ]),
    buildProductSignalMap(productObjectIds, startDate),
  ]);

  const orderMap = new Map(
    orderRows.map((row) => [
      String(row._id),
      {
        deliveredqty: Number(row.deliveredqty || 0),
        deliveredorders: Number(row.deliveredorders || 0),
        canceledqty: Number(row.canceledqty || 0),
        returnedqty: Number(row.returnedqty || 0),
      },
    ])
  );

  const repeatMap = new Map(
    repeatRows.map((row) => [
      String(row._id),
      {
        repeatcustomers: Number(row.repeatcustomers || 0),
        repeatqty: Number(row.repeatqty || 0),
      },
    ])
  );

  const scored = filtered.map((product) => {
    const id = String(product._id);
    const orderStats = orderMap.get(id) || {
      deliveredqty: 0,
      deliveredorders: 0,
      canceledqty: 0,
      returnedqty: 0,
    };
    const repeatStats = repeatMap.get(id) || {
      repeatcustomers: 0,
      repeatqty: 0,
    };
    const signals = signalMap.get(id) || {
      clickcount: 0,
      detailviewcount: 0,
      signalscore: 0,
    };

    const rating = Math.max(0, Math.min(5, Number(product.star || 0)));
    const reviews = Math.max(0, Number(product.reviewcount || 0));

    const sponsorBonus =
      Boolean(product?.sponsorship?.isactive) &&
      product?.sponsorship?.endsat &&
      new Date(product.sponsorship.endsat).getTime() > Date.now()
        ? Number(product?.sponsorship?.boostedscore || product?.sponsorship?.amount || 0)
        : 0;

    const score =
      orderStats.deliveredqty * 3.3 +
      orderStats.deliveredorders * 2.6 +
      repeatStats.repeatcustomers * 12 +
      repeatStats.repeatqty * 2.2 +
      rating * 8 +
      Math.min(200, reviews) * 0.7 +
      signals.clickcount * 0.45 +
      signals.detailviewcount * 0.62 +
      signals.signalscore * 0.03 +
      sponsorBonus -
      orderStats.canceledqty * 4.4 -
      orderStats.returnedqty * 6.2;

    return {
      ...product,
      bestsellerscore: Number(score.toFixed(4)),
      bestsellerstats: {
        days,
        deliveredqty: orderStats.deliveredqty,
        deliveredorders: orderStats.deliveredorders,
        repeatcustomers: repeatStats.repeatcustomers,
        repeatqty: repeatStats.repeatqty,
        canceledqty: orderStats.canceledqty,
        returnedqty: orderStats.returnedqty,
        clickcount: signals.clickcount,
        detailviewcount: signals.detailviewcount,
      },
    };
  });

  scored.sort((a, b) => {
    if (b.bestsellerscore !== a.bestsellerscore) return b.bestsellerscore - a.bestsellerscore;
    if (b.bestsellerstats.deliveredqty !== a.bestsellerstats.deliveredqty) {
      return b.bestsellerstats.deliveredqty - a.bestsellerstats.deliveredqty;
    }
    return new Date(b.createdAt || b.createdat || 0) - new Date(a.createdAt || a.createdat || 0);
  });

  return scored.map((product, index) => ({
    ...product,
    isbestseller: index < 40,
    bestsellerrank: index + 1,
  }));
};

const resolveActorIdForDiscovery = (req, sessionkey = "") => {
  const userid = String(req?.user?.userId || "");
  if (mongoose.Types.ObjectId.isValid(userid)) return `user:${userid}`;
  const safeSession = normalizeText(sessionkey);
  if (safeSession) return `guest:${safeSession}`;
  return "";
};

const buildActorBoostMap = async (actorid = "", productIds = []) => {
  if (!actorid || !productIds.length) return new Map();
  const rows = await UserProductBehavior.find({
    actorid,
    productid: { $in: productIds },
  })
    .select("productid signalscore clickcount detailviewcount")
    .lean();

  return new Map(
    rows.map((row) => [
      String(row.productid),
      Number(row.signalscore || 0) +
        Number(row.clickcount || 0) * 0.8 +
        Number(row.detailviewcount || 0) * 0.6,
    ])
  );
};

exports.createItem = async (req, res) => {
  try {
    const body = { ...req.body };

    body.variants = safeJsonParse(body.variants, []);
    body.gallery = safeJsonParse(body.gallery, []);
    body.categoryids = safeJsonParse(body.categoryids, []);
    body.categorytree = normalizeArray(safeJsonParse(body.categorytree, body.categorytree));
    body.deliveryschema = safeJsonParse(body.deliveryschema, {});
    body.categorypath = normalizeText(body.categorypath || body.categorytree.join(" > "));

    normalizeBooleanFields(body, {
      flashsale: false,
      eidsale: false,
      coustomsale: false,
      isreturnable: false,
      isperishable: false,
      warrantynotavalible: false,
      iskhanproduct: true,
      isactive: true,
    });

    body.coustomsales = body.coustomsale;

    if (Array.isArray(body.categoryids) && body.categoryids.length) {
      body.category = await buildCategoryTree(body.categoryids);
    }

    const fileMap = {};
    (req.files || []).forEach((file) => {
      if (!fileMap[file.fieldname]) fileMap[file.fieldname] = [];
      fileMap[file.fieldname].push(file);
    });

    const uploadFile = async (file) => {
      try {
        return await uploadoncloudinary(file.path);
      } catch (error) {
        console.error("Cloudinary upload failed", file.originalname, error.message);
        return null;
      }
    };

    await Promise.all(
      ["whiteimage", "hoverimage"].map(async (key) => {
        if (!fileMap[key]?.[0]) return;
        const url = await uploadFile(fileMap[key][0]);
        if (url) body[key] = url;
      })
    );

    if (fileMap.gallery?.length) {
      const galleryUrls = await Promise.all(fileMap.gallery.map(uploadFile));
      body.gallery = galleryUrls.filter(Boolean);
    }

    if (Array.isArray(body.variants) && body.variants.length) {
      for (let variantIndex = 0; variantIndex < body.variants.length; variantIndex += 1) {
        const variant = body.variants[variantIndex];
        const expectedCount = Array.isArray(variant.images) ? variant.images.length : 0;
        const filesForVariant = [];

        for (let imageIndex = 0; imageIndex < expectedCount; imageIndex += 1) {
          const key = `variantmedia_${variantIndex}_${imageIndex}`;
          filesForVariant.push(...(fileMap[key] || []));
        }

        if (!filesForVariant.length) continue;

        const urls = await Promise.all(filesForVariant.map(uploadFile));
        variant.images = urls.filter(Boolean);
      }
    }

    body.slug = await generateUniqueSlug(body.name);

    const item = await Item.create(body);

    return res.status(201).json({
      success: true,
      message: "Item created successfully",
      item,
    });
  } catch (error) {
    console.error("CREATE ITEM ERROR:", error);
    if (res.headersSent) return;

    return res.status(500).json({
      success: false,
      message: error.message || "Unknown error",
    });
  }
};

exports.edititem = async (req, res) => {
  try {
    const { id } = req.params;
    const body = { ...req.body };

    if (typeof body.variants === "string") {
      body.variants = safeJsonParse(body.variants, []);
    }

    if (hasOwn(body, "iskhanproduct")) {
      body.iskhanproduct = parseBoolean(body.iskhanproduct, true);
    }

    if (hasOwn(body, "categoryids")) {
      body.categoryids = safeJsonParse(body.categoryids, []);
    }

    if (hasOwn(body, "categorytree")) {
      body.categorytree = normalizeArray(safeJsonParse(body.categorytree, body.categorytree));
    }

    if (hasOwn(body, "categorypath")) {
      body.categorypath = normalizeText(body.categorypath);
    } else if (Array.isArray(body.categorytree) && body.categorytree.length) {
      body.categorypath = body.categorytree.join(" > ");
    }

    if (Array.isArray(body.categoryids) && body.categoryids.length) {
      body.category = await buildCategoryTree(body.categoryids);
    }

    const existing = await Item.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    if (req.files?.whiteimage) {
      body.whiteimage = await uploadoncloudinary(req.files.whiteimage[0].path);
    }

    if (req.files?.hoverimage) {
      body.hoverimage = await uploadoncloudinary(req.files.hoverimage[0].path);
    }

    if (body.name && body.name !== existing.name) {
      body.slug = await generateUniqueSlug(body.name, id);
    }

    const updated = await Item.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });

    return res.json({
      success: true,
      message: "Item updated",
      item: updated,
    });
  } catch (error) {
    console.error("EDIT ITEM ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update item",
      error: error.message,
    });
  }
};

exports.deleteitem = async (req, res) => {
  try {
    const { id } = req.params;
    await Item.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Item deleted",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.getallitems = async (req, res) => {
  try {
    const { category, subcategory, search } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;
    if (search) filter.name = { $regex: search, $options: "i" };

    const items = await Item.find(filter).sort({ createdat: -1 });

    return res.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.searchitems = async (req, res) => {
  try {
    const raw = normalizeText(req.query?.q);
    if (!raw) {
      return res.status(200).json({ success: true, count: 0, items: [] });
    }

    const safe = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");

    const items = await Item.find({
      isactive: true,
      $or: [{ name: regex }, { brand: regex }, { categorypath: regex }, { tags: regex }],
    })
      .sort({ createdat: -1 })
      .limit(12)
      .lean();

    return res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getnewinitems = async (req, res) => {
  try {
    const date = new Date();
    date.setDate(date.getDate() - 5);

    const items = await Item.find({
      createdat: { $gte: date },
      isactive: true,
    }).sort({ createdat: -1 });

    return res.json({ success: true, items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getitem = async (req, res) => {
  try {
    const { slug } = req.params;
    const item = await Item.findOne({ slug })
      .populate("shopid", "_id shopname slug profileimage bannerimage description")
      .populate("sellerid", "_id fullname usersavatar role");

    if (!item) {
      return res.json({ success: false, message: "Item not found" });
    }

    let sellerprofile = null;
    if (item?.sellerid?._id) {
      const signup = await SellerRequest.findOne({
        userid: item.sellerid._id,
        status: "Approved",
      })
        .sort({ reviewedat: -1, createdAt: -1 })
        .select("storetype preferredcategories businessmodel")
        .lean();

      if (signup) {
        sellerprofile = {
          storetype: signup.storetype || "",
          preferredcategories: Array.isArray(signup.preferredcategories) ? signup.preferredcategories.filter(Boolean) : [],
          businessmodel: signup.businessmodel || "",
        };
      }
    }

    const payload = item.toObject ? item.toObject() : item;
    payload.sellerprofile = sellerprofile;
    return res.json({ success: true, item: payload });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
};

exports.shopbycategory = async (req, res) => {
  try {
    const { slug } = req.params;
    const filters = buildIncomingFilters(req.query);

    const products = await getProductsBySegmentSlug(slug);
    const filteredRaw = applySegmentFilters(products, filters);
    const popularityMap = await buildProductPopularityMap(filteredRaw);
    const filtered = filteredRaw.map((product) => ({
      ...product,
      popularityscore: Number(popularityMap.get(String(product._id)) || 0),
    }));
    const sorted = sortProducts(filtered, filters.sort);
    const withCardMeta = await enrichProductsWithCardMeta(sorted);

    return res.status(200).json({
      success: true,
      count: withCardMeta.length,
      data: withCardMeta,
    });
  } catch (error) {
    console.error("shopbycategory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load category products",
    });
  }
};

exports.getcategoryfilters = async (req, res) => {
  try {
    const { slug } = req.params;
    const products = await getProductsBySegmentSlug(slug);

    const colors = new Set();
    const sizes = new Set();
    const brands = new Set();
    const categoryTrails = new Set();
    const prices = [];
    const ratings = [];

    let inStockCount = 0;
    let outOfStockCount = 0;

    products.forEach((product) => {
      getVariantValues(product, "color").forEach((color) => colors.add(color));
      getVariantValues(product, "size").forEach((size) => sizes.add(size));

      const brand = normalizeText(product.brand);
      if (brand) brands.add(brand);

      if (Array.isArray(product.categorytree) && product.categorytree.length) {
        categoryTrails.add(product.categorytree.join(" > "));
      } else if (normalizeText(product.categorypath)) {
        categoryTrails.add(normalizeText(product.categorypath));
      }

      const itemPrices = getAllPrices(product);
      prices.push(...itemPrices);
      const rating = toNumberOrNull(product.star);
      ratings.push(rating !== null && rating > 0 ? rating : 0);

      if (getTotalStock(product) > 0) inStockCount += 1;
      else outOfStockCount += 1;
    });

    const cleanPrices = prices.filter((price) => Number.isFinite(price) && price >= 0);
    const cleanRatings = ratings.filter((rating) => Number.isFinite(rating) && rating >= 0);
    const maxCategoryRating = cleanRatings.length ? Math.min(5, Math.ceil(Math.max(...cleanRatings))) : 0;

    return res.status(200).json({
      success: true,
      filters: {
        colors: Array.from(colors).sort((a, b) => a.localeCompare(b)),
        sizes: Array.from(sizes).sort((a, b) => a.localeCompare(b)),
        brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
        categoryTrails: Array.from(categoryTrails),
        minPrice: cleanPrices.length ? Math.min(...cleanPrices) : 0,
        maxPrice: cleanPrices.length ? Math.max(...cleanPrices) : 0,
        minRating: 0,
        maxRating: maxCategoryRating,
        availability: {
          in_stock: inStockCount,
          out_of_stock: outOfStockCount,
        },
      },
    });
  } catch (error) {
    console.error("getcategoryfilters error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to build filters",
    });
  }
};

exports.filtercategoryproduct = async (req, res) => {
  try {
    const { slug } = req.params;
    const filters = buildIncomingFilters(req.body || {});

    const products = await getProductsBySegmentSlug(slug);
    const filteredRaw = applySegmentFilters(products, filters);
    const popularityMap = await buildProductPopularityMap(filteredRaw);
    const filtered = filteredRaw.map((product) => ({
      ...product,
      popularityscore: Number(popularityMap.get(String(product._id)) || 0),
    }));
    const sorted = sortProducts(filtered, filters.sort);
    const withCardMeta = await enrichProductsWithCardMeta(sorted);

    return res.status(200).json({
      success: true,
      count: withCardMeta.length,
      data: withCardMeta,
    });
  } catch (error) {
    console.error("filtercategoryproduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Filtering failed",
    });
  }
};

exports.getDiscoveryBestSellers = async (req, res) => {
  try {
    const days = normalizeWindowDays(req.query?.days);
    const page = normalizePage(req.query?.page, 1);
    const limit = normalizeLimit(req.query?.limit, 30, 60);
    const rank = normalizeRank(req.query?.rank);
    const categoryslug = slugifyLoose(req.query?.categoryslug || "");
    const minrating = toNumberOrNull(req.query?.minrating);
    const sessionkey = normalizeText(req.query?.sessionkey);

    const allProducts = await Item.find({ isactive: true })
      .select("-__v")
      .lean();

    const ratingFiltered = allProducts.filter((product) => {
      if (minrating === null) return true;
      return Number(product.star || 0) >= Number(minrating || 0);
    });

    let ranked = await buildBestSellerRankings({
      products: ratingFiltered,
      days,
      categoryslug,
    });

    const actorid = resolveActorIdForDiscovery(req, sessionkey);
    const actorBoostMap = await buildActorBoostMap(
      actorid,
      toObjectIds(ranked)
    );

    ranked = ranked.map((product) => {
      const boost = Number(actorBoostMap.get(String(product._id)) || 0);
      return {
        ...product,
        recommendationboost: Number(boost.toFixed(3)),
        discoveryscore: Number((product.bestsellerscore + boost * 0.06).toFixed(3)),
      };
    });

    ranked.sort((a, b) => {
      if (b.discoveryscore !== a.discoveryscore) return b.discoveryscore - a.discoveryscore;
      return a.bestsellerrank - b.bestsellerrank;
    });

    ranked = ranked.map((product, index) => ({
      ...product,
      bestsellerrank: index + 1,
      isbestseller: index < 40,
    }));

    const topForty = ranked.slice(0, 40);
    const topFortyWithCardMeta = await enrichProductsWithCardMeta(topForty);
    const rankFiltered = rank ? topFortyWithCardMeta.filter((product) => product.bestsellerrank === rank) : topFortyWithCardMeta;

    const start = (page - 1) * limit;
    const end = start + limit;
    const items = rank ? rankFiltered : rankFiltered.slice(start, end);

    return res.status(200).json({
      success: true,
      meta: {
        section: "bestselling",
        days,
        categoryslug: categoryslug || "all",
        rank,
        page,
        limit,
        total: rankFiltered.length,
        hasmore: !rank && end < rankFiltered.length,
        availableranks: topForty.map((product) => product.bestsellerrank),
      },
      items,
    });
  } catch (error) {
    console.error("getDiscoveryBestSellers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load best selling products",
    });
  }
};

exports.getDiscoveryTopRated = async (req, res) => {
  try {
    const page = normalizePage(req.query?.page, 1);
    const limit = normalizeLimit(req.query?.limit, 30, 60);
    const categoryslug = slugifyLoose(req.query?.categoryslug || "");
    const starfrom = toNumberOrNull(req.query?.starfrom);
    const starto = toNumberOrNull(req.query?.starto);
    const brand = normalizeText(req.query?.brand);
    const color = normalizeText(req.query?.color);
    const sessionkey = normalizeText(req.query?.sessionkey);

    const minprice = toNumberOrNull(req.query?.minprice);
    const maxprice = toNumberOrNull(req.query?.maxprice);

    let products = await Item.find({ isactive: true })
      .select("-__v")
      .lean();

    const minStar = starfrom === null ? 5 : Math.max(1, Math.min(5, Number(starfrom)));
    const maxStar = starto === null ? 5 : Math.max(minStar, Math.min(5, Number(starto)));

    products = products.filter((product) => {
      const star = Number(product.star || 0);
      if (star < minStar || star > maxStar) return false;
      if (!productMatchesCategory(product, categoryslug)) return false;
      if (!productMatchesBrand(product, brand)) return false;
      if (!productHasColor(product, color)) return false;

      const price = getProductPrice(product);
      if (minprice !== null && price < minprice) return false;
      if (maxprice !== null && price > maxprice) return false;
      return true;
    });

    const actorid = resolveActorIdForDiscovery(req, sessionkey);
    const actorBoostMap = await buildActorBoostMap(actorid, toObjectIds(products));

    let ranked = products.map((product) => {
      const actorBoost = Number(actorBoostMap.get(String(product._id)) || 0);
      const score =
        Number(product.star || 0) * 12 +
        Math.min(500, Number(product.reviewcount || 0)) * 0.7 +
        Number(product.totalsold || 0) * 0.2 +
        actorBoost * 0.08;
      return {
        ...product,
        topratedscore: Number(score.toFixed(3)),
      };
    });

    ranked.sort((a, b) => {
      if (b.topratedscore !== a.topratedscore) return b.topratedscore - a.topratedscore;
      return new Date(b.createdAt || b.createdat || 0) - new Date(a.createdAt || a.createdat || 0);
    });
    ranked = await enrichProductsWithCardMeta(ranked);

    const start = (page - 1) * limit;
    const end = start + limit;
    const items = ranked.slice(start, end);

    return res.status(200).json({
      success: true,
      meta: {
        section: "fivestar",
        page,
        limit,
        total: ranked.length,
        hasmore: end < ranked.length,
        starfrom: minStar,
        starto: maxStar,
      },
      items,
    });
  } catch (error) {
    console.error("getDiscoveryTopRated error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load top rated products",
    });
  }
};

exports.getDiscoveryNewIn = async (req, res) => {
  try {
    const page = normalizePage(req.query?.page, 1);
    const limit = normalizeLimit(req.query?.limit, 30, 60);
    const days = normalizeWindowDays(req.query?.days || 30);
    const categoryslug = slugifyLoose(req.query?.categoryslug || "");
    const brand = normalizeText(req.query?.brand);
    const color = normalizeText(req.query?.color);
    const sessionkey = normalizeText(req.query?.sessionkey);

    const minstar = toNumberOrNull(req.query?.minstar);
    const maxstar = toNumberOrNull(req.query?.maxstar);
    const minprice = toNumberOrNull(req.query?.minprice);
    const maxprice = toNumberOrNull(req.query?.maxprice);

    const createdAfter = resolveWindowStart(days);

    let products = await Item.find({
      isactive: true,
      createdAt: { $gte: createdAfter },
    })
      .select("-__v")
      .lean();

    const bestSellerWanted = String(req.query?.bestselling || "").trim() === "1";
    let bestSellerRanks = new Map();

    if (bestSellerWanted) {
      const ranked = await buildBestSellerRankings({
        products,
        days: 30,
        categoryslug,
      });
      bestSellerRanks = new Map(
        ranked.slice(0, 40).map((product) => [String(product._id), product.bestsellerrank])
      );
    }

    products = products.filter((product) => {
      if (!productMatchesCategory(product, categoryslug)) return false;
      if (!productMatchesBrand(product, brand)) return false;
      if (!productHasColor(product, color)) return false;

      const star = Number(product.star || 0);
      if (minstar !== null && star < minstar) return false;
      if (maxstar !== null && star > maxstar) return false;

      const price = getProductPrice(product);
      if (minprice !== null && price < minprice) return false;
      if (maxprice !== null && price > maxprice) return false;

      if (bestSellerWanted && !bestSellerRanks.has(String(product._id))) return false;
      return true;
    });

    const actorid = resolveActorIdForDiscovery(req, sessionkey);
    const actorBoostMap = await buildActorBoostMap(actorid, toObjectIds(products));

    let ranked = products.map((product) => {
      const freshnessWeight = 1000 - (Date.now() - new Date(product.createdAt || product.createdat || 0).getTime()) / (1000 * 60 * 60);
      const actorBoost = Number(actorBoostMap.get(String(product._id)) || 0);
      return {
        ...product,
        isbestseller: bestSellerRanks.has(String(product._id)),
        bestsellerrank: bestSellerRanks.get(String(product._id)) || null,
        newinscore: Number((freshnessWeight + actorBoost * 0.05 + Number(product.star || 0) * 4).toFixed(3)),
      };
    });

    ranked.sort((a, b) => {
      if (b.newinscore !== a.newinscore) return b.newinscore - a.newinscore;
      return new Date(b.createdAt || b.createdat || 0) - new Date(a.createdAt || a.createdat || 0);
    });
    ranked = await enrichProductsWithCardMeta(ranked);

    const start = (page - 1) * limit;
    const end = start + limit;
    const items = ranked.slice(start, end);

    return res.status(200).json({
      success: true,
      meta: {
        section: "newin",
        days,
        page,
        limit,
        total: ranked.length,
        hasmore: end < ranked.length,
      },
      items,
    });
  } catch (error) {
    console.error("getDiscoveryNewIn error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load new in products",
    });
  }
};

exports.getDiscoveryCms = async (req, res) => {
  try {
    const [bestSellingBanners, fiveStarBanners, newInBanners] = await Promise.all([
      Homebanner.find({ sectionkey: "bestselling", status: "active" }).sort({ bannernumber: 1, createdAt: -1 }).lean(),
      Homebanner.find({ sectionkey: "fivestar", status: "active" }).sort({ bannernumber: 1, createdAt: -1 }).lean(),
      Homebanner.find({ sectionkey: "newin", status: "active" }).sort({ bannernumber: 1, createdAt: -1 }).lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        bestselling: {
          primary: bestSellingBanners[0] || null,
          banners: bestSellingBanners,
        },
        fivestar: {
          primary: fiveStarBanners[0] || null,
          banners: fiveStarBanners,
        },
        newin: {
          primary: newInBanners[0] || null,
          banners: newInBanners,
        },
      },
    });
  } catch (error) {
    console.error("getDiscoveryCms error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load discovery CMS data",
    });
  }
};
