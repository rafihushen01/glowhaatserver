
const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const path = require("path");
const uploadoncloudinary = require("../utils/Cloudinary");
const User = require("../models/User");
const Item = require("../models/Item");
const Nav = require("../models/Nav");
const SellerShop = require("../models/SellerShop");
const SellerOrder = require("../models/SellerOrder");
const SellerSponsorship = require("../models/SellerSponsorship");
const SellerCommissionConfig = require("../models/SellerCommissionConfig");
const SellerCommissionPayment = require("../models/SellerCommissionPayment");
const SellerNotification = require("../models/SellerNotification");
const SellerSubscription = require("../models/SellerSubscription");
const { sendSellerSponsorshipStatusMail, sendSellerCommissionReminderMail, sendSellerCommissionStatusMail } = require("../utils/Mail");

const KHAN_BKASH_NUMBER = "01862623066";
const ORDER_STATUSES = ["placed", "processing", "shipped", "delivered", "returned", "canceled"];
const SUBSCRIPTION_PLANS = {
  1000: { name: "Bronze", save: 300 },
  5000: { name: "Silver", save: 1000 },
  10000: { name: "Golden", save: 2500 },
  15000: { name: "White Diamond", save: 4000 },
  20000: { name: "Red Diamond", save: 6500 },
};

const normalizeText = (v = "") => String(v).trim();
const normalizeEmail = (v = "") => String(v).trim().toLowerCase();
const toNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const slugify = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const uploadSingle = async (fileArray = []) => {
  const file = Array.isArray(fileArray) ? fileArray[0] : null;
  if (!file?.path) return "";
  try {
    return await uploadoncloudinary(file.path);
  } catch (_error) {
    return `/public/${path.basename(file.path)}`;
  }
};

const ensureRole = async (req, res, role) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("_id fullname email role").lean();
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

const getOrCreateConfig = async () => {
  let config = await SellerCommissionConfig.findOne({}).sort({ createdAt: 1 });
  if (!config) config = await SellerCommissionConfig.create({ globalpercentage: 5, selleroverrides: [] });
  return config;
};

const getSellerPercent = async (sellerid) => {
  const config = await getOrCreateConfig();
  const override = (config.selleroverrides || []).find((x) => String(x.sellerid) === String(sellerid));
  return {
    percent: Number(override?.percentage ?? config.globalpercentage ?? 5),
    global: Number(config.globalpercentage ?? 5),
    source: override ? "override" : "global",
  };
};

const computeHealthLevel = (score) => {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s >= 70) return "Best";
  if (s >= 50) return "Good";
  if (s >= 40) return "Decent";
  if (s >= 30) return "Watch";
  if (s >= 20) return "Warning";
  return "Bad";
};

const cycleFrom = (date) => {
  const start = new Date(date || Date.now());
  const now = new Date();
  while (start <= now) {
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    if (now < end) {
      return {
        start: new Date(start),
        end,
        due: new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000),
      };
    }
    start.setMonth(start.getMonth() + 1);
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end, due: new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000) };
};

