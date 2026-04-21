const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const path = require("path");
const SellerShop = require("../models/SellerShop");
const SellerBadge = require("../models/SellerBadge");
const SellerBadgeType = require("../models/SellerBadgeType");
const SellerRequest = require("../models/SellerRequest");
const SellerNotification = require("../models/SellerNotification");
const SellerChatThread = require("../models/SellerChatThread");
const Item = require("../models/Item");
const Order = require("../models/Order");
const User = require("../models/User");
const CreativeAsset = require("../models/CreativeAsset");
const uploadoncloudinary = require("../utils/Cloudinary");
const { encryptChatText } = require("../utils/ChatCrypto");

const DEFAULT_BADGE_TYPES = ["shop", "product", "seller", "customer"];

const normalizeText = (value = "") => String(value || "").trim();
const normalizeLower = (value = "") => normalizeText(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const toBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const normalized = normalizeLower(value);
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};
const slugify = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const toObjectId = (value) => {
  const text = normalizeText(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
};

const ensureRole = async (req, res, role) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userId).select("_id fullname role email usersavatar").lean();
  if (!me) {
    res.status(404).json({ success: false, message: "User not found." });
    return null;
  }

  if (me.role !== role) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }

  return me;
};

const ensureBadgeTypesSeeded = async () => {
  for (const name of DEFAULT_BADGE_TYPES) {
    const slug = slugify(name);
    const existing = await SellerBadgeType.findOne({ slug }).lean();
    if (existing) continue;
    await SellerBadgeType.create({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      slug,
      isdefault: true,
      isactive: true,
      createdbyadminid: null,
    });
  }
};

const uploadSingleFromFiles = async (files = []) => {
  const list = Array.isArray(files) ? files : [];
  const file = list[0];
  if (!file?.path) return "";
  try {
    return await uploadoncloudinary(file.path);
  } catch (_error) {
    return `/public/${path.basename(file.path)}`;
  }
};

const detectAssetKind = (mimetype = "", originalname = "") => {
  const lowerMime = normalizeLower(mimetype);
  const ext = normalizeLower(path.extname(originalname || "")).replace(/^\./, "");

  if (lowerMime.startsWith("image/gif") || ext === "gif") return "gif";
  if (lowerMime.startsWith("image/")) return "image";
  if (lowerMime.startsWith("video/")) return "video";
  if (lowerMime.includes("pdf") || ext === "pdf") return "pdf";
  if (
    lowerMime.includes("spreadsheet") ||
    lowerMime.includes("excel") ||
    ["xls", "xlsx", "csv"].includes(ext)
  ) {
    return "spreadsheet";
  }
  if (
    lowerMime.includes("msword") ||
    lowerMime.includes("wordprocessingml") ||
    lowerMime.includes("text/") ||
    ["doc", "docx", "txt", "rtf"].includes(ext)
  ) {
    return "document";
  }
  return "other";
};

const getLatestSellerRequestMap = async (sellerIds = []) => {
  if (!sellerIds.length) return new Map();
  const rows = await SellerRequest.find({
    userid: { $in: sellerIds },
    status: "Approved",
  })
    .sort({ createdAt: -1 })
    .lean();

  const map = new Map();
  rows.forEach((entry) => {
    const key = String(entry.userid || "");
    if (!key || map.has(key)) return;
    map.set(key, entry);
  });
  return map;
};

const buildShopMetrics = async (shops = []) => {
  if (!shops.length) return new Map();

  const shopIds = shops.map((shop) => shop._id).filter(Boolean);
  const items = await Item.find({ shopid: { $in: shopIds }, isselleritem: true })
    .select("_id shopid totalsold star reviewcount")
    .lean();

  const metricMap = new Map();
  const productToShopMap = new Map();
  items.forEach((item) => {
    const shopKey = String(item.shopid || "");
    if (!metricMap.has(shopKey)) {
      metricMap.set(shopKey, {
        productcount: 0,
        totalsold: 0,
        sumstar: 0,
        maxstar: 0,
        reviewcount: 0,
        deliveredqty: 0,
        returnedqty: 0,
      });
    }
    const row = metricMap.get(shopKey);
    row.productcount += 1;
    row.totalsold += Math.max(0, Number(item.totalsold || 0));
    row.sumstar += Math.max(0, Number(item.star || 0));
    row.maxstar = Math.max(row.maxstar, Math.max(0, Number(item.star || 0)));
    row.reviewcount += Math.max(0, Number(item.reviewcount || 0));
    productToShopMap.set(String(item._id), shopKey);
  });

  const productIds = Array.from(productToShopMap.keys())
    .map((id) => toObjectId(id))
    .filter(Boolean);

  if (productIds.length) {
    const orderRows = await Order.aggregate([
      {
        $match: {
          status: { $in: ["delivered", "returned"] },
          "items.productid": { $in: productIds },
        },
      },
      { $unwind: "$items" },
      { $match: { "items.productid": { $in: productIds } } },
      {
        $group: {
          _id: { productid: "$items.productid", status: "$status" },
          qty: { $sum: { $ifNull: ["$items.quantity", 0] } },
        },
      },
    ]);

    orderRows.forEach((entry) => {
      const productKey = String(entry?._id?.productid || "");
      const shopKey = productToShopMap.get(productKey);
      if (!shopKey || !metricMap.has(shopKey)) return;
      const row = metricMap.get(shopKey);
      if (entry?._id?.status === "delivered") row.deliveredqty += Number(entry.qty || 0);
      if (entry?._id?.status === "returned") row.returnedqty += Number(entry.qty || 0);
    });
  }

  metricMap.forEach((row) => {
    row.averagerating = row.productcount > 0 ? Number((row.sumstar / row.productcount).toFixed(2)) : 0;
    row.returnrate =
      row.deliveredqty + row.returnedqty > 0
        ? Number((row.returnedqty / (row.deliveredqty + row.returnedqty)).toFixed(4))
        : 0;
    row.istopratedshop =
      row.productcount > 0 &&
      row.averagerating >= 4 &&
      row.maxstar >= 4.5 &&
      row.returnrate <= 0.1;
  });

  return metricMap;
};

