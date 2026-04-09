const mongoose = require("mongoose");
const sanitize = require("mongo-sanitize");
const Item = require("../models/Item");
const Order = require("../models/Order");
const Wishlist = require("../models/Wishlist");
const User = require("../models/User");
const UserProductBehavior = require("../models/UserProductBehavior");
const {
  toSafeString,
  toSafeNumber,
  slugifyLoose,
  extractCategoryTokens,
  getLowestPrice,
  getTopDiscount,
  resolveActor,
  resolveProductForSignal,
  recordBehaviorSignal,
} = require("../utils/RecommendationSignals");

const ALLOWED_TRACK_EVENTS = new Set([
  "product_click",
  "product_view",
  "wishlist_add",
  "wishlist_remove",
  "add_to_cart",
  "order",
  "dwell",
]);

const productBelongsToCategorySlug = (product, slug) => {
  const normalizedSlug = slugifyLoose(slug);
  if (!normalizedSlug) return true;
  const tokens = extractCategoryTokens(product);
  return tokens.includes(normalizedSlug);
};

const buildUserAffinity = (signals = []) => {
  const seenProducts = new Set();
  const categoryWeight = new Map();
  const brandWeight = new Map();
  let weightedPrice = 0;
  let weightedPriceWeight = 0;

  signals.forEach((entry) => {
    const productid = String(entry.productid || "");
    if (productid) seenProducts.add(productid);

    const signalWeight = Math.max(0, Number(entry.signalscore || 0));
    (entry.categorytokens || []).forEach((token) => {
      const key = slugifyLoose(token);
      if (!key) return;
      categoryWeight.set(key, (categoryWeight.get(key) || 0) + signalWeight);
    });

    const brand = toSafeString(entry.brand).toLowerCase();
    if (brand) {
      brandWeight.set(brand, (brandWeight.get(brand) || 0) + signalWeight);
    }

    const pricepoint = Number(entry.pricepoint || 0);
    if (pricepoint > 0 && signalWeight > 0) {
      weightedPrice += pricepoint * signalWeight;
      weightedPriceWeight += signalWeight;
    }
  });

  return {
    seenProducts,
    categoryWeight,
    brandWeight,
    avgPrice:
      weightedPrice > 0 && weightedPriceWeight > 0
        ? weightedPrice / weightedPriceWeight
        : 0,
  };
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getReason = ({ categoryBoost, brandBoost, signalBoost, orderBoost, popularityBoost }) => {
  if (orderBoost > 6) return "Based on products you buy often";
  if (signalBoost > 10) return "Because you interacted with similar products";
  if (categoryBoost > 8) return "From your favorite category";
  if (brandBoost > 4) return "Matches your preferred brand";
  if (popularityBoost > 10) return "Trending on KhanCosmetics";
  return "Picked for you";
};

const escapeRegExp = (value) =>
  toSafeString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getLogBoost = (value) => Math.log1p(Math.max(0, Number(value || 0)));

const buildItemCard = (item, extras = {}) => ({
  ...item,
  recommendationmeta: {
    score: Number(Number(extras.score || 0).toFixed(3)),
    reason: toSafeString(extras.reason),
    confidence: Number(Number(extras.confidence || 0).toFixed(3)),
    ...extras,
  },
});

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("_id role fullname").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

exports.trackRecommendationEvent = async (req, res) => {
  try {
    const payload = sanitize(req.body || {});
    const eventtype = toSafeString(payload.eventtype).toLowerCase();

    if (!ALLOWED_TRACK_EVENTS.has(eventtype)) {
      return res.status(400).json({ success: false, message: "Invalid event type" });
    }

    const actor = resolveActor(req, payload);
    if (!actor) {
      return res.status(400).json({
        success: false,
        message: "Session key or signed-in user required",
      });
    }

    const product = await resolveProductForSignal({
      slug: payload.slug,
      productid: payload.productid,
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await recordBehaviorSignal({
      actor,
      product,
      eventtype,
      dwellseconds: toSafeNumber(payload.dwellseconds, 0),
      quantity: toSafeNumber(payload.quantity, 1),
    });

    return res.status(200).json({ success: true, message: "Signal tracked" });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to track recommendation signal",
      error: error.message,
    });
  }
};

exports.getPersonalizedRecommendations = async (req, res) => {
  try {
    const query = sanitize(req.query || {});
    const limit = clamp(toSafeNumber(query.limit, 72), 6, 240);
    const categoryslug = slugifyLoose(query.categoryslug);
    const excludeProductId = toSafeString(query.excludeproductid);

    const actor = resolveActor(req, query);

    const userSignals = actor?.actorid
      ? await UserProductBehavior.find({ actorid: actor.actorid })
          .sort({ signalscore: -1, lastinteractedat: -1 })
          .limit(320)
          .lean()
      : [];

    const affinity = buildUserAffinity(userSignals);
    const isPersonalized = userSignals.length > 0;

    const rawCandidates = await Item.find({ isactive: true })
      .select(
        "_id slug name brand whiteimage hoverimage gallery variants star reviewcount totalsold categorytree categorypath createdAt createdat"
      )
      .sort({ createdAt: -1, createdat: -1 })
      .limit(1500)
      .lean();

    const filteredCandidates = rawCandidates.filter((product) => {
      if (
        excludeProductId &&
        mongoose.Types.ObjectId.isValid(excludeProductId) &&
        String(product._id) === String(excludeProductId)
      ) {
        return false;
      }
      if (categoryslug && !productBelongsToCategorySlug(product, categoryslug)) return false;
      return true;
    });

    const candidateIds = filteredCandidates.map((product) => product._id);

    const [wishlistAgg, orderAgg, behaviorAgg] = await Promise.all([
      Wishlist.aggregate([
        { $match: { productid: { $in: candidateIds } } },
        { $group: { _id: "$productid", wishlistcount: { $sum: 1 } } },
      ]),
      Order.aggregate([
        {
          $match: {
            status: "delivered",
            "items.productid": { $in: candidateIds },
          },
        },
        { $unwind: "$items" },
        { $match: { "items.productid": { $in: candidateIds } } },
        {
          $group: {
            _id: "$items.productid",
            deliveredorders: { $sum: 1 },
            deliveredqty: { $sum: { $ifNull: ["$items.quantity", 0] } },
          },
        },
      ]),
      UserProductBehavior.aggregate([
        { $match: { productid: { $in: candidateIds } } },
        {
          $group: {
            _id: "$productid",
            totalsignal: { $sum: "$signalscore" },
            totalclicks: { $sum: "$clickcount" },
            totaldwell: { $sum: "$dwelltotalseconds" },
          },
        },
      ]),
    ]);

    const wishlistMap = new Map(wishlistAgg.map((row) => [String(row._id), row]));
    const orderMap = new Map(orderAgg.map((row) => [String(row._id), row]));
    const behaviorMap = new Map(behaviorAgg.map((row) => [String(row._id), row]));
    const userSignalByProduct = new Map(
      userSignals.map((signal) => [String(signal.productid), signal])
    );

    const now = Date.now();

    const scored = filteredCandidates.map((product) => {
      const productId = String(product._id);
      const tokens = extractCategoryTokens(product);
      const brand = toSafeString(product.brand).toLowerCase();
      const price = getLowestPrice(product);
      const discountPct = getTopDiscount(product);
      const star = clamp(toSafeNumber(product.star, 0), 0, 5);
      const reviewcount = Math.max(0, toSafeNumber(product.reviewcount, 0));
      const totalsold = Math.max(0, toSafeNumber(product.totalsold, 0));

      const wishlistcount = Math.max(
        0,
        toSafeNumber(wishlistMap.get(productId)?.wishlistcount, 0)
      );
      const deliveredorders = Math.max(
        0,
        toSafeNumber(orderMap.get(productId)?.deliveredorders, 0)
      );
      const deliveredqty = Math.max(
        0,
        toSafeNumber(orderMap.get(productId)?.deliveredqty, 0)
      );
      const totalsignal = Math.max(
        0,
        toSafeNumber(behaviorMap.get(productId)?.totalsignal, 0)
      );

      const popularityBoost =
        totalsold * 1.6 +
        deliveredqty * 1.7 +
        deliveredorders * 2.2 +
        wishlistcount * 1.2 +
        star * 4 +
        Math.min(reviewcount, 300) * 0.08 +
        totalsignal * 0.08;

      let categoryBoost = 0;
      tokens.forEach((token) => {
        categoryBoost += (affinity.categoryWeight.get(token) || 0) * 0.16;
      });
      categoryBoost = Math.min(22, categoryBoost);

      const brandBoost = Math.min(14, (affinity.brandWeight.get(brand) || 0) * 0.18);

      const signalEntry = userSignalByProduct.get(productId);
      const signalBoost = signalEntry
        ? Math.min(24, toSafeNumber(signalEntry.signalscore, 0) * 0.75)
        : 0;

      const orderBoost = signalEntry
        ? Math.min(20, toSafeNumber(signalEntry.orderedqty, 0) * 5)
        : 0;

      let priceBoost = 0;
      if (affinity.avgPrice > 0 && price > 0) {
        const ratio = Math.abs(price - affinity.avgPrice) / affinity.avgPrice;
        if (ratio <= 0.2) priceBoost = 4;
        else if (ratio <= 0.4) priceBoost = 2;
      }

      let freshnessBoost = 0;
      const createdAtRaw = product.createdAt || product.createdat;
      const createdAt = createdAtRaw ? new Date(createdAtRaw).getTime() : 0;
      if (createdAt > 0) {
        const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
        if (ageDays <= 30) freshnessBoost = 4;
        else if (ageDays <= 90) freshnessBoost = 2;
      }

      const discountBoost = Math.min(8, Math.max(0, discountPct) * 0.12);
      const categoryContextBoost = categoryslug ? 7 : 0;

      const unseenExplorationBoost = affinity.seenProducts.has(productId) ? -3 : 2.5;

      const totalScore =
        popularityBoost +
        categoryBoost +
        brandBoost +
        signalBoost +
        orderBoost +
        priceBoost +
        freshnessBoost +
        discountBoost +
        categoryContextBoost +
        unseenExplorationBoost;

      return {
        ...product,
        recscore: Number(totalScore.toFixed(3)),
        reccardreason: getReason({
          categoryBoost,
          brandBoost,
          signalBoost,
          orderBoost,
          popularityBoost,
        }),
      };
    });

    scored.sort((a, b) => b.recscore - a.recscore);

    const data = scored.slice(0, limit);

    return res.status(200).json({
      success: true,
      mode: isPersonalized ? "personalized" : "popular-fallback",
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to generate recommendations",
      error: error.message,
    });
  }
};

exports.getProductPageRecommendations = async (req, res) => {
  try {
    const params = sanitize(req.params || {});
    const query = sanitize(req.query || {});
    const slug = toSafeString(params.slug);
    const sectionlimit = clamp(toSafeNumber(query.sectionlimit, 12), 4, 24);

    if (!slug) {
      return res.status(400).json({ success: false, message: "Product slug is required" });
    }

    const product = await Item.findOne({ slug, isactive: true })
      .select(
        "_id slug name brand whiteimage hoverimage gallery variants star reviewcount totalsold categorytree categorypath createdAt createdat"
      )
      .lean();

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const productId = product._id;
    const targetCategoryTokens = extractCategoryTokens(product);
    const targetBrand = toSafeString(product.brand).toLowerCase();
    const targetPrice = getLowestPrice(product);
    const categoryLeafRaw = Array.isArray(product.categorytree) && product.categorytree.length
      ? toSafeString(product.categorytree[product.categorytree.length - 1])
      : toSafeString(product.categorypath).split(/\s*(?:>|\/|\\|,|\|)\s*/).filter(Boolean).pop() || "";
    const leafRegex = categoryLeafRaw ? new RegExp(escapeRegExp(categoryLeafRaw), "i") : null;

    const [targetOrderCountAgg, boughtTogetherAgg, alsoViewedBaseAgg] = await Promise.all([
      Order.aggregate([
        { $match: { status: "delivered", "items.productid": productId } },
        { $count: "count" },
      ]),
      Order.aggregate([
        { $match: { status: "delivered", "items.productid": productId } },
        { $unwind: "$items" },
        { $match: { "items.productid": { $ne: productId } } },
        {
          $group: {
            _id: "$items.productid",
            togetherorders: { $sum: 1 },
            togetherqty: { $sum: { $ifNull: ["$items.quantity", 0] } },
          },
        },
        { $sort: { togetherorders: -1, togetherqty: -1 } },
        { $limit: 200 },
      ]),
      UserProductBehavior.aggregate([
        {
          $match: {
            productid: productId,
            $or: [{ detailviewcount: { $gt: 0 } }, { clickcount: { $gt: 0 } }],
          },
        },
        {
          $project: {
            actorid: 1,
            actorweight: {
              $add: [
                { $multiply: [{ $ifNull: ["$detailviewcount", 0] }, 2] },
                { $ifNull: ["$clickcount", 0] },
                { $multiply: [{ $ifNull: ["$wishlistadds", 0] }, 2] },
                { $multiply: [{ $ifNull: ["$cartadds", 0] }, 3] },
              ],
            },
          },
        },
        { $sort: { actorweight: -1 } },
        { $limit: 1800 },
      ]),
    ]);

    const targetOrderCount = Number(targetOrderCountAgg?.[0]?.count || 0);

    const boughtTogetherIds = boughtTogetherAgg.map((row) => row._id);
    const alsoViewedActors = alsoViewedBaseAgg
      .map((row) => toSafeString(row.actorid))
      .filter(Boolean);

    const alsoViewedAggPromise = alsoViewedActors.length
      ? UserProductBehavior.aggregate([
          {
            $match: {
              actorid: { $in: alsoViewedActors },
              productid: { $ne: productId },
            },
          },
          {
            $group: {
              _id: "$productid",
              totalscore: { $sum: "$signalscore" },
              totalviews: { $sum: "$detailviewcount" },
              totalclicks: { $sum: "$clickcount" },
              uniqueactors: { $addToSet: "$actorid" },
            },
          },
          { $sort: { totalscore: -1, totalviews: -1, totalclicks: -1 } },
          { $limit: 300 },
        ])
      : Promise.resolve([]);

    const similarityOr = [
      ...(targetBrand
        ? [{ brand: { $regex: new RegExp(`^${escapeRegExp(product.brand)}$`, "i") } }]
        : []),
      ...(Array.isArray(product.categorytree) && product.categorytree.length
        ? [{ categorytree: { $in: product.categorytree } }]
        : []),
      ...(leafRegex ? [{ categorypath: leafRegex }] : []),
    ];

    const similarityQuery = {
      isactive: true,
      _id: { $ne: productId },
      ...(similarityOr.length ? { $or: similarityOr } : {}),
    };

    const [similarCandidates, boughtTogetherItems, alsoViewedAgg, dealCandidates] = await Promise.all([
      Item.find(similarityQuery)
        .select(
          "_id slug name brand whiteimage hoverimage gallery variants star reviewcount totalsold categorytree categorypath createdAt createdat"
        )
        .limit(700)
        .lean(),
      boughtTogetherIds.length
        ? Item.find({ _id: { $in: boughtTogetherIds }, isactive: true })
            .select(
              "_id slug name brand whiteimage hoverimage gallery variants star reviewcount totalsold categorytree categorypath createdAt createdat"
            )
            .lean()
        : Promise.resolve([]),
      alsoViewedAggPromise,
      Item.find({ _id: { $ne: productId }, isactive: true })
        .select(
          "_id slug name brand whiteimage hoverimage gallery variants star reviewcount totalsold categorytree categorypath createdAt createdat"
        )
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(1200)
        .lean(),
    ]);

    const productMapById = new Map();
    [...similarCandidates, ...boughtTogetherItems, ...dealCandidates].forEach((entry) => {
      productMapById.set(String(entry._id), entry);
    });

    const frequentlyBoughtTogether = boughtTogetherAgg
      .map((row) => {
        const item = productMapById.get(String(row._id));
        if (!item) return null;
        const togetherorders = Number(row.togetherorders || 0);
        const togetherqty = Number(row.togetherqty || 0);
        const confidence = targetOrderCount > 0 ? togetherorders / targetOrderCount : 0;
        const score = togetherorders * 4 + togetherqty * 1.7 + confidence * 20;
        return buildItemCard(item, {
          score,
          reason: "Frequently bought together by delivered customers",
          confidence,
          togetherorders,
          togetherqty,
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.recommendationmeta.score - a.recommendationmeta.score)
      .slice(0, sectionlimit);

    const similarItems = similarCandidates
      .map((item) => {
        const tokens = extractCategoryTokens(item);
        const overlapCount = tokens.filter((token) => targetCategoryTokens.includes(token)).length;
        const tokenMatchRatio = targetCategoryTokens.length
          ? overlapCount / targetCategoryTokens.length
          : 0;
        const sameBrand = toSafeString(item.brand).toLowerCase() === targetBrand ? 1 : 0;
        const itemPrice = getLowestPrice(item);
        let priceSimilarity = 0;
        if (targetPrice > 0 && itemPrice > 0) {
          const ratio = Math.abs(itemPrice - targetPrice) / targetPrice;
          if (ratio <= 0.15) priceSimilarity = 1;
          else if (ratio <= 0.35) priceSimilarity = 0.6;
          else if (ratio <= 0.55) priceSimilarity = 0.3;
        }

        const score =
          tokenMatchRatio * 70 +
          sameBrand * 18 +
          priceSimilarity * 12 +
          clamp(toSafeNumber(item.star, 0), 0, 5) * 2.5 +
          getLogBoost(item.reviewcount) * 1.7 +
          getLogBoost(item.totalsold) * 2.2;

        return buildItemCard(item, {
          score,
          reason: sameBrand
            ? "Similar category and same brand"
            : "Similar category and matching customer taste",
          confidence: Math.min(1, tokenMatchRatio + sameBrand * 0.15 + priceSimilarity * 0.1),
          overlapcount: overlapCount,
          samebrand: Boolean(sameBrand),
          pricesimilarity: Number(priceSimilarity.toFixed(3)),
        });
      })
      .sort((a, b) => b.recommendationmeta.score - a.recommendationmeta.score)
      .slice(0, sectionlimit);

    const alsoViewedItems = alsoViewedAgg
      .map((row) => {
        const item = productMapById.get(String(row._id));
        if (!item) return null;
        const uniqueactors = Array.isArray(row.uniqueactors) ? row.uniqueactors.length : 0;
        const totalscore = Number(row.totalscore || 0);
        const totalviews = Number(row.totalviews || 0);
        const totalclicks = Number(row.totalclicks || 0);
        const score =
          totalscore * 1.5 + totalviews * 2.3 + totalclicks * 1.6 + uniqueactors * 2.1;
        return buildItemCard(item, {
          score,
          reason: "Customers who viewed this also visited this item",
          confidence: Math.min(1, uniqueactors / Math.max(10, alsoViewedActors.length)),
          uniqueactors,
          totalviews,
          totalclicks,
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.recommendationmeta.score - a.recommendationmeta.score)
      .slice(0, sectionlimit);

    const actor = resolveActor(req, query);
    const userSignals = actor?.actorid
      ? await UserProductBehavior.find({ actorid: actor.actorid })
          .sort({ signalscore: -1, lastinteractedat: -1 })
          .limit(220)
          .lean()
      : [];
    const affinity = buildUserAffinity(userSignals);

    const dealsYouCantMiss = dealCandidates
      .map((item) => {
        const discount = getTopDiscount(item);
        if (discount <= 0) return null;

        const tokens = extractCategoryTokens(item);
        const tokenMatch = tokens.reduce(
          (sum, token) => sum + Number(affinity.categoryWeight.get(token) || 0),
          0
        );
        const brandBoost =
          toSafeString(item.brand).toLowerCase() &&
          affinity.brandWeight.get(toSafeString(item.brand).toLowerCase())
            ? Number(affinity.brandWeight.get(toSafeString(item.brand).toLowerCase()))
            : 0;

        const score =
          discount * 3.4 +
          clamp(toSafeNumber(item.star, 0), 0, 5) * 3 +
          getLogBoost(item.reviewcount) * 2.5 +
          getLogBoost(item.totalsold) * 2 +
          Math.min(18, tokenMatch * 0.2) +
          Math.min(8, brandBoost * 0.15);

        return buildItemCard(item, {
          score,
          reason: "High discount with strong customer performance",
          confidence: Math.min(1, discount / 100 + clamp(toSafeNumber(item.star, 0), 0, 5) / 8),
          discount,
        });
      })
      .filter(Boolean)
      .sort((a, b) => b.recommendationmeta.score - a.recommendationmeta.score)
      .slice(0, sectionlimit);

    return res.status(200).json({
      success: true,
      product: {
        _id: product._id,
        slug: product.slug,
        name: product.name,
      },
      sections: {
        frequentlyboughttogether: frequentlyBoughtTogether,
        similaritems: similarItems,
        alsoviewed: alsoViewedItems,
        dealsyoucantmiss: dealsYouCantMiss,
      },
      meta: {
        sectionlimit,
        targetordercount: targetOrderCount,
        sourceactors: alsoViewedActors.length,
        personalized: Boolean(actor?.actorid && userSignals.length),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product recommendations",
      error: error.message,
    });
  }
};

exports.getRecommendationInsightsAdmin = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const [signalSummary] = await UserProductBehavior.aggregate([
      {
        $group: {
          _id: null,
          totalrows: { $sum: 1 },
          totalclicks: { $sum: "$clickcount" },
          totaldetailviews: { $sum: "$detailviewcount" },
          totalwishlistadds: { $sum: "$wishlistadds" },
          totalwishlistremoves: { $sum: "$wishlistremoves" },
          totalcartadds: { $sum: "$cartadds" },
          totalorders: { $sum: "$ordercount" },
          totalorderedqty: { $sum: "$orderedqty" },
          totaldwellseconds: { $sum: "$dwelltotalseconds" },
          totalsignalscore: { $sum: "$signalscore" },
          uniqueactors: { $addToSet: "$actorid" },
          uniqueproducts: { $addToSet: "$productid" },
        },
      },
    ]);

    const topProductRows = await UserProductBehavior.aggregate([
      {
        $group: {
          _id: "$productid",
          totalsignalscore: { $sum: "$signalscore" },
          totalclicks: { $sum: "$clickcount" },
          totaldetailviews: { $sum: "$detailviewcount" },
          totalwishlistadds: { $sum: "$wishlistadds" },
          totalcartadds: { $sum: "$cartadds" },
          totalorders: { $sum: "$ordercount" },
          totalorderedqty: { $sum: "$orderedqty" },
          totaldwellseconds: { $sum: "$dwelltotalseconds" },
          uniqueactors: { $addToSet: "$actorid" },
        },
      },
      { $sort: { totalsignalscore: -1, totalorders: -1, totalcartadds: -1 } },
      { $limit: 120 },
    ]);

    const topCategories = await UserProductBehavior.aggregate([
      { $unwind: "$categorytokens" },
      {
        $group: {
          _id: "$categorytokens",
          totalsignalscore: { $sum: "$signalscore" },
          totalorders: { $sum: "$ordercount" },
          totalclicks: { $sum: "$clickcount" },
          totaldwellseconds: { $sum: "$dwelltotalseconds" },
        },
      },
      { $sort: { totalsignalscore: -1, totalorders: -1 } },
      { $limit: 20 },
    ]);

    const topBrands = await UserProductBehavior.aggregate([
      {
        $match: {
          brand: { $ne: "" },
        },
      },
      {
        $group: {
          _id: { $toLower: "$brand" },
          totalsignalscore: { $sum: "$signalscore" },
          totalorders: { $sum: "$ordercount" },
          totalclicks: { $sum: "$clickcount" },
          totaldwellseconds: { $sum: "$dwelltotalseconds" },
        },
      },
      { $sort: { totalsignalscore: -1, totalorders: -1 } },
      { $limit: 20 },
    ]);

    const topProductIds = topProductRows.map((row) => row._id);
    const [products, orderRows, wishlistRows] = await Promise.all([
      Item.find({ _id: { $in: topProductIds } })
        .select("_id name slug brand whiteimage hoverimage gallery totalsold star reviewcount")
        .lean(),
      Order.aggregate([
        {
          $match: {
            status: "delivered",
            "items.productid": { $in: topProductIds },
          },
        },
        { $unwind: "$items" },
        { $match: { "items.productid": { $in: topProductIds } } },
        {
          $group: {
            _id: "$items.productid",
            deliveredorders: { $sum: 1 },
            deliveredqty: { $sum: { $ifNull: ["$items.quantity", 0] } },
          },
        },
      ]),
      Wishlist.aggregate([
        { $match: { productid: { $in: topProductIds } } },
        { $group: { _id: "$productid", wishlistcount: { $sum: 1 } } },
      ]),
    ]);

    const productMap = new Map(products.map((entry) => [String(entry._id), entry]));
    const orderMap = new Map(orderRows.map((entry) => [String(entry._id), entry]));
    const wishlistMap = new Map(wishlistRows.map((entry) => [String(entry._id), entry]));

    const topproducts = topProductRows.map((row) => {
      const key = String(row._id);
      const product = productMap.get(key) || {};
      const order = orderMap.get(key) || {};
      const wishlist = wishlistMap.get(key) || {};
      const uniqueActors = Array.isArray(row.uniqueactors) ? row.uniqueactors.length : 0;
      const clickToOrderRate = row.totalclicks
        ? Number(((Number(row.totalorders || 0) / Number(row.totalclicks || 1)) * 100).toFixed(2))
        : 0;
      const opportunityScore = Number(
        (
          Number(row.totalsignalscore || 0) +
          Number(wishlist.wishlistcount || 0) * 1.2 +
          Number(row.totalcartadds || 0) * 3 +
          Number(row.totalorders || 0) * 6
        ).toFixed(3)
      );

      return {
        productid: row._id,
        name: toSafeString(product.name) || "Unknown Product",
        slug: toSafeString(product.slug),
        brand: toSafeString(product.brand),
        image:
          product.whiteimage || product.hoverimage || product.gallery?.[0] || "",
        star: Number(product.star || 0),
        reviewcount: Number(product.reviewcount || 0),
        totalsold: Number(product.totalsold || 0),
        signalscore: Number(Number(row.totalsignalscore || 0).toFixed(3)),
        uniqueactors: uniqueActors,
        clicks: Number(row.totalclicks || 0),
        detailviews: Number(row.totaldetailviews || 0),
        wishlistadds: Number(row.totalwishlistadds || 0),
        cartadds: Number(row.totalcartadds || 0),
        behaviororders: Number(row.totalorders || 0),
        behaviororderedqty: Number(row.totalorderedqty || 0),
        deliveredorders: Number(order.deliveredorders || 0),
        deliveredqty: Number(order.deliveredqty || 0),
        wishlistcount: Number(wishlist.wishlistcount || 0),
        avgdwellseconds:
          uniqueActors > 0
            ? Number((Number(row.totaldwellseconds || 0) / uniqueActors).toFixed(2))
            : 0,
        clicktoorderrate: clickToOrderRate,
        opportunityscore: opportunityScore,
      };
    });

    const summary = {
      generatedby: toSafeString(me.fullname) || "SuperAdmin",
      totalrows: Number(signalSummary?.totalrows || 0),
      uniqueactors: Array.isArray(signalSummary?.uniqueactors)
        ? signalSummary.uniqueactors.length
        : 0,
      uniqueproducts: Array.isArray(signalSummary?.uniqueproducts)
        ? signalSummary.uniqueproducts.length
        : 0,
      totalsignalscore: Number(Number(signalSummary?.totalsignalscore || 0).toFixed(3)),
      totalclicks: Number(signalSummary?.totalclicks || 0),
      totaldetailviews: Number(signalSummary?.totaldetailviews || 0),
      totalwishlistadds: Number(signalSummary?.totalwishlistadds || 0),
      totalwishlistremoves: Number(signalSummary?.totalwishlistremoves || 0),
      totalcartadds: Number(signalSummary?.totalcartadds || 0),
      totalorders: Number(signalSummary?.totalorders || 0),
      totalorderedqty: Number(signalSummary?.totalorderedqty || 0),
      totaldwellseconds: Number(signalSummary?.totaldwellseconds || 0),
      avgdwellsecondsperactor:
        Array.isArray(signalSummary?.uniqueactors) && signalSummary.uniqueactors.length
          ? Number(
              (
                Number(signalSummary?.totaldwellseconds || 0) /
                signalSummary.uniqueactors.length
              ).toFixed(2)
            )
          : 0,
    };

    return res.status(200).json({
      success: true,
      summary,
      topproducts,
      topcategories: topCategories.map((row) => ({
        category: toSafeString(row._id),
        signalscore: Number(Number(row.totalsignalscore || 0).toFixed(3)),
        orders: Number(row.totalorders || 0),
        clicks: Number(row.totalclicks || 0),
        dwellseconds: Number(row.totaldwellseconds || 0),
      })),
      topbrands: topBrands.map((row) => ({
        brand: toSafeString(row._id),
        signalscore: Number(Number(row.totalsignalscore || 0).toFixed(3)),
        orders: Number(row.totalorders || 0),
        clicks: Number(row.totalclicks || 0),
        dwellseconds: Number(row.totaldwellseconds || 0),
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recommendation insights",
      error: error.message,
    });
  }
};