const buildCategoryTree = async (categoryids = []) => {
  if (!Array.isArray(categoryids) || !categoryids.length) return [];
  const categories = await Nav.find({ _id: { $in: categoryids }, isactive: true, isdeleted: false }).sort({ depth: 1 }).lean();
  if (!categories.length) return [];
  let tree = null;
  for (let i = categories.length - 1; i >= 0; i -= 1) {
    const cat = categories[i];
    tree = { name: cat.name, link: cat.link || cat.path, children: tree ? [tree] : [] };
  }
  return [tree];
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const ensureCommissionRecord = async (seller, shop) => {
  const cycle = cycleFrom(shop.createdAt);
  const { percent } = await getSellerPercent(seller._id);

  const delivered = await SellerOrder.aggregate([
    {
      $match: {
        sellerid: new mongoose.Types.ObjectId(String(seller._id)),
        shopid: new mongoose.Types.ObjectId(String(shop._id)),
        status: "delivered",
        deliveredat: { $gte: cycle.start, $lt: cycle.end },
      },
    },
    { $group: { _id: null, total: { $sum: "$item.totalprice" } } },
  ]);
  const total = Number(delivered?.[0]?.total || 0);

  const sub = await SellerSubscription.findOne({ sellerid: seller._id, shopid: shop._id, status: "Verified", remainingcredit: { $gt: 0 } }).sort({ createdAt: 1 }).lean();
  const rawCommission = Number(((total * percent) / 100).toFixed(2));
  const adjusted = Math.max(0, Number((rawCommission - Number(sub?.remainingcredit || 0)).toFixed(2)));

  let payment = await SellerCommissionPayment.findOne({ sellerid: seller._id, shopid: shop._id, periodstart: cycle.start, periodend: cycle.end });
  if (!payment) {
    payment = await SellerCommissionPayment.create({ sellerid: seller._id, shopid: shop._id, periodstart: cycle.start, periodend: cycle.end, dueat: cycle.due, totaldeliveredamount: total, percentage: percent, commissionamount: adjusted, status: "Pending" });
  } else {
    payment.totaldeliveredamount = total;
    payment.percentage = percent;
    payment.commissionamount = adjusted;
    if (["Pending", "Overdue", "Rejected"].includes(payment.status) && new Date() > payment.dueat) payment.status = "Overdue";
    await payment.save();
  }

  const now = new Date();
  if (["Pending", "Overdue", "Rejected"].includes(payment.status) && now > payment.periodend && payment.reminderssent === 0) {
    await Promise.allSettled([
      sendSellerCommissionReminderMail(seller.email, { amount: payment.commissionamount, dueat: payment.dueat, bikash: KHAN_BKASH_NUMBER }),
      SellerNotification.create({ sellerid: seller._id, shopid: shop._id, type: "Warning", title: "Commission due", message: `Your commission due is ?${payment.commissionamount.toFixed(2)}. Pay within 4 days.` }),
    ]);
    payment.reminderssent = 1;
    await payment.save();
  }

  if (now > payment.dueat && ["Pending", "Overdue", "Rejected"].includes(payment.status)) {
    await SellerShop.updateOne({ _id: shop._id }, { $set: { healthisfrozen: true, freezereason: "Commission overdue", blockedat: now } });
    await Item.updateMany({ shopid: shop._id }, { $set: { isactive: false } });
    payment.status = "Overdue";
    await payment.save();
  }

  return payment;
};
exports.getSellerPanelBootstrap = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    let commission = null;
    if (shop) commission = await ensureCommissionRecord(seller, shop);

    const [itemcount, ordercount, pendingSponsorships, unreadNotifications] = await Promise.all([
      Item.countDocuments({ sellerid: seller._id }),
      SellerOrder.countDocuments({ sellerid: seller._id }),
      SellerSponsorship.countDocuments({ sellerid: seller._id, status: "Pending" }),
      SellerNotification.countDocuments({ sellerid: seller._id, isread: false }),
    ]);

    return res.status(200).json({
      success: true,
      seller,
      shop,
      bkashnumber: KHAN_BKASH_NUMBER,
      stats: { itemcount, ordercount, pendingSponsorships, unreadNotifications },
      commission,
      health: { score: Number(shop?.healthscore || 0), level: computeHealthLevel(shop?.healthscore || 0), frozen: Boolean(shop?.healthisfrozen) },
    });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to load seller panel." });
  }
};

exports.getSellerShop = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    return res.status(200).json({ success: true, shop: shop || null });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to load shop." });
  }
};