const getDefaultDecoratorDraft = () => ({
  seo: { title: "", description: "" },
  desktopbanner: "",
  mobilebanner: "",
  desktopprofileimage: "",
  mobileprofileimage: "",
  modules: [],
  template: "blank",
});

const normalizeDecoratorPayload = (payload = {}) => {
  const source = typeof payload === "object" && payload ? payload : {};
  const modules = Array.isArray(source.modules)
    ? source.modules.map((moduleRow, index) => ({
        id: normalizeText(moduleRow?.id) || `module-${Date.now()}-${index}`,
        type: normalizeText(moduleRow?.type).toLowerCase() || "single_banner",
        title: normalizeText(moduleRow?.title),
        subtitle: normalizeText(moduleRow?.subtitle),
        desktopimage: normalizeText(moduleRow?.desktopimage),
        mobileimage: normalizeText(moduleRow?.mobileimage),
        images: Array.isArray(moduleRow?.images)
          ? moduleRow.images.map((entry) => normalizeText(entry)).filter(Boolean)
          : [],
        videourl: normalizeText(moduleRow?.videourl),
        productids: Array.isArray(moduleRow?.productids)
          ? moduleRow.productids.map((entry) => normalizeText(entry)).filter(Boolean)
          : [],
        startat: moduleRow?.startat || null,
        endat: moduleRow?.endat || null,
        navproductid: normalizeText(moduleRow?.navproductid),
        hotspots: Array.isArray(moduleRow?.hotspots)
          ? moduleRow.hotspots
              .map((spot) => ({
                x: Math.max(0, Math.min(100, toNumber(spot?.x, 0))),
                y: Math.max(0, Math.min(100, toNumber(spot?.y, 0))),
                productid: normalizeText(spot?.productid),
                label: normalizeText(spot?.label),
              }))
              .filter((spot) => spot.productid)
          : [],
      }))
    : [];

  return {
    seo: {
      title: normalizeText(source?.seo?.title || source?.seotitle),
      description: normalizeText(source?.seo?.description || source?.seodescription),
    },
    desktopbanner: normalizeText(source.desktopbanner),
    mobilebanner: normalizeText(source.mobilebanner),
    desktopprofileimage: normalizeText(source.desktopprofileimage),
    mobileprofileimage: normalizeText(source.mobileprofileimage),
    modules,
    template: normalizeText(source.template || "blank").toLowerCase() || "blank",
  };
};

const resolvePublishedDecorator = (shop = {}) => {
  const layout = shop?.storelayout || {};
  const ispublished = Boolean(layout?.ispublished);
  const publishedlayout = layout?.publishedlayout || getDefaultDecoratorDraft();
  return {
    ispublished,
    template: normalizeText(layout?.template || publishedlayout?.template || "blank"),
    ...publishedlayout,
    lastpublishedat: layout?.lastpublishedat || null,
  };
};

