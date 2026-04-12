const uploadoncloudinary = require("../utils/Cloudinary.js");
const mongoose = require("mongoose");
const Item = require("../models/Item.js");
const generateUniqueSlug = require("../utils/GenerateUniqueSlug.js");
const Nav = require("../models/Nav.js");
const Order = require("../models/Order.js");

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
    const item = await Item.findOne({ slug });

    if (!item) {
      return res.json({ success: false, message: "Item not found" });
    }

    return res.json({ success: true, item });
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

    return res.status(200).json({
      success: true,
      count: sorted.length,
      data: sorted,
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

    return res.status(200).json({
      success: true,
      count: sorted.length,
      data: sorted,
    });
  } catch (error) {
    console.error("filtercategoryproduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Filtering failed",
    });
  }
};
