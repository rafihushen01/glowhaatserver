const crypto = require("crypto");
const mongoose = require("mongoose");
const sanitize = require("mongo-sanitize");
const Item = require("../models/Item");
const User = require("../models/User");
const ProductShare = require("../models/ProductShare");

const ALLOWED_PLATFORMS = new Set(["whatsapp", "facebook", "messenger", "instagram", "browser"]);

const toSafeString = (value) => (value == null ? "" : String(value).trim());
const toSafeLower = (value) => toSafeString(value).toLowerCase();

const toSafeInt = (value, fallback, min = 1, max = 200) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const ensureObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const buildFrontendBaseUrl = () => {
  const fromEnv = toSafeString(process.env.FRONTEND_URL || process.env.SECOND_FRONTEND_URL || "");
  return fromEnv || "http://localhost:3000";
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("_id role").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

const generateShareToken = async () => {
  for (let i = 0; i < 5; i += 1) {
    const token = crypto.randomBytes(10).toString("hex");
    // eslint-disable-next-line no-await-in-loop
    const exists = await ProductShare.exists({ sharetoken: token });
    if (!exists) return token;
  }

  return `${Date.now().toString(36)}${crypto.randomBytes(6).toString("hex")}`;
};

const buildDateRangeFilter = (dateFrom, dateTo) => {
  const createdAt = {};
  if (toSafeString(dateFrom)) {
    const from = new Date(dateFrom);
    if (!Number.isNaN(from.getTime())) createdAt.$gte = from;
  }

  if (toSafeString(dateTo)) {
    const to = new Date(dateTo);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      createdAt.$lte = to;
    }
  }

  return Object.keys(createdAt).length ? createdAt : null;
};