exports.createSellerShop = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const exists = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (exists) return res.status(409).json({ success: false, message: "Shop already exists." });

    const payload = sanitize(req.body || {});
    const shopname = normalizeText(payload.shopname);
    if (!shopname) return res.status(400).json({ success: false, message: "Shop name is required." });

    const base = slugify(shopname) || `seller-shop-${Date.now()}`;
    let slug = base;
    let i = 1;
    while (await SellerShop.findOne({ slug }).lean()) {
      slug = `${base}-${i}`;
      i += 1;
    }

    const profileimage = await uploadSingle(req.files?.profileimage);
    const bannerimage = await uploadSingle(req.files?.bannerimage);

    const shop = await SellerShop.create({
      sellerid: seller._id,
      shopname,
      slug,
      profileimage,
      bannerimage,
      description: normalizeText(payload.description),
      contactemail: normalizeEmail(payload.contactemail || seller.email),
      contactphone: normalizeText(payload.contactphone),
      address: normalizeText(payload.address),
      healthscore: 100,
    });

    await SellerNotification.create({ sellerid: seller._id, shopid: shop._id, type: "Success", title: "Shop created", message: "Your shop is created. You can now add items." });
    return res.status(201).json({ success: true, message: "Shop created.", shop });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to create shop." });
  }
};

exports.getSellerItems = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const items = await Item.find({ sellerid: seller._id }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: items.length, items });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch items." });
  }
};

exports.createSellerItem = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(400).json({ success: false, message: "Please create your shop first." });
    if (shop.healthisfrozen) return res.status(423).json({ success: false, message: "Shop is frozen." });

    const body = sanitize(req.body || {});
    const categoryids = parseJsonArray(body.categoryids);
    const categorytree = parseJsonArray(body.categorytree);
    const variants = parseJsonArray(body.variants);

    const name = normalizeText(body.name);
    if (!name) return res.status(400).json({ success: false, message: "Item name is required." });
    if (!categoryids.length) return res.status(400).json({ success: false, message: "Category is required." });

    const whiteimage = await uploadSingle(req.files?.whiteimage);
    const hoverimage = await uploadSingle(req.files?.hoverimage);

    const gallery = [];
    const galleryFiles = Array.isArray(req.files?.gallery) ? req.files.gallery : [];
    for (const f of galleryFiles) {
      const url = await uploadSingle([f]);
      if (url) gallery.push(url);
    }

    for (let v = 0; v < variants.length; v += 1) {
      const variant = variants[v];
      const count = Array.isArray(variant.images) ? variant.images.length : 0;
      const uploaded = [];
      for (let s = 0; s < count; s += 1) {
        const key = `variantmedia_${v}_${s}`;
        const f = Array.isArray(req.files?.[key]) ? req.files[key][0] : null;
        if (!f) continue;
        const url = await uploadSingle([f]);
        if (url) uploaded.push(url);
      }
      variant.images = uploaded;
    }

    const item = await Item.create({
      name,
      description: normalizeText(body.description),
      highlight: normalizeText(body.highlight),
      aboutitems: normalizeText(body.aboutitems),
      brand: normalizeText(body.brand),
      type: normalizeText(body.type) || "fashion",
      flashsale: String(body.flashsale || "false") === "true",
      eidsale: String(body.eidsale || "false") === "true",
      coustomsale: String(body.coustomsale || "false") === "true",
      isreturnable: String(body.isreturnable || "false") === "true",
      warrantynotavalible: String(body.warrantynotavalible || "false") === "true",
      isperishable: String(body.isperishable || "false") === "true",
      warranty: normalizeText(body.warranty),
      warrantyperiod: normalizeText(body.warrantyperiod),
      expirydate: body.expirydate || null,
      whiteimage,
      hoverimage: hoverimage || whiteimage,
      gallery,
      variants,
      categoryids,
      categorytree,
      categorypath: normalizeText(body.categorypath) || categorytree.join(" > "),
      category: await buildCategoryTree(categoryids),
      slug: `${slugify(name)}-${Date.now().toString().slice(-6)}`,
      sellerid: seller._id,
      shopid: shop._id,
      isselleritem: true,
      deliveryschema: {
        name: normalizeText(body.deliveryname) || "Standard Delivery",
        deliverytime: normalizeText(body.deliverytime) || "3-5 Days",
        deliverycharge: Math.max(0, toNumber(body.deliverycharge, 60)),
        isfreeshipping: String(body.isfreeshipping || "false") === "true",
      },
      isactive: true,
    });

    return res.status(201).json({ success: true, message: "Item created.", item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to create item." });
  }
};