exports.getAdminShopManagement = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const query = sanitize(req.query || {});
    const page = Math.max(1, toNumber(query.page, 1));
    const limit = Math.max(1, Math.min(50, toNumber(query.limit, 20)));
    const q = normalizeLower(query.q);
    const sort = normalizeLower(query.sort || "newest");
    const filter = normalizeLower(query.filter || "all");

    const shops = await SellerShop.find({})
      .sort({ createdAt: -1 })
      .populate("sellerid", "_id fullname email mobile usersavatar role")
      .lean();

    const sellerIds = shops.map((shop) => shop?.sellerid?._id).filter(Boolean);
    const [metricsMap, requestMap, badges] = await Promise.all([
      buildShopMetrics(shops),
      getLatestSellerRequestMap(sellerIds),
      SellerBadge.find({ isactive: true }).select("_id name slug image priority").lean(),
    ]);
    const badgeMap = new Map(badges.map((badge) => [String(badge._id), badge]));

    let rows = shops.map((shop) => {
      const shopKey = String(shop._id);
      const sellerKey = String(shop?.sellerid?._id || "");
      const metrics = metricsMap.get(shopKey) || {
        productcount: 0,
        totalsold: 0,
        averagerating: 0,
        maxstar: 0,
        reviewcount: 0,
        returnrate: 0,
        istopratedshop: false,
      };
      const request = requestMap.get(sellerKey) || {};
      const storeBadges = (Array.isArray(shop?.badgeids) ? shop.badgeids : [])
        .map((id) => badgeMap.get(String(id)))
        .filter(Boolean);

      return {
        _id: shop._id,
        shopname: shop.shopname || "",
        slug: shop.slug || "",
        createdAt: shop.createdAt || null,
        healthscore: Number(shop.healthscore || 0),
        healthisfrozen: Boolean(shop.healthisfrozen),
        contactemail: shop.contactemail || "",
        contactphone: shop.contactphone || "",
        seller: {
          _id: shop?.sellerid?._id || null,
          fullname: shop?.sellerid?.fullname || "",
          email: shop?.sellerid?.email || "",
          mobile: shop?.sellerid?.mobile || request?.mobile || request?.businessphone || "",
          usersavatar: shop?.sellerid?.usersavatar || "",
        },
        businessmobile: request?.businessphone || request?.mobile || "",
        businessname: request?.businessname || "",
        badges: storeBadges,
        metrics,
        previewurls: {
          desktop: `/shop/${shop.slug}?preview=desktop`,
          tablet: `/shop/${shop.slug}?preview=tablet`,
          mobile: `/shop/${shop.slug}?preview=mobile`,
        },
      };
    });

    if (q) {
      rows = rows.filter((row) => {
        const haystack = [
          row.shopname,
          row.slug,
          row.seller?.fullname,
          row.seller?.email,
          row.seller?.mobile,
          row.businessmobile,
          row.businessname,
          row.contactphone,
        ]
          .map((entry) => normalizeLower(entry))
          .join(" ");
        return haystack.includes(q);
      });
    }

    if (filter === "toprated") rows = rows.filter((row) => row.metrics?.istopratedshop);
    if (filter === "bestselling") rows = rows.filter((row) => Number(row.metrics?.totalsold || 0) > 0);
    if (filter === "lowreturn") rows = rows.filter((row) => Number(row.metrics?.returnrate || 1) <= 0.05);

    if (sort === "bestselling") {
      rows.sort((a, b) => Number(b.metrics?.totalsold || 0) - Number(a.metrics?.totalsold || 0));
    } else if (sort === "lowreturn") {
      rows.sort((a, b) => Number(a.metrics?.returnrate || 1) - Number(b.metrics?.returnrate || 1));
    } else if (sort === "toprated") {
      rows.sort((a, b) => Number(b.metrics?.averagerating || 0) - Number(a.metrics?.averagerating || 0));
    } else {
      rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }

    const count = rows.length;
    const pages = Math.max(1, Math.ceil(count / limit));
    const start = (page - 1) * limit;
    const shopsPaged = rows.slice(start, start + limit);

    return res.status(200).json({
      success: true,
      page,
      pages,
      limit,
      count,
      shops: shopsPaged,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop management." });
  }
};

exports.getAdminShopManagementById = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const shopId = toObjectId(req.params.shopid);
    if (!shopId) return res.status(400).json({ success: false, message: "Invalid shop id." });

    const shop = await SellerShop.findById(shopId)
      .populate("sellerid", "_id fullname email mobile usersavatar role")
      .lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const [metricsMap, badgeRows] = await Promise.all([
      buildShopMetrics([shop]),
      SellerBadge.find({ _id: { $in: Array.isArray(shop.badgeids) ? shop.badgeids : [] } })
        .select("_id name slug image typekey isactive isdraft")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      shop: {
        ...shop,
        metrics: metricsMap.get(String(shop._id)) || {},
        badges: badgeRows,
        decorator: resolvePublishedDecorator(shop),
        previewurls: {
          desktop: `/shop/${shop.slug}?preview=desktop`,
          tablet: `/shop/${shop.slug}?preview=tablet`,
          mobile: `/shop/${shop.slug}?preview=mobile`,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop details." });
  }
};

exports.getAdminBadgeTypes = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    await ensureBadgeTypesSeeded();
    const rows = await SellerBadgeType.find({}).sort({ isdefault: -1, createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: rows.length, types: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load badge types." });
  }
};

exports.createAdminBadgeType = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const payload = sanitize(req.body || {});
    const name = normalizeText(payload.name);
    if (!name) return res.status(400).json({ success: false, message: "Type name is required." });

    const slug = slugify(payload.slug || name);
    if (!slug) return res.status(400).json({ success: false, message: "Invalid type slug." });

    const existing = await SellerBadgeType.findOne({ $or: [{ name }, { slug }] }).lean();
    if (existing) return res.status(409).json({ success: false, message: "Badge type already exists." });

    const type = await SellerBadgeType.create({
      name,
      slug,
      isdefault: false,
      isactive: true,
      createdbyadminid: admin._id,
    });

    return res.status(201).json({ success: true, message: "Badge type created.", type });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to create badge type." });
  }
};