const buildShareMatch = (query = {}) => {
  const match = {};

  const platform = toSafeLower(query.platform);
  if (platform && ALLOWED_PLATFORMS.has(platform)) {
    match.platform = platform;
  }

  if (ensureObjectId(query.userid)) {
    match.sharedby = new mongoose.Types.ObjectId(String(query.userid));
  }

  const mobile = toSafeString(query.mobile);
  if (mobile) {
    match.sharedbymobile = { $regex: mobile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  const category = toSafeString(query.category);
  if (category) {
    const safeCategory = category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.$or = [
      { productcategorypath: { $regex: safeCategory, $options: "i" } },
      { productcategorytree: { $regex: safeCategory, $options: "i" } },
    ];
  }

  const product = toSafeString(query.product);
  if (product) {
    const isId = ensureObjectId(product);
    if (isId) {
      match.productid = new mongoose.Types.ObjectId(product);
    } else {
      const safeProduct = product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.productslug = { $regex: safeProduct, $options: "i" };
    }
  }

  const q = toSafeString(query.q);
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    match.$and = [
      ...(match.$and || []),
      {
        $or: [
          { productname: regex },
          { productslug: regex },
          { sharedbyname: regex },
          { sharedbyemail: regex },
          { sharedbymobile: regex },
        ],
      },
    ];
  }

  const createdAt = buildDateRangeFilter(query.datefrom, query.dateto);
  if (createdAt) match.createdAt = createdAt;

  return match;
};

const escapeCsv = (value) => {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

exports.createShareLink = async (req, res) => {
  try {
    const { slug } = req.params;
    const payload = sanitize(req.body || {});
    const platform = toSafeLower(payload.platform || "browser");

    if (!ALLOWED_PLATFORMS.has(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid share platform",
      });
    }

    const item = await Item.findOne({ slug: toSafeLower(slug), isactive: true })
      .select("_id name slug categorypath categorytree")
      .lean();
    if (!item) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    let sharer = null;
    const userid = req.user?.userId;
    if (ensureObjectId(userid)) {
      sharer = await User.findById(userid).select("_id fullname email mobile").lean();
    }

    const sharetoken = await generateShareToken();
    const shareurl = `${buildFrontendBaseUrl()}/product/${item.slug}?share=${sharetoken}`;

    await ProductShare.create({
      productid: item._id,
      productname: toSafeString(item.name),
      productslug: item.slug,
      productcategorypath: toSafeString(item.categorypath),
      productcategorytree: Array.isArray(item.categorytree) ? item.categorytree : [],
      platform,
      sharedby: sharer?._id || null,
      sharedbyname: toSafeString(sharer?.fullname),
      sharedbyemail: toSafeLower(sharer?.email),
      sharedbymobile: toSafeString(sharer?.mobile),
      sharetoken,
      shareurl,
    });

    return res.status(201).json({
      success: true,
      share: {
        platform,
        sharetoken,
        shareurl,
        product: {
          id: item._id,
          name: item.name,
          slug: item.slug,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create share link",
      error: error.message,
    });
  }
};

exports.registerShareOpen = async (req, res) => {
  try {
    const { token } = req.params;
    const payload = sanitize(req.body || {});
    const visitkey = toSafeString(payload.visitkey).slice(0, 100);

    if (!toSafeString(token)) {
      return res.status(400).json({ success: false, message: "Share token is required" });
    }

    if (!visitkey) {
      const updated = await ProductShare.findOneAndUpdate(
        { sharetoken: token },
        { $inc: { opencount: 1 }, $set: { lastopenedat: new Date() } },
        { new: true }
      )
        .select("_id sharetoken opencount")
        .lean();

      if (!updated) {
        return res.status(404).json({ success: false, message: "Share link not found" });
      }

      return res.status(200).json({
        success: true,
        counted: true,
        opencount: updated.opencount,
      });
    }

    const share = await ProductShare.findOne({ sharetoken: token }).select("_id uniquevisitkeys opencount");
    if (!share) {
      return res.status(404).json({ success: false, message: "Share link not found" });
    }

    if (Array.isArray(share.uniquevisitkeys) && share.uniquevisitkeys.includes(visitkey)) {
      return res.status(200).json({
        success: true,
        counted: false,
        opencount: share.opencount || 0,
      });
    }

    share.opencount = Number(share.opencount || 0) + 1;
    share.lastopenedat = new Date();
    share.uniquevisitkeys = [...(share.uniquevisitkeys || []), visitkey].slice(-2000);
    await share.save();

    return res.status(200).json({
      success: true,
      counted: true,
      opencount: share.opencount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to register share open",
      error: error.message,
    });
  }
};

exports.getShareAnalytics = async (req, res) => {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;

    const query = sanitize(req.query || {});
    const page = toSafeInt(query.page, 1, 1, 5000);
    const limit = toSafeInt(query.limit, 20, 1, 100);
    const skip = (page - 1) * limit;
    const sort = toSafeLower(query.sort || "newest");

    const match = buildShareMatch(query);

    const sortBy = sort === "oldest" ? { createdAt: 1 } : sort === "most_opened" ? { opencount: -1, createdAt: -1 } : { createdAt: -1 };

    const [count, rows, summaryAgg, platformOptions, categoryOptions, productOptions] = await Promise.all([
      ProductShare.countDocuments(match),
      ProductShare.find(match)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .select("productid productname productslug productcategorypath productcategorytree platform sharedby sharedbyname sharedbyemail sharedbymobile shareurl sharetoken opencount createdAt")
        .lean(),
      ProductShare.aggregate([
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalshares: { $sum: 1 },
                  totalopens: { $sum: "$opencount" },
                },
              },
            ],
            platforms: [
              {
                $group: {
                  _id: "$platform",
                  shares: { $sum: 1 },
                  opens: { $sum: "$opencount" },
                },
              },
              { $sort: { shares: -1 } },
            ],
            topproducts: [
              {
                $group: {
                  _id: { productid: "$productid", productname: "$productname", productslug: "$productslug" },
                  shares: { $sum: 1 },
                  opens: { $sum: "$opencount" },
                },
              },
              { $sort: { shares: -1, opens: -1 } },
              { $limit: 10 },
            ],
            topsharers: [
              { $match: { sharedby: { $ne: null } } },
              {
                $group: {
                  _id: {
                    userid: "$sharedby",
                    name: "$sharedbyname",
                    email: "$sharedbyemail",
                    mobile: "$sharedbymobile",
                  },
                  shares: { $sum: 1 },
                  opens: { $sum: "$opencount" },
                },
              },
              { $sort: { shares: -1, opens: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]),
      ProductShare.distinct("platform", match),
      ProductShare.distinct("productcategorypath", { ...match, productcategorypath: { $ne: "" } }),
      ProductShare.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$productid",
            productname: { $first: "$productname" },
            productslug: { $first: "$productslug" },
            shares: { $sum: 1 },
          },
        },
        { $sort: { shares: -1 } },
        { $limit: 50 },
      ]),
    ]);

    const summary = summaryAgg?.[0] || {};
    const overview = summary.overview?.[0] || { totalshares: 0, totalopens: 0 };

    return res.status(200).json({
      success: true,
      count,
      page,
      limit,
      pages: Math.ceil(count / limit),
      rows,
      summary: {
        overview,
        platforms: summary.platforms || [],
        topproducts: summary.topproducts || [],
        topsharers: summary.topsharers || [],
      },
      filters: {
        platforms: platformOptions || [],
        categories: (categoryOptions || []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
        products: (productOptions || []).map((entry) => ({
          productid: entry?._id,
          productname: entry?.productname || "",
          productslug: entry?.productslug || "",
          shares: entry?.shares || 0,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch share analytics",
      error: error.message,
    });
  }
};

exports.exportShareAnalyticsCsv = async (req, res) => {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;

    const query = sanitize(req.query || {});
    const sort = toSafeLower(query.sort || "newest");
    const match = buildShareMatch(query);
    const sortBy =
      sort === "oldest"
        ? { createdAt: 1 }
        : sort === "most_opened"
          ? { opencount: -1, createdAt: -1 }
          : { createdAt: -1 };

    const rows = await ProductShare.find(match)
      .sort(sortBy)
      .select(
        "productname productslug productcategorypath platform sharedbyname sharedbyemail sharedbymobile sharetoken shareurl opencount createdAt lastopenedat"
      )
      .lean();

    const headers = [
      "productname",
      "productslug",
      "category",
      "platform",
      "sharedbyname",
      "sharedbyemail",
      "sharedbymobile",
      "sharetoken",
      "shareurl",
      "opencount",
      "createdat",
      "lastopenedat",
    ];

    const csvRows = rows.map((row) =>
      [
        row.productname || "",
        row.productslug || "",
        row.productcategorypath || "",
        row.platform || "",
        row.sharedbyname || "",
        row.sharedbyemail || "",
        row.sharedbymobile || "",
        row.sharetoken || "",
        row.shareurl || "",
        Number(row.opencount || 0),
        row.createdAt ? new Date(row.createdAt).toISOString() : "",
        row.lastopenedat ? new Date(row.lastopenedat).toISOString() : "",
      ]
        .map(escapeCsv)
        .join(",")
    );

    const csv = [headers.join(","), ...csvRows].join("\n");
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=khancosmetics-share-analytics-${stamp}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to export share analytics CSV",
      error: error.message,
    });
  }
};