exports.updateSellerItem = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return res.status(400).json({ success: false, message: "Invalid item id." });

    const item = await Item.findOne({ _id: id, sellerid: seller._id });
    if (!item) return res.status(404).json({ success: false, message: "Item not found." });

    Object.keys(req.body || {}).forEach((key) => {
      if (["name", "description", "highlight", "aboutitems", "brand", "warranty", "warrantyperiod", "categorypath"].includes(key)) item[key] = req.body[key];
      if (["flashsale", "eidsale", "coustomsale", "isreturnable", "warrantynotavalible", "isperishable", "isactive"].includes(key)) item[key] = String(req.body[key]) === "true" || req.body[key] === true;
    });

    if (req.body?.deliveryschema) {
      try {
        const ds = typeof req.body.deliveryschema === "string" ? JSON.parse(req.body.deliveryschema) : req.body.deliveryschema;
        item.deliveryschema = { ...item.deliveryschema, ...ds, deliverycharge: Math.max(0, toNumber(ds?.deliverycharge, item.deliveryschema?.deliverycharge || 0)) };
      } catch {}
    }

    if (req.body?.variants) {
      try {
        const variants = typeof req.body.variants === "string" ? JSON.parse(req.body.variants) : req.body.variants;
        if (Array.isArray(variants)) item.variants = variants;
      } catch {}
    }

    const profile = await uploadSingle(req.files?.whiteimage);
    const hover = await uploadSingle(req.files?.hoverimage);
    if (profile) item.whiteimage = profile;
    if (hover) item.hoverimage = hover;

    await item.save();
    return res.status(200).json({ success: true, message: "Item updated.", item });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update item." });
  }
};

exports.deleteSellerItem = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const { id } = req.params;
    const deleted = await Item.findOneAndDelete({ _id: id, sellerid: seller._id });
    if (!deleted) return res.status(404).json({ success: false, message: "Item not found." });
    await SellerSponsorship.deleteMany({ itemid: deleted._id });
    return res.status(200).json({ success: true, message: "Item deleted." });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to delete item." });
  }
};

exports.getSellerOrders = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const status = normalizeText(req.query?.status).toLowerCase();
    const filter = { sellerid: seller._id };
    if (ORDER_STATUSES.includes(status)) filter.status = status;
    const orders = await SellerOrder.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: orders.length, orders });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch orders." });
  }
};

exports.updateSellerOrderStatus = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const { id } = req.params;
    const status = normalizeText(req.body?.status).toLowerCase();
    const note = normalizeText(req.body?.note);
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid status." });

    const order = await SellerOrder.findOne({ _id: id, sellerid: seller._id });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (shop?.healthisfrozen) return res.status(423).json({ success: false, message: "Shop is frozen." });

    order.status = status;
    order.statushistory.push({ status, note: note || `Status changed to ${status}`, changedby: seller._id, changedat: new Date() });
    if (status === "delivered") order.deliveredat = new Date();
    await order.save();
    return res.status(200).json({ success: true, message: "Order updated.", order });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update order." });
  }
};
exports.requestItemSponsorship = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(400).json({ success: false, message: "Create shop first." });

    const payload = sanitize(req.body || {});
    const itemid = normalizeText(payload.itemid);
    const amount = Math.max(100, Math.min(2000, toNumber(payload.amount, 100)));
    const senderbkashnumber = normalizeText(payload.senderbkashnumber);
    const transactionid = normalizeText(payload.transactionid);
    if (!mongoose.Types.ObjectId.isValid(itemid)) return res.status(400).json({ success: false, message: "Invalid item id." });
    if (!senderbkashnumber || !transactionid) return res.status(400).json({ success: false, message: "Sender number and transaction id are required." });

    const item = await Item.findOne({ _id: itemid, sellerid: seller._id }).lean();
    if (!item) return res.status(404).json({ success: false, message: "Item not found." });

    const sponsoreddays = amount > 1000 ? 120 : Math.floor(amount / 100) * 7;
    const paymentss = await uploadSingle(req.files?.paymentss);

    const request = await SellerSponsorship.create({ sellerid: seller._id, shopid: shop._id, itemid, amount, sponsoreddays, senderbkashnumber, transactionid, paymentss, status: "Pending" });

    await SellerNotification.create({ sellerid: seller._id, shopid: shop._id, type: "Info", title: "Sponsorship pending", message: `Sponsorship request for ${item.name} is pending.` });
    return res.status(201).json({ success: true, message: "Sponsorship request submitted.", request });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to request sponsorship." });
  }
};