exports.updateAdminBadgeType = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const typeId = toObjectId(req.params.typeid);
    if (!typeId) return res.status(400).json({ success: false, message: "Invalid type id." });

    const payload = sanitize(req.body || {});
    const type = await SellerBadgeType.findById(typeId);
    if (!type) return res.status(404).json({ success: false, message: "Type not found." });

    if (payload.name) type.name = normalizeText(payload.name);
    if (payload.slug) type.slug = slugify(payload.slug);
    if (typeof payload.isactive !== "undefined") type.isactive = toBoolean(payload.isactive, true);
    await type.save();

    return res.status(200).json({ success: true, message: "Badge type updated.", type });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update badge type." });
  }
};

exports.getAdminBadges = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    await ensureBadgeTypesSeeded();

    const query = sanitize(req.query || {});
    const page = Math.max(1, toNumber(query.page, 1));
    const limit = Math.max(1, Math.min(50, toNumber(query.limit, 20)));
    const q = normalizeLower(query.q);
    const status = normalizeLower(query.status || "all");
    const typekey = normalizeLower(query.typekey || "");

    let rows = await SellerBadge.find({})
      .populate("typeid", "_id name slug isdefault")
      .sort({ createdAt: -1 })
      .lean();

    if (q) {
      rows = rows.filter((row) => {
        const hay = [row?.name, row?.slug, row?.description, row?.typekey].map((entry) => normalizeLower(entry)).join(" ");
        return hay.includes(q);
      });
    }

    if (status === "draft") rows = rows.filter((row) => Boolean(row.isdraft));
    if (status === "active") rows = rows.filter((row) => Boolean(row.isactive));
    if (status === "inactive") rows = rows.filter((row) => !row.isactive);
    if (typekey) rows = rows.filter((row) => normalizeLower(row.typekey || row?.typeid?.slug) === typekey);

    const count = rows.length;
    const pages = Math.max(1, Math.ceil(count / limit));
    const start = (page - 1) * limit;
    const badges = rows.slice(start, start + limit);

    return res.status(200).json({ success: true, page, pages, limit, count, badges });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load badges." });
  }
};

exports.createAdminBadge = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    await ensureBadgeTypesSeeded();

    const payload = sanitize(req.body || {});
    const name = normalizeText(payload.name || payload.title);
    if (!name) return res.status(400).json({ success: false, message: "Badge title is required." });

    const slug = slugify(payload.slug || name);
    if (!slug) return res.status(400).json({ success: false, message: "Invalid badge slug." });

    const exists = await SellerBadge.findOne({ $or: [{ name }, { slug }] }).lean();
    if (exists) return res.status(409).json({ success: false, message: "Badge already exists." });

    const typekey = normalizeLower(payload.typekey || "shop");
    const type = await SellerBadgeType.findOne({ slug: typekey }).lean();
    const image = await uploadSingleFromFiles(req.files || []);

    const badge = await SellerBadge.create({
      name,
      slug,
      description: normalizeText(payload.description),
      image,
      priority: Math.max(1, toNumber(payload.priority, 100)),
      typeid: type?._id || null,
      typekey: type?.slug || typekey || "shop",
      isdraft: true,
      isactive: false,
      createdbyadminid: admin._id,
    });

    return res.status(201).json({ success: true, message: "Badge saved in draft.", badge });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to create badge." });
  }
};

exports.updateAdminBadge = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const badgeId = toObjectId(req.params.badgeid);
    if (!badgeId) return res.status(400).json({ success: false, message: "Invalid badge id." });

    const payload = sanitize(req.body || {});
    const badge = await SellerBadge.findById(badgeId);
    if (!badge) return res.status(404).json({ success: false, message: "Badge not found." });

    if (payload.name) {
      badge.name = normalizeText(payload.name);
      badge.slug = slugify(payload.slug || payload.name);
    } else if (payload.slug) {
      badge.slug = slugify(payload.slug);
    }
    if (payload.description !== undefined) badge.description = normalizeText(payload.description);
    if (payload.priority !== undefined) badge.priority = Math.max(1, toNumber(payload.priority, badge.priority || 100));
    if (payload.typekey) {
      const typekey = normalizeLower(payload.typekey);
      const type = await SellerBadgeType.findOne({ slug: typekey }).lean();
      badge.typeid = type?._id || null;
      badge.typekey = type?.slug || typekey;
    }
    if (typeof payload.isactive !== "undefined") {
      badge.isactive = toBoolean(payload.isactive, badge.isactive);
      badge.isdraft = !badge.isactive;
    }
    if (typeof payload.isdraft !== "undefined") {
      badge.isdraft = toBoolean(payload.isdraft, badge.isdraft);
      if (badge.isdraft) badge.isactive = false;
    }

    const uploaded = await uploadSingleFromFiles(req.files || []);
    if (uploaded) badge.image = uploaded;

    await badge.save();
    return res.status(200).json({ success: true, message: "Badge updated.", badge });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update badge." });
  }
};

