const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const path = require("path");
const Item = require("../models/Item");
const SellerShop = require("../models/SellerShop");
const Order = require("../models/Order");
const User = require("../models/User");
const UserProductBehavior = require("../models/UserProductBehavior");
const SellerBadge = require("../models/SellerBadge");
const SellerShopFollow = require("../models/SellerShopFollow");
const SellerShopRating = require("../models/SellerShopRating");
const SellerShopReport = require("../models/SellerShopReport");
const uploadoncloudinary = require("../utils/Cloudinary");
const { pushKhanNotification } = require("../utils/KhanNotifier");
const { buildProductCardBadges, computeStarSellerScore } = require("../utils/SellerSignals");

const normalizeText = (value = "") => String(value || "").trim();
const normalizeGuestId = (value = "") => normalizeText(value).slice(0, 120);
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const slugifyLoose = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const getAllPrices = (product) => {
  const prices = [];

  [product?.price, product?.baseprice, product?.sellingprice].forEach((value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) prices.push(n);
  });

  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const current = Number(option?.currentprice);
      if (Number.isFinite(current) && current >= 0) {
        prices.push(current);
        return;
      }

      const base = Number(option?.baseprice);
      if (Number.isFinite(base) && base >= 0) prices.push(base);
    });
  });

  return prices;
};

const getProductPrice = (product) => {
  const prices = getAllPrices(product);
  if (!prices.length) return 0;
  return Math.min(...prices);
};

const getProductStock = (product) => {
  let total = 0;
  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const stock = Number(option?.stock || 0);
      if (Number.isFinite(stock) && stock > 0) total += stock;
    });
  });
  return total;
};

const getProductLowStock = (product, threshold = 5) => {
  let minPositive = Number.POSITIVE_INFINITY;
  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const stock = Number(option?.stock || 0);
      if (Number.isFinite(stock) && stock > 0 && stock < minPositive) minPositive = stock;
    });
  });

  if (!Number.isFinite(minPositive)) return false;
  return minPositive <= threshold;
};

const getVariantValues = (product, variantType) => {
  const target = normalizeText(variantType).toLowerCase();
  const values = new Set();

  (product?.variants || []).forEach((variant) => {
    const type = normalizeText(variant?.varianttype).toLowerCase();
    if (!type.includes(target)) return;

    if (variant?.name) values.add(normalizeText(variant.name));
    (variant?.options || []).forEach((option) => {
      if (option?.name) values.add(normalizeText(option.name));
    });
  });

  return Array.from(values);
};

const getProductRating = (product) => {
  const n = Number(product?.star);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(5, n);
};

const sortProducts = (products, sort) => {
  const next = [...products];

  if (sort === "price_low_high") {
    next.sort((a, b) => getProductPrice(a) - getProductPrice(b));
    return next;
  }

  if (sort === "price_high_low") {
    next.sort((a, b) => getProductPrice(b) - getProductPrice(a));
    return next;
  }

  if (sort === "name_az") {
    next.sort((a, b) => normalizeText(a?.name).localeCompare(normalizeText(b?.name)));
    return next;
  }

  if (sort === "oldest") {
    next.sort((a, b) => new Date(a?.createdAt || a?.createdat || 0) - new Date(b?.createdAt || b?.createdat || 0));
    return next;
  }

  if (sort === "rating_high_low") {
    next.sort((a, b) => getProductRating(b) - getProductRating(a));
    return next;
  }

  next.sort((a, b) => new Date(b?.createdAt || b?.createdat || 0) - new Date(a?.createdAt || a?.createdat || 0));
  return next;
};

const buildShopFilters = (products = []) => {
  const colors = new Set();
  const sizes = new Set();
  const brands = new Set();
  const prices = [];
  const ratings = [];

  let inStock = 0;
  let outOfStock = 0;

  products.forEach((product) => {
    getVariantValues(product, "color").forEach((value) => colors.add(value));
    getVariantValues(product, "size").forEach((value) => sizes.add(value));

    const brand = normalizeText(product?.brand);
    if (brand) brands.add(brand);

    prices.push(...getAllPrices(product));
    ratings.push(getProductRating(product));

    if (getProductStock(product) > 0) inStock += 1;
    else outOfStock += 1;
  });

  const cleanPrices = prices.filter((p) => Number.isFinite(p) && p >= 0);
  const cleanRatings = ratings.filter((r) => Number.isFinite(r) && r >= 0);

  return {
    colors: Array.from(colors).sort((a, b) => a.localeCompare(b)),
    sizes: Array.from(sizes).sort((a, b) => a.localeCompare(b)),
    brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
    minPrice: cleanPrices.length ? Math.min(...cleanPrices) : 0,
    maxPrice: cleanPrices.length ? Math.max(...cleanPrices) : 0,
    minRating: 0,
    maxRating: cleanRatings.length ? Math.min(5, Math.ceil(Math.max(...cleanRatings))) : 0,
    availability: {
      in_stock: inStock,
      out_of_stock: outOfStock,
    },
  };
};