exports.getSellerSponsorships = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const sponsorships = await SellerSponsorship.find({ sellerid: seller._id }).sort({ createdAt: -1 }).populate("itemid", "_id name slug whiteimage").lean();
    return res.status(200).json({ success: true, count: sponsorships.length, sponsorships });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch sponsorships." });
  }
};

exports.getSellerCommission = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(200).json({ success: true, hasshop: false, message: "Create shop first." });

    const payment = await ensureCommissionRecord(seller, shop);
    const { percent, global, source } = await getSellerPercent(seller._id);
    const history = await SellerCommissionPayment.find({ sellerid: seller._id, shopid: shop._id }).sort({ periodstart: -1 }).limit(12).lean();
    const subscription = await SellerSubscription.findOne({ sellerid: seller._id, shopid: shop._id, status: "Verified", remainingcredit: { $gt: 0 } }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, hasshop: true, payment, history, commission: { percent, global, source }, subscription, bkashnumber: KHAN_BKASH_NUMBER, freeze: { isfrozen: Boolean(shop.healthisfrozen), reason: shop.freezereason || "" } });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch commission." });
  }
};

exports.submitSellerCommissionPayment = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(400).json({ success: false, message: "Create shop first." });

    const payment = await ensureCommissionRecord(seller, shop);
    const senderbkashnumber = normalizeText(req.body?.senderbkashnumber);
    const transactionid = normalizeText(req.body?.transactionid);
    if (!senderbkashnumber || !transactionid) return res.status(400).json({ success: false, message: "Sender number and transaction id are required." });

    payment.senderbkashnumber = senderbkashnumber;
    payment.transactionid = transactionid;
    payment.paymentss = await uploadSingle(req.files?.paymentss);
    payment.status = "Submitted";
    payment.rejectreason = "";
    await payment.save();

    await SellerNotification.create({ sellerid: seller._id, shopid: shop._id, type: "Info", title: "Payment submitted", message: "Commission payment sent for verification." });
    return res.status(200).json({ success: true, message: "Commission payment submitted.", payment });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to submit payment." });
  }
};

exports.getSellerNotifications = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const notifications = await SellerNotification.find({ sellerid: seller._id }).sort({ createdAt: -1 }).limit(100).lean();
    return res.status(200).json({ success: true, count: notifications.length, notifications });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to load notifications." });
  }
};

exports.markSellerNotificationRead = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const id = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification id." });
    }

    const updated = await SellerNotification.findOneAndUpdate(
      { _id: id, sellerid: seller._id },
      { $set: { isread: true } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ success: false, message: "Notification not found." });
    return res.status(200).json({ success: true, message: "Notification marked as read.", notification: updated });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update notification." });
  }
};

exports.markAllSellerNotificationsRead = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    await SellerNotification.updateMany(
      { sellerid: seller._id, isread: false },
      { $set: { isread: true } }
    );
    return res.status(200).json({ success: true, message: "All notifications marked as read." });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update notifications." });
  }
};