exports.toggleAdminBadgeStatus = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const badgeId = toObjectId(req.params.badgeid);
    if (!badgeId) return res.status(400).json({ success: false, message: "Invalid badge id." });

    const badge = await SellerBadge.findById(badgeId);
    if (!badge) return res.status(404).json({ success: false, message: "Badge not found." });

    const isactive = toBoolean(req.body?.isactive, !badge.isactive);
    badge.isactive = isactive;
    badge.isdraft = !isactive;
    await badge.save();

    return res.status(200).json({ success: true, message: isactive ? "Badge activated." : "Badge moved to draft.", badge });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update badge status." });
  }
};

const maybeNotifyShopBadgeAward = async ({ shop, badge }) => {
  if (!shop?.sellerid || !badge?.name) return;
  const sellerName = normalizeText(shop?.shopname || "Seller");
  await SellerNotification.create({
    sellerid: shop.sellerid,
    shopid: shop._id,
    type: "Success",
    title: "GlowHaat Badge Awarded",
    message: `Hi ${sellerName}, your shop gets this badge: ${badge.name}.`,
    metadata: {
      source: "badge_management",
      badgeid: String(badge._id),
      badgename: badge.name,
      verified: true,
    },
  });
};

exports.assignAdminBadgeToShop = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const badgeId = toObjectId(req.params.badgeid);
    const shopId = toObjectId(req.body?.shopid);
    if (!badgeId || !shopId) return res.status(400).json({ success: false, message: "Invalid badge or shop id." });

    const [badge, shop] = await Promise.all([SellerBadge.findById(badgeId).lean(), SellerShop.findById(shopId)]);
    if (!badge) return res.status(404).json({ success: false, message: "Badge not found." });
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const hasBadge = Array.isArray(shop.badgeids) && shop.badgeids.some((id) => String(id) === String(badgeId));
    if (!hasBadge) {
      shop.badgeids = [...(Array.isArray(shop.badgeids) ? shop.badgeids : []), badgeId];
      await shop.save();
      await maybeNotifyShopBadgeAward({ shop, badge });
    }

    return res.status(200).json({ success: true, message: hasBadge ? "Badge already assigned." : "Badge assigned to shop." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to assign badge." });
  }
};

exports.setAdminShopBadges = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shopId = toObjectId(req.params.shopid);
    if (!shopId) return res.status(400).json({ success: false, message: "Invalid shop id." });
    const badgeIdsRaw = Array.isArray(req.body?.badgeids) ? req.body.badgeids : [];
    const badgeIds = badgeIdsRaw.map((id) => toObjectId(id)).filter(Boolean);

    const shop = await SellerShop.findById(shopId);
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const previous = new Set((Array.isArray(shop.badgeids) ? shop.badgeids : []).map((id) => String(id)));
    shop.badgeids = badgeIds;
    await shop.save();

    const newBadgeIds = badgeIds.filter((id) => !previous.has(String(id)));
    if (newBadgeIds.length) {
      const badges = await SellerBadge.find({ _id: { $in: newBadgeIds } }).select("_id name").lean();
      for (const badge of badges) {
        await maybeNotifyShopBadgeAward({ shop, badge });
      }
    }

    return res.status(200).json({ success: true, message: "Shop badges updated." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update shop badges." });
  }
};

const findOrCreateSystemThread = async (shop) => {
  const session = `glowhaat-system-shop-${String(shop._id)}`;
  let thread = await SellerChatThread.findOne({
    sellerid: shop.sellerid,
    shopid: shop._id,
    guestsessionid: session,
    productid: null,
    isactive: true,
  });
  if (!thread) {
    thread = await SellerChatThread.create({
      buyerid: null,
      guestsessionid: session,
      guestname: "GlowHaat",
      sellerid: shop.sellerid,
      shopid: shop._id,
      productid: null,
      lastmessage: "",
      unreadforbuyer: 0,
      unreadforseller: 0,
      messages: [],
      isactive: true,
    });
  }
  return thread;
};