const resolveActor = (req) => {
  const userId = req.user?.userId;
  if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    return {
      type: "user",
      userid: new mongoose.Types.ObjectId(String(userId)),
      guestsessionid: "",
      actorkey: `user:${String(userId)}`,
    };
  }

  const guestsessionid = normalizeGuestId(
    req.headers?.["x-guest-session"] || req.query?.guestsessionid || req.body?.guestsessionid || ""
  );

  if (!guestsessionid) return null;
  return {
    type: "guest",
    userid: null,
    guestsessionid,
    actorkey: `guest:${guestsessionid}`,
  };
};

const ensureAuthUser = async (req, res) => {
  const userId = req.user?.userId;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userId).select("_id fullname email role").lean();
  if (!me) {
    res.status(404).json({ success: false, message: "User not found." });
    return null;
  }

  return me;
};

const ensureSuperAdmin = async (req, res) => {
  const me = await ensureAuthUser(req, res);
  if (!me) return null;
  if (me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

const ensureBuyer = async (req, res) => {
  const me = await ensureAuthUser(req, res);
  if (!me) return null;
  if (me.role !== "User") {
    res.status(403).json({ success: false, message: "Only buyers can perform this action." });
    return null;
  }
  return me;
};

const uploadMediaFromFiles = async (files = []) => {
  const prepared = [];

  for (const file of files || []) {
    if (!file?.path) continue;

    let uploaded = "";
    try {
      uploaded = await uploadoncloudinary(file.path);
    } catch (_error) {
      uploaded = `/public/${path.basename(file.path)}`;
    }

    if (!uploaded) continue;
    const type = String(file?.mimetype || "").toLowerCase().startsWith("video/") ? "video" : "image";
    prepared.push({ url: uploaded, type, name: normalizeText(file?.originalname) });
  }

  return prepared;
};

const getDeliveredBuyerStatus = async (userid, shopid) => {
  if (!userid || !shopid) return false;
  const productids = await Item.find({ shopid, isselleritem: true }).select("_id").lean();
  const ids = productids.map((entry) => entry._id).filter(Boolean);
  if (!ids.length) return false;

  const delivered = await Order.exists({
    userid,
    status: "delivered",
    "items.productid": { $in: ids },
  });
  return Boolean(delivered);
};

const computeRatingSummary = async (shopid) => {
  const stats = await SellerShopRating.aggregate([
    { $match: { shopid: new mongoose.Types.ObjectId(String(shopid)) } },
    { $group: { _id: "$shopid", average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return { average: Number(stats?.[0]?.average || 0), count: Number(stats?.[0]?.count || 0) };
};

const buildCategoryRankMap = (products = []) => {
  const grouped = new Map();
  (products || []).forEach((product) => {
    const pathParts = normalizeText(product?.categorypath)
      .split(/\s*>\s*/)
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    const leaf =
      normalizeText(Array.isArray(product?.categorytree) && product.categorytree.length ? product.categorytree[product.categorytree.length - 1] : "") ||
      pathParts[pathParts.length - 1] ||
      "Category";
    if (!grouped.has(leaf)) grouped.set(leaf, []);
    grouped.get(leaf).push(product);
  });

  const rankMap = new Map();
  grouped.forEach((rows, leaf) => {
    rows.sort((a, b) => Number(b?.totalsold || 0) - Number(a?.totalsold || 0)).forEach((product, idx) => {
      rankMap.set(String(product._id), { rank: idx + 1, categoryname: leaf });
    });
  });
  return rankMap;
};

const enrichProductsForStorefront = ({
  products = [],
  storebadges = [],
  starseller = false,
  returnrate = 0,
  engagementscore = 0,
}) => {
  const rankMap = buildCategoryRankMap(products);
  return products.map((product) => {
    const rankMeta = rankMap.get(String(product._id)) || { rank: null, categoryname: "" };
    const cardMeta = buildProductCardBadges({
      product,
      storebadges,
      starseller,
      categoryrank: rankMeta.rank,
      categoryname: rankMeta.categoryname,
      engagementscore,
      returnrate,
    });
    const stock = getProductStock(product);
    return {
      ...product,
      cardmeta: {
        ...cardMeta,
        stockstatus: {
          instock: stock > 0,
          outofstock: stock <= 0,
          lowstock: getProductLowStock(product),
        },
      },
    };
  });
};

const computeOrderHealthMetrics = async (shopid) => {
  const productRows = await Item.find({ shopid, isselleritem: true }).select("_id").lean();
  const productIds = productRows.map((entry) => entry._id).filter(Boolean);
  if (!productIds.length) return { returnrate: 0, cancellationrate: 0 };

  const orderStats = await Order.aggregate([
    { $match: { status: { $in: ["delivered", "returned", "canceled"] }, "items.productid": { $in: productIds } } },
    { $unwind: "$items" },
    { $match: { "items.productid": { $in: productIds } } },
    { $group: { _id: "$status", qty: { $sum: { $ifNull: ["$items.quantity", 0] } } } },
  ]);

  const deliveredqty = Number(orderStats.find((row) => row._id === "delivered")?.qty || 0);
  const returnedqty = Number(orderStats.find((row) => row._id === "returned")?.qty || 0);
  const canceledqty = Number(orderStats.find((row) => row._id === "canceled")?.qty || 0);
  const deliveredBase = Math.max(1, deliveredqty + returnedqty);
  const overallBase = Math.max(1, deliveredqty + returnedqty + canceledqty);

  return {
    returnrate: Number((returnedqty / deliveredBase).toFixed(4)),
    cancellationrate: Number((canceledqty / overallBase).toFixed(4)),
  };
};

const computeEngagementScore = async (productIds = []) => {
  if (!productIds.length) return 0;

  const stats = await UserProductBehavior.aggregate([
    { $match: { productid: { $in: productIds } } },
    { $group: { _id: null, clicks: { $sum: "$clickcount" }, views: { $sum: "$detailviewcount" }, carts: { $sum: "$cartadds" }, orders: { $sum: "$ordercount" } } },
  ]);

  const row = stats?.[0] || {};
  const score = Number(row.clicks || 0) * 0.8 + Number(row.views || 0) * 0.9 + Number(row.carts || 0) * 2 + Number(row.orders || 0) * 4;
  return Number(score.toFixed(2));
};

const getStoreBadges = async (shop) => {
  const ids = Array.isArray(shop?.badgeids) ? shop.badgeids : [];
  if (!ids.length) return [];
  return SellerBadge.find({ _id: { $in: ids }, isactive: true }).select("_id name slug image priority").sort({ priority: 1, createdAt: -1 }).lean();
};

exports.getPublicShopProfile = async (req, res) => {
  try {
    const payload = sanitize(req.query || {});
    const slug = normalizeText(req.params?.slug).toLowerCase();
    if (!slug) return res.status(400).json({ success: false, message: "Shop slug is required." });

    const actor = resolveActor(req);
    const shop = await SellerShop.findOne({ slug })
      .populate("sellerid", "_id fullname usersavatar role")
      .lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const allProductsRaw = await Item.find({
      shopid: shop._id,
      sellerid: shop.sellerid?._id || shop.sellerid,
      isselleritem: true,
      isactive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const [storeBadges, followCount, ratingSummary, orderHealth] = await Promise.all([
      getStoreBadges(shop),
      SellerShopFollow.countDocuments({ shopid: shop._id }),
      computeRatingSummary(shop._id),
      computeOrderHealthMetrics(shop._id),
    ]);

    const productIds = allProductsRaw.map((entry) => entry._id).filter(Boolean);
    const engagementScore = await computeEngagementScore(productIds);

    const starSellerMeta = computeStarSellerScore({
      healthscore: Number(shop.healthscore || 0),
      averageRating: Number(ratingSummary.average || 0),
      totalSales: allProductsRaw.reduce((sum, product) => sum + Math.max(0, Number(product?.totalsold || 0)), 0),
      returnRate: Number(orderHealth.returnrate || 0),
      cancellationRate: Number(orderHealth.cancellationrate || 0),
      productCount: allProductsRaw.length,
      engagementScore,
    });

    const allProducts = enrichProductsForStorefront({
      products: allProductsRaw,
      storebadges: storeBadges,
      starseller: Boolean(starSellerMeta.isstarseller),
      returnrate: Number(orderHealth.returnrate || 0),
      engagementscore: engagementScore,
    });

    const shopFilters = buildShopFilters(allProducts);
    const selectedColors = normalizeText(payload.colors).split(",").map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean);
    const selectedSizes = normalizeText(payload.sizes).split(",").map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean);
    const selectedBrands = normalizeText(payload.brands).split(",").map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean);
    const availability = normalizeText(payload.availability).toLowerCase();
    const search = normalizeText(payload.search || payload.q).toLowerCase();
    const minPrice = payload.minprice === undefined || payload.minprice === "" ? null : toNumber(payload.minprice, null);
    const maxPrice = payload.maxprice === undefined || payload.maxprice === "" ? null : toNumber(payload.maxprice, null);
    const minRating = payload.minrating === undefined || payload.minrating === "" ? null : toNumber(payload.minrating, null);
    const maxRating = payload.maxrating === undefined || payload.maxrating === "" ? null : toNumber(payload.maxrating, null);
    const sort = normalizeText(payload.sort || "newest").toLowerCase();

    const filtered = allProducts.filter((product) => {
      const colors = getVariantValues(product, "color").map((entry) => normalizeText(entry).toLowerCase());
      const sizes = getVariantValues(product, "size").map((entry) => normalizeText(entry).toLowerCase());
      const brand = normalizeText(product?.brand).toLowerCase();
      const stock = getProductStock(product);
      const rating = getProductRating(product);
      const prices = getAllPrices(product);

      if (selectedColors.length && !selectedColors.some((entry) => colors.includes(entry))) return false;
      if (selectedSizes.length && !selectedSizes.some((entry) => sizes.includes(entry))) return false;
      if (selectedBrands.length && (!brand || !selectedBrands.includes(brand))) return false;
      if (availability === "in_stock" && stock <= 0) return false;
      if (availability === "out_of_stock" && stock > 0) return false;
      if (minRating !== null && rating < minRating) return false;
      if (maxRating !== null && rating > maxRating) return false;

      if (minPrice !== null || maxPrice !== null) {
        const hasPriceMatch = prices.some((price) => {
          if (minPrice !== null && price < minPrice) return false;
          if (maxPrice !== null && price > maxPrice) return false;
          return true;
        });
        if (!hasPriceMatch) return false;
      }

      if (search) {
        const haystack = [
          product?.name,
          product?.brand,
          product?.categorypath,
          ...(Array.isArray(product?.categorytree) ? product.categorytree : []),
          ...(Array.isArray(product?.tags) ? product.tags : []),
        ]
          .map((entry) => normalizeText(entry).toLowerCase())
          .filter(Boolean)
          .join(" ");
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const sorted = sortProducts(filtered, sort);
    const page = Math.max(1, toNumber(payload.page, 1));
    const limit = Math.max(1, Math.min(80, toNumber(payload.limit, 24)));
    const start = (page - 1) * limit;
    const paginated = sorted.slice(start, start + limit);

    const following = actor
      ? Boolean(await SellerShopFollow.exists({ shopid: shop._id, actorkey: actor.actorkey }))
      : false;
    const joinedDays = Math.max(0, Math.floor((Date.now() - new Date(shop.createdAt || Date.now()).getTime()) / (24 * 60 * 60 * 1000)));
    const totalSales = allProducts.reduce((sum, product) => sum + Math.max(0, Number(product?.totalsold || 0)), 0);

    return res.status(200).json({
      success: true,
      shop: {
        _id: shop._id,
        shopname: shop.shopname,
        slug: shop.slug,
        profileimage: shop.profileimage,
        bannerimage: shop.bannerimage,
        description: shop.description,
        contactemail: shop.contactemail,
        contactphone: shop.contactphone,
        address: shop.address,
        healthscore: Number(shop.healthscore || 0),
        joineddays: joinedDays,
        badges: storeBadges,
        starseller: {
          isstarseller: Boolean(starSellerMeta.isstarseller),
          score: Number(starSellerMeta.score || 0),
          metrics: {
            returnrate: Number(orderHealth.returnrate || 0),
            cancellationrate: Number(orderHealth.cancellationrate || 0),
            engagementscore: engagementScore,
          },
        },
        social: {
          followers: Number(followCount || 0),
          ratingaverage: Number(ratingSummary.average || 0),
          ratingcount: Number(ratingSummary.count || 0),
          following,
        },
        seller: {
          _id: shop.sellerid?._id || null,
          fullname: shop.sellerid?.fullname || "Seller",
          usersavatar: shop.sellerid?.usersavatar || "",
        },
      },
      stats: {
        totalproducts: allProducts.length,
        totalsales: totalSales,
        averageRating: Number(ratingSummary.average || 0),
        ratingcount: Number(ratingSummary.count || 0),
      },
      filters: shopFilters,
      count: sorted.length,
      page,
      pages: Math.max(1, Math.ceil(sorted.length / limit)),
      products: paginated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop profile." });
  }
};

exports.toggleShopFollow = async (req, res) => {
  try {
    const actor = resolveActor(req);
    if (!actor) {
      return res.status(400).json({ success: false, message: "Sign in or provide a guest session to follow store." });
    }

    const slug = normalizeText(req.params?.slug).toLowerCase();
    if (!slug) return res.status(400).json({ success: false, message: "Shop slug is required." });

    const shop = await SellerShop.findOne({ slug }).select("_id").lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const existing = await SellerShopFollow.findOne({ shopid: shop._id, actorkey: actor.actorkey });
    let following = false;
    if (existing) {
      await existing.deleteOne();
      following = false;
    } else {
      await SellerShopFollow.create({
        shopid: shop._id,
        actorkey: actor.actorkey,
        userid: actor.userid || null,
        guestsessionid: actor.guestsessionid || "",
      });
      following = true;
    }

    const followers = await SellerShopFollow.countDocuments({ shopid: shop._id });
    return res.status(200).json({ success: true, following, followers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update follow state." });
  }
};

exports.rateShop = async (req, res) => {
  try {
    const buyer = await ensureBuyer(req, res);
    if (!buyer) return;

    const slug = normalizeText(req.params?.slug).toLowerCase();
    if (!slug) return res.status(400).json({ success: false, message: "Shop slug is required." });

    const payload = sanitize(req.body || {});
    const rating = Math.max(1, Math.min(5, Math.round(toNumber(payload.rating, 0))));
    const review = normalizeText(payload.review).slice(0, 1000);
    if (!rating) return res.status(400).json({ success: false, message: "Rating is required." });

    const shop = await SellerShop.findOne({ slug }).select("_id sellerid").lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const isVerifiedBuyer = await getDeliveredBuyerStatus(buyer._id, shop._id);
    if (!isVerifiedBuyer) {
      return res.status(403).json({ success: false, message: "Only delivered buyers can rate this store." });
    }

    await SellerShopRating.findOneAndUpdate(
      { shopid: shop._id, userid: buyer._id },
      { $set: { rating, review, isverifiedbuyer: true } },
      { upsert: true, new: true }
    );

    const summary = await computeRatingSummary(shop._id);
    if (shop.sellerid) {
      await pushKhanNotification({
        recipientkind: "seller",
        recipientid: shop.sellerid,
        type: "Info",
        channel: "store",
        title: "New store rating",
        message: `${buyer.fullname || "A buyer"} rated your store ${rating}/5.`,
        metadata: { shopid: String(shop._id), rating },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Store rating submitted.",
      summary: {
        average: Number(summary.average || 0),
        count: Number(summary.count || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to submit rating." });
  }
};

exports.reportShop = async (req, res) => {
  try {
    const buyer = await ensureBuyer(req, res);
    if (!buyer) return;

    const slug = normalizeText(req.params?.slug).toLowerCase();
    if (!slug) return res.status(400).json({ success: false, message: "Shop slug is required." });

    const payload = sanitize(req.body || {});
    const reason = normalizeText(payload.reason).slice(0, 180);
    const details = normalizeText(payload.details).slice(0, 4000);
    if (!reason) return res.status(400).json({ success: false, message: "Report reason is required." });

    const shop = await SellerShop.findOne({ slug }).select("_id sellerid shopname").lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const isVerifiedBuyer = await getDeliveredBuyerStatus(buyer._id, shop._id);
    if (!isVerifiedBuyer) {
      return res.status(403).json({ success: false, message: "Only delivered buyers can report this store." });
    }

    const evidence = await uploadMediaFromFiles(req.files || []);
    const report = await SellerShopReport.create({
      shopid: shop._id,
      sellerid: shop.sellerid,
      reporterid: buyer._id,
      reason,
      details,
      evidence,
      status: "Pending",
    });

    const superAdmins = await User.find({ role: "SuperAdmin" }).select("_id").lean();
    await Promise.all(
      (superAdmins || []).map((admin) =>
        pushKhanNotification({
          recipientkind: "superadmin",
          recipientid: admin._id,
          type: "Warning",
          channel: "moderation",
          title: "New store report",
          message: `${buyer.fullname || "Buyer"} reported store ${shop.shopname || "Seller Store"}.`,
          metadata: { reportid: String(report._id), shopid: String(shop._id), sellerid: String(shop.sellerid || "") },
        })
      )
    );

    return res.status(201).json({ success: true, message: "Store report submitted.", reportid: report._id });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to submit report." });
  }
};