exports.requestSellerSubscription = async (req, res) => {
  try {
    const seller = await ensureRole(req, res, "Seller");
    if (!seller) return;
    const shop = await SellerShop.findOne({ sellerid: seller._id }).lean();
    if (!shop) return res.status(400).json({ success: false, message: "Create shop first." });

    const amount = Math.max(1000, Math.min(20000, toNumber(req.body?.amount, 1000)));
    const senderbkashnumber = normalizeText(req.body?.senderbkashnumber);
    const transactionid = normalizeText(req.body?.transactionid);
    if (!SUBSCRIPTION_PLANS[amount]) return res.status(400).json({ success: false, message: "Invalid amount." });
    if (!senderbkashnumber || !transactionid) return res.status(400).json({ success: false, message: "Sender number and transaction id are required." });

    const plan = SUBSCRIPTION_PLANS[amount];
    const paymentss = await uploadSingle(req.files?.paymentss);
    const sub = await SellerSubscription.create({ sellerid: seller._id, shopid: shop._id, planname: plan.name, amount, savingscredit: plan.save, remainingcredit: plan.save, senderbkashnumber, transactionid, paymentss, status: "Pending" });

    await SellerNotification.create({ sellerid: seller._id, shopid: shop._id, type: "Info", title: "Subscription pending", message: `${plan.name} subscription request is pending verification.` });
    return res.status(201).json({ success: true, message: "Subscription request submitted.", subscription: sub });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to request subscription." });
  }
};

exports.getAdminSponsorshipRequests = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const status = normalizeText(req.query?.status);
    const filter = {};
    if (["Pending", "Verified", "Rejected"].includes(status)) filter.status = status;
    const requests = await SellerSponsorship.find(filter).sort({ createdAt: -1 }).populate("sellerid", "_id fullname email").populate("shopid", "_id shopname").populate("itemid", "_id name slug whiteimage").lean();
    return res.status(200).json({ success: true, count: requests.length, requests });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch sponsorship requests." });
  }
};

exports.decideSponsorshipRequest = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const decision = normalizeText(req.body?.decision);
    const rejectreason = normalizeText(req.body?.rejectreason);
    if (!["Verified", "Rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Invalid decision." });

    const request = await SellerSponsorship.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    const item = await Item.findById(request.itemid);
    const seller = await User.findById(request.sellerid).select("email").lean();

    request.status = decision;
    request.rejectreason = decision === "Rejected" ? rejectreason : "";
    request.reviewedby = admin._id;
    request.reviewedat = new Date();

    if (decision === "Verified" && item) {
      const startsat = new Date();
      const endsat = new Date(startsat.getTime() + request.sponsoreddays * 24 * 60 * 60 * 1000);
      request.startsat = startsat;
      request.endsat = endsat;
      item.sponsorship = { isactive: true, amount: request.amount, startsat, endsat, boostedscore: request.amount };
      await item.save();
    }

    if (decision === "Rejected" && item) {
      item.sponsorship = { isactive: false, amount: 0, startsat: null, endsat: null, boostedscore: 0 };
      await item.save();
      await SellerShop.updateOne({ _id: request.shopid }, { $inc: { healthscore: -10 } });
    }

    await request.save();
    await SellerNotification.create({ sellerid: request.sellerid, shopid: request.shopid, type: decision === "Verified" ? "Success" : "Warning", title: `Sponsorship ${decision.toLowerCase()}`, message: decision === "Verified" ? `Sponsorship active for ${request.sponsoreddays} days.` : `Sponsorship rejected. ${rejectreason || "Invalid payment proof."}` });
    if (seller?.email) await sendSellerSponsorshipStatusMail(seller.email, { status: decision, days: request.sponsoreddays, rejectreason });

    return res.status(200).json({ success: true, message: `Sponsorship ${decision.toLowerCase()}.` });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update sponsorship request." });
  }
};

exports.getAdminCommissionConfig = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const config = await getOrCreateConfig();
    return res.status(200).json({ success: true, config });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch commission config." });
  }
};

exports.setGlobalCommissionPercent = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const config = await getOrCreateConfig();
    config.globalpercentage = Math.max(0, Math.min(100, toNumber(req.body?.percentage, 5)));
    await config.save();
    return res.status(200).json({ success: true, message: "Global commission updated.", config });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update global commission." });
  }
};