exports.sendAdminMessageToShop = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shopId = toObjectId(req.params.shopid);
    if (!shopId) return res.status(400).json({ success: false, message: "Invalid shop id." });

    const text = normalizeText(req.body?.text).slice(0, 2000);
    if (!text) return res.status(400).json({ success: false, message: "Message is required." });

    const shop = await SellerShop.findById(shopId).lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const thread = await findOrCreateSystemThread(shop);
    const encrypted = encryptChatText(text);
    thread.messages.push({
      senderid: null,
      senderkind: "guest",
      senderguestsessionid: "glowhaat-system",
      senderguestname: "GlowHaat",
      senderrole: "Buyer",
      text: encrypted.cipher ? "" : text,
      textenc: encrypted.cipher || "",
      textiv: encrypted.iv || "",
      texttag: encrypted.tag || "",
      media: [],
      readbybuyer: true,
      readbybuyerat: new Date(),
      readbyseller: false,
      readbysellerat: null,
    });

    thread.lastmessage = text;
    thread.lastmessagedat = new Date();
    thread.unreadforseller = Number(thread.unreadforseller || 0) + 1;
    await thread.save();
    const latest = thread.messages[thread.messages.length - 1];

    await SellerNotification.create({
      sellerid: shop.sellerid,
      shopid: shop._id,
      type: "Info",
      title: "GlowHaat Message",
      message: text,
      metadata: {
        source: "glowhaat_chathub",
        verified: true,
        threadid: String(thread._id),
        messageid: String(latest?._id || ""),
      },
    });

    return res.status(201).json({
      success: true,
      message: "GlowHaat message sent to seller.",
      threadid: thread._id,
      chatmessageid: latest?._id || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to send message." });
  }
};

exports.getSellerShopDecorator = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;

    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });
    const layout = shop?.storelayout || {};

    return res.status(200).json({
      success: true,
      shop: {
        _id: shop._id,
        shopname: shop.shopname,
        slug: shop.slug,
      },
      decorator: {
        ispublished: Boolean(layout?.ispublished),
        template: normalizeText(layout?.template || "blank"),
        draftlayout: layout?.draftlayout || getDefaultDecoratorDraft(),
        publishedlayout: layout?.publishedlayout || getDefaultDecoratorDraft(),
        lastpublishedat: layout?.lastpublishedat || null,
      },
      modulecatalog: [
        { key: "single_banner", name: "Single Banner", group: "Banner", max: 100, media: ["image", "gif"], notes: "Desktop 1920x500, Mobile 1080x720 recommended." },
        { key: "carousel_banner", name: "Carousel Banner", group: "Banner", max: 100, media: ["image", "gif"], notes: "Upload 1-100 images and link products." },
        { key: "video_module", name: "Video Module", group: "Media", max: 10, media: ["video"], notes: "Brand story video module." },
        { key: "countdown_products", name: "Countdown Products", group: "Advanced", max: 3, media: ["none"], notes: "Up to 5 products per countdown block." },
        { key: "product_slider", name: "Product Slider", group: "Product", max: 20, media: ["none"], notes: "Highlight products in slider layout." },
        { key: "product_grid_three", name: "Three Column Product Grid", group: "Product", max: 20, media: ["none"], notes: "Desktop 3-column responsive module." },
        { key: "banner_four", name: "4 Banner Module", group: "Banner", max: 100, media: ["image", "gif"], notes: "Upload up to 100 images." },
        { key: "banner_five", name: "5 Banner Module", group: "Banner", max: 100, media: ["image", "gif"], notes: "Upload up to 100 images." },
        { key: "featured_deals", name: "Featured Deals", group: "Amazon Modules", max: 1, media: ["none"], notes: "Amazon-style featured deals tile (one per page)." },
        { key: "best_selling_products", name: "Best Selling Products", group: "Amazon Modules", max: 1, media: ["none"], notes: "Amazon-style best sellers tile (one per page)." },
        { key: "split_selection", name: "Split Selection", group: "Amazon Modules", max: 20, media: ["image", "gif"], notes: "Split image/story section with product mapping." },
        { key: "image_hotspot", name: "Image Hotspot", group: "Amazon Modules", max: 20, media: ["image", "gif"], notes: "Shoppable image with hotspot dots (up to 6 per image)." },
        { key: "text_block", name: "Text Block", group: "Content", max: 100, media: ["none"], notes: "Brand message and story section." },
        { key: "text_tile", name: "Text Tile", group: "Amazon Blank Page", max: 20, media: ["none"], notes: "Amazon blank template text tile." },
        { key: "image_tile", name: "Image Tile", group: "Amazon Blank Page", max: 20, media: ["image", "gif"], notes: "Image tile with optional link." },
        { key: "image_with_text_tile", name: "Image With Text Tile", group: "Amazon Blank Page", max: 20, media: ["image", "gif"], notes: "Image and text composition tile." },
        { key: "shoppable_image_tile", name: "Shoppable Image Tile", group: "Amazon Blank Page", max: 20, media: ["image", "gif"], notes: "Shoppable image with interactive product points." },
        { key: "video_tile", name: "Video Tile", group: "Amazon Blank Page", max: 20, media: ["video"], notes: "Video player tile with cover image support." },
        { key: "background_video_tile", name: "Background Video Tile", group: "Amazon Blank Page", max: 4, media: ["video"], notes: "Autoplay muted background video tile (max 4)." },
        { key: "gallery_tile", name: "Gallery Tile", group: "Amazon Blank Page", max: 1, media: ["image", "gif"], notes: "Full-width gallery tile (one per page)." },
        { key: "product_tile", name: "Product Tile", group: "Amazon Blank Page", max: 20, media: ["none"], notes: "Single product highlight tile." },
        { key: "product_grid_tile", name: "Product Grid Tile", group: "Amazon Blank Page", max: 1, media: ["none"], notes: "Product grid tile (one per page)." },
        { key: "recommended_products_tile", name: "Recommended Products Tile", group: "Amazon Blank Page", max: 1, media: ["none"], notes: "Recommended products tile (one per page)." },
      ],
      previewurls: {
        desktop: `/shop/${shop.slug}?preview=desktop`,
        tablet: `/shop/${shop.slug}?preview=tablet`,
        mobile: `/shop/${shop.slug}?preview=mobile`,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop decorator." });
  }
};

exports.saveSellerShopDecoratorDraft = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id });
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const payload = sanitize(req.body || {});
    const draftlayout = normalizeDecoratorPayload(payload.layout || payload.draftlayout || payload);
    const template = normalizeText(payload.template || draftlayout.template || "blank").toLowerCase();
    const storelayout = shop.storelayout || {};

    shop.storelayout = {
      ...storelayout,
      template,
      draftlayout,
      updatedby: seller._id,
      updatedat: new Date(),
    };
    await shop.save();

    return res.status(200).json({ success: true, message: "Decorator draft saved.", decorator: shop.storelayout });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to save decorator draft." });
  }
};