exports.setSellerCommissionPercent = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const sellerid = normalizeText(req.params.sellerid);
    if (!mongoose.Types.ObjectId.isValid(sellerid)) return res.status(400).json({ success: false, message: "Invalid seller id." });

    const config = await getOrCreateConfig();
    const percentage = Math.max(0, Math.min(100, toNumber(req.body?.percentage, 5)));
    const note = normalizeText(req.body?.note);

    const index = (config.selleroverrides || []).findIndex((x) => String(x.sellerid) === String(sellerid));
    if (index >= 0) {
      config.selleroverrides[index].percentage = percentage;
      config.selleroverrides[index].note = note;
      config.selleroverrides[index].updatedat = new Date();
    } else {
      config.selleroverrides.push({ sellerid, percentage, note, updatedat: new Date() });
    }

    await config.save();
    return res.status(200).json({ success: true, message: "Seller commission override updated.", config });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update seller override." });
  }
};

exports.getAdminCommissionPayments = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const status = normalizeText(req.query?.status);
    const filter = {};
    if (["Pending", "Submitted", "Verified", "Rejected", "Overdue"].includes(status)) filter.status = status;

    const payments = await SellerCommissionPayment.find(filter).sort({ createdAt: -1 }).populate("sellerid", "_id fullname email").populate("shopid", "_id shopname").lean();
    return res.status(200).json({ success: true, count: payments.length, payments });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch payments." });
  }
};

exports.decideCommissionPayment = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;

    const payment = await SellerCommissionPayment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found." });

    const decision = normalizeText(req.body?.decision);
    const rejectreason = normalizeText(req.body?.rejectreason);
    if (!["Verified", "Rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Invalid decision." });

    const shop = await SellerShop.findById(payment.shopid);
    const seller = await User.findById(payment.sellerid).select("email").lean();

    payment.status = decision;
    payment.rejectreason = decision === "Rejected" ? rejectreason : "";
    payment.reviewedby = admin._id;
    payment.reviewedat = new Date();
    await payment.save();

    if (shop) {
      if (decision === "Verified") {
        shop.healthisfrozen = false;
        shop.freezereason = "";
        shop.blockedat = null;
        await shop.save();
        await Item.updateMany({ shopid: shop._id }, { $set: { isactive: true } });
      } else {
        shop.healthscore = Math.max(0, Number(shop.healthscore || 0) - 10);
        await shop.save();
      }
    }

    await SellerNotification.create({ sellerid: payment.sellerid, shopid: payment.shopid, type: decision === "Verified" ? "Success" : "Danger", title: `Commission payment ${decision.toLowerCase()}`, message: decision === "Verified" ? "Payment verified. Dashboard unlocked." : `Payment rejected. ${rejectreason || "Invalid payment proof."}` });
    if (seller?.email) await sendSellerCommissionStatusMail(seller.email, { status: decision, rejectreason });

    return res.status(200).json({ success: true, message: `Payment ${decision.toLowerCase()}.` });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update payment." });
  }
};

exports.updateShopHealth = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shop = await SellerShop.findById(req.params.shopid);
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const mode = normalizeText(req.body?.mode).toLowerCase();
    const value = toNumber(req.body?.value, 0);
    const reason = normalizeText(req.body?.reason);

    if (mode === "set") shop.healthscore = Math.max(0, Math.min(100, value));
    else if (mode === "add") shop.healthscore = Math.max(0, Math.min(100, Number(shop.healthscore || 0) + value));
    else shop.healthscore = Math.max(0, Math.min(100, Number(shop.healthscore || 0) - Math.abs(value || 0)));
    await shop.save();

    await SellerNotification.create({ sellerid: shop.sellerid, shopid: shop._id, type: "Warning", title: "Shop health updated", message: `Health is now ${shop.healthscore}/100. ${reason || "Please follow policy."}` });
    return res.status(200).json({ success: true, message: "Shop health updated.", health: { score: shop.healthscore, level: computeHealthLevel(shop.healthscore) } });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update health." });
  }
};