exports.publishSellerShopDecorator = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id });
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const storelayout = shop.storelayout || {};
    const draftlayout = storelayout?.draftlayout || getDefaultDecoratorDraft();
    shop.storelayout = {
      ...storelayout,
      ispublished: true,
      publishedlayout: draftlayout,
      template: normalizeText(storelayout?.template || draftlayout?.template || "blank"),
      lastpublishedat: new Date(),
      updatedby: seller._id,
      updatedat: new Date(),
    };
    await shop.save();

    return res.status(200).json({ success: true, message: "Decorator published.", decorator: shop.storelayout });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to publish decorator." });
  }
};

exports.unpublishSellerShopDecorator = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id });
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });
    const storelayout = shop.storelayout || {};
    shop.storelayout = {
      ...storelayout,
      ispublished: false,
      updatedby: seller._id,
      updatedat: new Date(),
    };
    await shop.save();
    return res.status(200).json({ success: true, message: "Decorator unpublished. Default storefront is now active." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to unpublish decorator." });
  }
};

exports.getAdminShopDecoratorByShopId = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shopId = toObjectId(req.params.shopid);
    if (!shopId) return res.status(400).json({ success: false, message: "Invalid shop id." });
    const shop = await SellerShop.findById(shopId).lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    return res.status(200).json({
      success: true,
      decorator: shop?.storelayout || {},
      previewurls: {
        desktop: `/shop/${shop.slug}?preview=desktop`,
        tablet: `/shop/${shop.slug}?preview=tablet`,
        mobile: `/shop/${shop.slug}?preview=mobile`,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop decorator." });
  }
};

const resolveAssetOwner = async (req, res, mode) => {
  if (mode === "seller") return ensureRole(req, res, "Seller");
  if (mode === "superadmin") return ensureRole(req, res, "SuperAdmin");
  res.status(400).json({ success: false, message: "Invalid owner mode." });
  return null;
};

const mapAssetRow = (asset) => ({
  _id: asset._id,
  ownerkind: asset.ownerkind,
  ownerid: asset.ownerid,
  title: asset.title,
  originalname: asset.originalname,
  url: asset.url,
  mimetype: asset.mimetype,
  extension: asset.extension,
  filesize: Number(asset.filesize || 0),
  filekind: asset.filekind,
  notes: asset.notes,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
});

const listCreativeAssetsByMode = async (req, res, mode) => {
  const owner = await resolveAssetOwner(req, res, mode);
  if (!owner) return;

  const query = sanitize(req.query || {});
  const q = normalizeLower(query.q);
  const filekind = normalizeLower(query.filekind || "");
  const page = Math.max(1, toNumber(query.page, 1));
  const limit = Math.max(1, Math.min(100, toNumber(query.limit, 24)));

  let rows = await CreativeAsset.find({
    ownerkind: mode,
    ownerid: owner._id,
    isactive: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (q) {
    rows = rows.filter((row) =>
      [row.title, row.originalname, row.notes, row.filekind].map((entry) => normalizeLower(entry)).join(" ").includes(q)
    );
  }
  if (filekind) rows = rows.filter((row) => normalizeLower(row.filekind) === filekind);

  const count = rows.length;
  const pages = Math.max(1, Math.ceil(count / limit));
  const start = (page - 1) * limit;
  const assets = rows.slice(start, start + limit).map(mapAssetRow);
  return res.status(200).json({ success: true, page, pages, count, limit, assets });
};

const uploadCreativeAssetsByMode = async (req, res, mode) => {
  const owner = await resolveAssetOwner(req, res, mode);
  if (!owner) return;
  const payload = sanitize(req.body || {});
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ success: false, message: "Please upload at least one file." });

  const created = [];
  for (const file of files) {
    let url = "";
    try {
      url = await uploadoncloudinary(file.path);
    } catch (_error) {
      url = `/public/${path.basename(file.path)}`;
    }
    if (!url) continue;
    const filekind = detectAssetKind(file.mimetype, file.originalname);
    const title = normalizeText(payload.title) || normalizeText(file.originalname);
    const asset = await CreativeAsset.create({
      ownerkind: mode,
      ownerid: owner._id,
      title: title.slice(0, 220),
      originalname: normalizeText(file.originalname),
      url,
      mimetype: normalizeText(file.mimetype),
      extension: normalizeText(path.extname(file.originalname || "")).replace(/^\./, "").toLowerCase(),
      filesize: Math.max(0, Number(file.size || 0)),
      filekind,
      notes: normalizeText(payload.notes).slice(0, 1200),
      isactive: true,
    });
    created.push(mapAssetRow(asset));
  }

  return res.status(201).json({ success: true, message: "Creative assets uploaded.", count: created.length, assets: created });
};

const updateCreativeAssetByMode = async (req, res, mode) => {
  const owner = await resolveAssetOwner(req, res, mode);
  if (!owner) return;
  const assetId = toObjectId(req.params.assetid);
  if (!assetId) return res.status(400).json({ success: false, message: "Invalid asset id." });
  const payload = sanitize(req.body || {});

  const asset = await CreativeAsset.findOne({
    _id: assetId,
    ownerkind: mode,
    ownerid: owner._id,
    isactive: true,
  });
  if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });

  if (payload.title !== undefined) asset.title = normalizeText(payload.title).slice(0, 220);
  if (payload.notes !== undefined) asset.notes = normalizeText(payload.notes).slice(0, 1200);

  const file = Array.isArray(req.files) && req.files.length ? req.files[0] : null;
  if (file?.path) {
    let url = "";
    try {
      url = await uploadoncloudinary(file.path);
    } catch (_error) {
      url = `/public/${path.basename(file.path)}`;
    }
    if (url) {
      asset.url = url;
      asset.originalname = normalizeText(file.originalname);
      asset.mimetype = normalizeText(file.mimetype);
      asset.extension = normalizeText(path.extname(file.originalname || "")).replace(/^\./, "").toLowerCase();
      asset.filesize = Math.max(0, Number(file.size || 0));
      asset.filekind = detectAssetKind(file.mimetype, file.originalname);
    }
  }

  await asset.save();
  return res.status(200).json({ success: true, message: "Asset updated.", asset: mapAssetRow(asset) });
};