exports.toggleShopFreeze = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shop = await SellerShop.findById(req.params.shopid);
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const freeze = Boolean(req.body?.freeze);
    const reason = normalizeText(req.body?.reason) || (freeze ? "Frozen by authority" : "Unfrozen by authority");

    shop.healthisfrozen = freeze;
    shop.freezereason = freeze ? reason : "";
    shop.blockedat = freeze ? new Date() : null;
    await shop.save();

    await Item.updateMany({ shopid: shop._id }, { $set: { isactive: !freeze } });
    await SellerNotification.create({ sellerid: shop.sellerid, shopid: shop._id, type: freeze ? "Danger" : "Success", title: freeze ? "Shop frozen" : "Shop activated", message: reason });
    return res.status(200).json({ success: true, message: freeze ? "Shop frozen." : "Shop activated." });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update status." });
  }
};

exports.getAdminShops = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const shops = await SellerShop.find({}).sort({ createdAt: -1 }).populate("sellerid", "_id fullname email").lean();
    return res.status(200).json({ success: true, count: shops.length, shops });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch shops." });
  }
};

exports.getAdminSubscriptions = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const status = normalizeText(req.query?.status);
    const filter = {};
    if (["Pending", "Verified", "Rejected", "Expired"].includes(status)) filter.status = status;
    const subscriptions = await SellerSubscription.find(filter).sort({ createdAt: -1 }).populate("sellerid", "_id fullname email").populate("shopid", "_id shopname").lean();
    return res.status(200).json({ success: true, count: subscriptions.length, subscriptions });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to fetch subscriptions." });
  }
};

exports.decideSubscription = async (req, res) => {
  try {
    const admin = await ensureRole(req, res, "SuperAdmin");
    if (!admin) return;
    const sub = await SellerSubscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found." });

    const decision = normalizeText(req.body?.decision);
    const rejectreason = normalizeText(req.body?.rejectreason);
    if (!["Verified", "Rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Invalid decision." });

    sub.status = decision;
    sub.reviewedby = admin._id;
    sub.reviewedat = new Date();
    sub.rejectreason = decision === "Rejected" ? rejectreason : "";
    if (decision === "Rejected") sub.remainingcredit = 0;
    await sub.save();

    await SellerNotification.create({ sellerid: sub.sellerid, shopid: sub.shopid, type: decision === "Verified" ? "Success" : "Warning", title: `Subscription ${decision.toLowerCase()}`, message: decision === "Verified" ? `${sub.planname} subscription active with ?${sub.remainingcredit} savings.` : `Subscription rejected. ${rejectreason || "Invalid payment proof."}` });
    return res.status(200).json({ success: true, message: `Subscription ${decision.toLowerCase()}.` });
  } catch (_error) {
    return res.status(500).json({ success: false, message: "Failed to update subscription." });
  }
};

exports.attachSellerOrdersFromMainOrder = async (orderDoc) => {
  try {
    if (!orderDoc?.items?.length) return;
    const productIds = orderDoc.items.map((x) => x?.productid).filter(Boolean);
    if (!productIds.length) return;

    const products = await Item.find({ _id: { $in: productIds } }).select("_id sellerid shopid").lean();
    const map = new Map(products.map((x) => [String(x._id), x]));
    const rows = [];

    orderDoc.items.forEach((entry) => {
      const product = map.get(String(entry.productid));
      if (!product?.sellerid || !product?.shopid) return;
      rows.push({
        orderid: orderDoc._id,
        ordernumber: orderDoc.ordernumber,
        sellerid: product.sellerid,
        shopid: product.shopid,
        customer: orderDoc.customer || {},
        shippingaddress: orderDoc.shippingaddress || {},
        payment: orderDoc.payment || {},
        item: {
          productid: entry.productid,
          slug: entry.slug || "",
          name: entry.name || "",
          image: entry.image || "",
          variantname: entry.variantname || "",
          optionname: entry.optionname || "",
          quantity: Number(entry.quantity || 1),
          unitprice: Number(entry.unitprice || 0),
          totalprice: Number(entry.totalprice || 0),
          deliverycharge: Number(entry.deliverycharge || 0),
        },
        status: "placed",
        statushistory: [{ status: "placed", note: "Order placed" }],
      });
    });

    if (rows.length) await SellerOrder.insertMany(rows);
  } catch (error) {
    console.error("attachSellerOrdersFromMainOrder error", error?.message || error);
  }
};