const deleteCreativeAssetByMode = async (req, res, mode) => {
  const owner = await resolveAssetOwner(req, res, mode);
  if (!owner) return;
  const assetId = toObjectId(req.params.assetid);
  if (!assetId) return res.status(400).json({ success: false, message: "Invalid asset id." });
  const asset = await CreativeAsset.findOneAndDelete({
    _id: assetId,
    ownerkind: mode,
    ownerid: owner._id,
  });
  if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
  return res.status(200).json({ success: true, message: "Asset deleted." });
};

const downloadCreativeAssetByMode = async (req, res, mode) => {
  const owner = await resolveAssetOwner(req, res, mode);
  if (!owner) return;
  const assetId = toObjectId(req.params.assetid);
  if (!assetId) return res.status(400).json({ success: false, message: "Invalid asset id." });
  const asset = await CreativeAsset.findOne({
    _id: assetId,
    ownerkind: mode,
    ownerid: owner._id,
    isactive: true,
  }).lean();
  if (!asset) return res.status(404).json({ success: false, message: "Asset not found." });
  return res.redirect(asset.url);
};

exports.getSellerCreativeAssets = async (req, res) => listCreativeAssetsByMode(req, res, "seller");
exports.uploadSellerCreativeAssets = async (req, res) => uploadCreativeAssetsByMode(req, res, "seller");
exports.updateSellerCreativeAsset = async (req, res) => updateCreativeAssetByMode(req, res, "seller");
exports.deleteSellerCreativeAsset = async (req, res) => deleteCreativeAssetByMode(req, res, "seller");
exports.downloadSellerCreativeAsset = async (req, res) => downloadCreativeAssetByMode(req, res, "seller");

exports.getAdminCreativeAssets = async (req, res) => listCreativeAssetsByMode(req, res, "superadmin");
exports.uploadAdminCreativeAssets = async (req, res) => uploadCreativeAssetsByMode(req, res, "superadmin");
exports.updateAdminCreativeAsset = async (req, res) => updateCreativeAssetByMode(req, res, "superadmin");
exports.deleteAdminCreativeAsset = async (req, res) => deleteCreativeAssetByMode(req, res, "superadmin");
exports.downloadAdminCreativeAsset = async (req, res) => downloadCreativeAssetByMode(req, res, "superadmin");
