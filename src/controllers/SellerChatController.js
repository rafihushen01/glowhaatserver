const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const path = require("path");
const SellerChatThread = require("../models/SellerChatThread");
const SellerChatReport = require("../models/SellerChatReport");
const SellerShop = require("../models/SellerShop");
const SellerNotification = require("../models/SellerNotification");
const User = require("../models/User");
const Item = require("../models/Item");
const uploadoncloudinary = require("../utils/Cloudinary");
const { getSocketServer } = require("../utils/SocketServer");

const normalizeText = (value = "") => String(value || "").trim();
const normalizeGuestId = (value = "") => normalizeText(value).slice(0, 100);
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseGuestSessionFromRequest = (req, source = {}) => {
  const raw =
    source?.guestsessionid ||
    req.headers?.["x-guest-session"] ||
    req.query?.guestsessionid ||
    req.body?.guestsessionid ||
    "";

  return normalizeGuestId(raw);
};

const parseGuestNameFromRequest = (req, source = {}) => {
  const raw = source?.guestname || req.body?.guestname || req.query?.guestname || req.headers?.["x-guest-name"] || "";
  const text = normalizeText(raw);
  return text ? text.slice(0, 120) : "Guest";
};

const ensureActor = async (req, res, options = {}) => {
  const { allowGuest = true } = options;
  const userId = req.user?.userId;

  if (userId) {
    const user = await User.findById(userId).select("_id fullname email role usersavatar").lean();
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return null;
    }

    return {
      type: "user",
      user,
      role: user.role,
      userId: user._id,
      guestSessionId: "",
      guestName: "",
    };
  }

  if (!allowGuest) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const guestSessionId = parseGuestSessionFromRequest(req);
  if (!guestSessionId) {
    res.status(400).json({ success: false, message: "Guest session is required." });
    return null;
  }

  return {
    type: "guest",
    user: null,
    role: "Guest",
    userId: null,
    guestSessionId,
    guestName: parseGuestNameFromRequest(req),
  };
};

const ensureSuperAdmin = async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const admin = await User.findById(userId).select("_id role fullname").lean();
  if (!admin || admin.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }

  return admin;
};

const uploadMediaFromFiles = async (files = []) => {
  const prepared = [];

  for (const file of files) {
    if (!file?.path) continue;

    let uploaded = "";
    try {
      uploaded = await uploadoncloudinary(file.path);
    } catch (_error) {
      uploaded = `/public/${path.basename(file.path)}`;
    }

    if (!uploaded) continue;

    const mimetype = normalizeText(file.mimetype).toLowerCase();
    const mediaType = mimetype.startsWith("video/") ? "video" : "image";

    prepared.push({
      url: uploaded,
      type: mediaType,
      name: normalizeText(file.originalname || ""),
    });
  }

  return prepared;
};

const canActorAccessThread = (thread, actor) => {
  if (String(thread?.sellerid || "") === String(actor?.userId || "")) {
    return { allowed: true, side: "seller" };
  }

  if (actor?.type === "user" && String(thread?.buyerid || "") === String(actor?.userId || "")) {
    return { allowed: true, side: "buyer" };
  }

  if (
    actor?.type === "guest" &&
    thread?.guestsessionid &&
    String(thread.guestsessionid) === String(actor?.guestSessionId)
  ) {
    return { allowed: true, side: "buyer" };
  }

  return { allowed: false, side: "" };
};

const emitChatEvent = (threadId, event, payload = {}) => {
  const io = getSocketServer();
  if (!io) return;
  io.to(`chat:${threadId}`).emit(event, payload);
};

const emitSellerHealth = (sellerId, payload = {}) => {
  const io = getSocketServer();
  if (!io) return;
  io.to(`seller:${sellerId}`).emit("seller_health_update", payload);
};

const serializeThreadList = (thread, actor) => {
  const actorSide = canActorAccessThread(thread, actor).side;
  const isSeller = actorSide === "seller";
  const counterpart = isSeller ? thread?.buyerid : thread?.sellerid;
  const guestDisplay = thread?.guestname || "Guest";

  return {
    _id: thread._id,
    shop: thread.shopid
      ? {
          _id: thread.shopid._id,
          shopname: thread.shopid.shopname,
          slug: thread.shopid.slug,
          profileimage: thread.shopid.profileimage,
        }
      : null,
    product: thread.productid
      ? {
          _id: thread.productid._id,
          name: thread.productid.name,
          slug: thread.productid.slug,
          whiteimage: thread.productid.whiteimage,
        }
      : null,
    counterpart: isSeller
      ? {
          _id: counterpart?._id || null,
          fullname: counterpart?.fullname || guestDisplay,
          usersavatar: counterpart?.usersavatar || "",
          role: counterpart?.role || "Guest",
          isguest: !counterpart?._id,
        }
      : {
          _id: counterpart?._id || null,
          fullname: counterpart?.fullname || "Seller",
          usersavatar: counterpart?.usersavatar || "",
          role: counterpart?.role || "Seller",
          isguest: false,
        },
    lastmessage: thread.lastmessage || "",
    lastmessagedat: thread.lastmessagedat,
    unread: isSeller ? Number(thread.unreadforseller || 0) : Number(thread.unreadforbuyer || 0),
    blockedbybuyer: Boolean(thread.blockedbybuyer),
    blockedbyseller: Boolean(thread.blockedbyseller),
    updatedAt: thread.updatedAt,
  };
};

const serializeThreadDetail = (thread) => ({
  _id: thread._id,
  buyerid: thread.buyerid,
  guestsessionid: thread.guestsessionid,
  guestname: thread.guestname || "Guest",
  sellerid: thread.sellerid,
  shopid: thread.shopid,
  productid: thread.productid,
  lastmessage: thread.lastmessage || "",
  lastmessagedat: thread.lastmessagedat,
  unreadforbuyer: Number(thread.unreadforbuyer || 0),
  unreadforseller: Number(thread.unreadforseller || 0),
  blockedbybuyer: Boolean(thread.blockedbybuyer),
  blockedbyseller: Boolean(thread.blockedbyseller),
  blockreasonbuyer: thread.blockreasonbuyer || "",
  blockreasonseller: thread.blockreasonseller || "",
  messages: (thread.messages || []).map((message) => ({
    _id: message._id,
    senderid: message.senderid,
    senderkind: message.senderkind,
    senderguestsessionid: message.senderguestsessionid,
    senderguestname: message.senderguestname,
    senderrole: message.senderrole,
    text: message.isdeleted ? "This message was deleted." : message.text,
    media: message.isdeleted ? [] : message.media,
    readbybuyer: Boolean(message.readbybuyer),
    readbyseller: Boolean(message.readbyseller),
    isdeleted: Boolean(message.isdeleted),
    deletedby: message.deletedby || "",
    deletedat: message.deletedat,
    createdat: message.createdat,
  })),
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
});

const markReadForSide = (thread, side) => {
  if (side === "seller") {
    thread.unreadforseller = 0;
    thread.messages = (thread.messages || []).map((message) => {
      if (message.senderrole === "Seller") return message;
      const next = message.toObject();
      next.readbyseller = true;
      return next;
    });
  } else {
    thread.unreadforbuyer = 0;
    thread.messages = (thread.messages || []).map((message) => {
      if (message.senderrole === "Buyer") return message;
      const next = message.toObject();
      next.readbybuyer = true;
      return next;
    });
  }
};

exports.startSellerChat = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const payload = sanitize(req.body || {});
    const shopSlug = normalizeText(payload.shopslug).toLowerCase();
    const shopId = normalizeText(payload.shopid);
    const productId = normalizeText(payload.productid);
    const messageText = normalizeText(payload.message);

    const shopFilter = {};
    if (shopSlug) shopFilter.slug = shopSlug;
    if (!shopSlug && mongoose.Types.ObjectId.isValid(shopId)) shopFilter._id = new mongoose.Types.ObjectId(shopId);

    if (!Object.keys(shopFilter).length) {
      return res.status(400).json({ success: false, message: "Shop slug or shop id is required." });
    }

    const shop = await SellerShop.findOne(shopFilter).lean();
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    if (actor.type === "user" && String(actor.userId) === String(shop.sellerid)) {
      return res.status(400).json({ success: false, message: "You cannot start chat with your own shop." });
    }

    let productObjectId = null;
    if (mongoose.Types.ObjectId.isValid(productId)) {
      const product = await Item.findOne({ _id: productId, shopid: shop._id }).select("_id").lean();
      if (product) productObjectId = product._id;
    }

    const buyerFilter = actor.type === "guest" ? { guestsessionid: actor.guestSessionId } : { buyerid: actor.userId };

    let thread = await SellerChatThread.findOne({
      ...buyerFilter,
      sellerid: shop.sellerid,
      shopid: shop._id,
      productid: productObjectId,
      isactive: true,
    });

    if (!thread && !productObjectId) {
      thread = await SellerChatThread.findOne({
        ...buyerFilter,
        sellerid: shop.sellerid,
        shopid: shop._id,
        isactive: true,
      }).sort({ updatedAt: -1 });
    }

    if (!thread) {
      thread = await SellerChatThread.create({
        buyerid: actor.type === "user" ? actor.userId : null,
        guestsessionid: actor.type === "guest" ? actor.guestSessionId : "",
        guestname: actor.type === "guest" ? actor.guestName : "",
        sellerid: shop.sellerid,
        shopid: shop._id,
        productid: productObjectId || null,
        lastmessage: "",
        lastmessagedat: new Date(),
        unreadforbuyer: 0,
        unreadforseller: 0,
        messages: [],
      });
    }

    if (messageText) {
      if (thread.blockedbybuyer || thread.blockedbyseller) {
        return res.status(423).json({ success: false, message: "Chat is blocked. Unblock to send message." });
      }

      thread.messages.push({
        senderid: actor.userId,
        senderkind: actor.type,
        senderguestsessionid: actor.guestSessionId,
        senderguestname: actor.guestName,
        senderrole: "Buyer",
        text: messageText,
        media: [],
        readbybuyer: true,
        readbyseller: false,
      });
      thread.lastmessage = messageText;
      thread.lastmessagedat = new Date();
      thread.unreadforbuyer = 0;
      thread.unreadforseller = Number(thread.unreadforseller || 0) + 1;
      await thread.save();

      emitChatEvent(String(thread._id), "chat_message", {
        threadid: String(thread._id),
        senderrole: "Buyer",
        text: messageText,
      });
    }

    const populated = await SellerChatThread.findById(thread._id)
      .populate("buyerid", "_id fullname usersavatar role")
      .populate("sellerid", "_id fullname usersavatar role")
      .populate("shopid", "_id shopname slug profileimage")
      .populate("productid", "_id name slug whiteimage")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Chat ready.",
      thread: serializeThreadDetail(populated),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to start chat." });
  }
};

exports.getMyChatThreads = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const baseFilter = actor.type === "guest" ? { guestsessionid: actor.guestSessionId } : actor.role === "Seller" ? { sellerid: actor.userId } : { buyerid: actor.userId };

    const threads = await SellerChatThread.find({ ...baseFilter, isactive: true })
      .sort({ lastmessagedat: -1, updatedAt: -1 })
      .limit(200)
      .populate("buyerid", "_id fullname usersavatar role")
      .populate("sellerid", "_id fullname usersavatar role")
      .populate("shopid", "_id shopname slug profileimage")
      .populate("productid", "_id name slug whiteimage")
      .lean();

    return res.status(200).json({
      success: true,
      count: threads.length,
      threads: threads.map((thread) => serializeThreadList(thread, actor)),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch chats." });
  }
};

exports.getChatThread = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    const thread = await SellerChatThread.findById(id)
      .populate("buyerid", "_id fullname usersavatar role")
      .populate("sellerid", "_id fullname usersavatar role")
      .populate("shopid", "_id shopname slug profileimage")
      .populate("productid", "_id name slug whiteimage")
      .lean();

    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) {
      return res.status(403).json({ success: false, message: "Forbidden." });
    }

    return res.status(200).json({ success: true, thread: serializeThreadDetail(thread) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load chat thread." });
  }
};

exports.sendChatMessage = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    const payload = sanitize(req.body || {});
    const text = normalizeText(payload.text);
    const media = await uploadMediaFromFiles(req.files || []);

    if (!text && media.length === 0) {
      return res.status(400).json({ success: false, message: "Message text, image, or video is required." });
    }

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) {
      return res.status(403).json({ success: false, message: "Forbidden." });
    }

    if (thread.blockedbybuyer || thread.blockedbyseller) {
      return res.status(423).json({ success: false, message: "Chat is blocked. Unblock to continue." });
    }

    const senderSide = permission.side;
    const senderRole = senderSide === "seller" ? "Seller" : "Buyer";

    thread.messages.push({
      senderid: actor.userId,
      senderkind: actor.type,
      senderguestsessionid: actor.guestSessionId,
      senderguestname: actor.guestName,
      senderrole: senderRole,
      text,
      media,
      readbybuyer: senderRole === "Buyer",
      readbyseller: senderRole === "Seller",
    });

    thread.lastmessage = text || (media[0]?.type === "video" ? "Sent a video" : "Sent an image");
    thread.lastmessagedat = new Date();

    if (senderRole === "Seller") {
      thread.unreadforseller = 0;
      thread.unreadforbuyer = Number(thread.unreadforbuyer || 0) + 1;
    } else {
      thread.unreadforbuyer = 0;
      thread.unreadforseller = Number(thread.unreadforseller || 0) + 1;
    }

    await thread.save();

    const latest = thread.messages[thread.messages.length - 1];

    emitChatEvent(String(thread._id), "chat_message", {
      threadid: String(thread._id),
      message: {
        _id: latest._id,
        senderrole: latest.senderrole,
        senderkind: latest.senderkind,
        senderguestname: latest.senderguestname,
        text: latest.text,
        media: latest.media,
        createdat: latest.createdat,
      },
    });

    return res.status(201).json({ success: true, message: "Message sent.", chatmessage: latest });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to send message." });
  }
};

exports.deleteChatMessage = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const threadId = normalizeText(req.params.threadid);
    const messageId = normalizeText(req.params.messageid);

    if (!mongoose.Types.ObjectId.isValid(threadId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }

    const thread = await SellerChatThread.findById(threadId);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    const target = (thread.messages || []).find((message) => String(message._id) === String(messageId));
    if (!target) return res.status(404).json({ success: false, message: "Message not found." });

    const canDelete =
      String(target.senderid || "") === String(actor.userId || "") ||
      (target.senderkind === "guest" && target.senderguestsessionid === actor.guestSessionId);

    if (!canDelete && actor.role !== "SuperAdmin") {
      return res.status(403).json({ success: false, message: "Only sender can delete this message." });
    }

    target.isdeleted = true;
    target.text = "";
    target.media = [];
    target.deletedat = new Date();
    target.deletedby = actor.role === "SuperAdmin" ? "admin" : permission.side;

    await thread.save();

    emitChatEvent(String(thread._id), "chat_message_deleted", {
      threadid: String(thread._id),
      messageid: String(target._id),
    });

    return res.status(200).json({ success: true, message: "Message deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to delete message." });
  }
};

exports.markChatThreadRead = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    markReadForSide(thread, permission.side);
    await thread.save();

    emitChatEvent(String(thread._id), "chat_read", {
      threadid: String(thread._id),
      side: permission.side,
    });

    return res.status(200).json({ success: true, message: "Chat marked as read." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update read state." });
  }
};

exports.toggleThreadBlock = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    const payload = sanitize(req.body || {});
    const block = Boolean(payload.block);
    const reason = normalizeText(payload.reason).slice(0, 1000);

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    if (permission.side === "seller") {
      thread.blockedbyseller = block;
      thread.blockreasonseller = block ? reason : "";
    } else {
      thread.blockedbybuyer = block;
      thread.blockreasonbuyer = block ? reason : "";
    }

    await thread.save();

    emitChatEvent(String(thread._id), "chat_block_update", {
      threadid: String(thread._id),
      blockedbybuyer: Boolean(thread.blockedbybuyer),
      blockedbyseller: Boolean(thread.blockedbyseller),
    });

    return res.status(200).json({
      success: true,
      message: block ? "Conversation blocked." : "Conversation unblocked.",
      thread: {
        blockedbybuyer: Boolean(thread.blockedbybuyer),
        blockedbyseller: Boolean(thread.blockedbyseller),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update block state." });
  }
};

exports.createSellerReport = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const payload = sanitize(req.body || {});
    const threadId = normalizeText(payload.threadid);
    const reason = normalizeText(payload.reason).slice(0, 160);
    const details = normalizeText(payload.details).slice(0, 4000);

    if (!mongoose.Types.ObjectId.isValid(threadId)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    if (!reason) {
      return res.status(400).json({ success: false, message: "Report reason is required." });
    }

    const thread = await SellerChatThread.findById(threadId).lean();
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed || permission.side !== "buyer") {
      return res.status(403).json({ success: false, message: "Only buyer/guest can report seller." });
    }

    const evidence = await uploadMediaFromFiles(req.files || []);

    const report = await SellerChatReport.create({
      threadid: thread._id,
      shopid: thread.shopid,
      sellerid: thread.sellerid,
      reporterid: actor.type === "user" ? actor.userId : null,
      reporterguestsessionid: actor.type === "guest" ? actor.guestSessionId : "",
      reportername: actor.type === "user" ? actor.user?.fullname || "Customer" : actor.guestName,
      reason,
      details,
      evidence,
      status: "Pending",
    });

    return res.status(201).json({ success: true, message: "Report submitted to superadmin.", reportid: report._id });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to submit report." });
  }
};

exports.getAdminChatReports = async (req, res) => {
  try {
    const admin = await ensureSuperAdmin(req, res);
    if (!admin) return;

    const status = normalizeText(req.query?.status);
    const filter = {};
    if (["Pending", "Investigating", "ActionTaken", "Rejected"].includes(status)) filter.status = status;

    const reports = await SellerChatReport.find(filter)
      .sort({ createdAt: -1 })
      .populate("threadid", "_id blockedbybuyer blockedbyseller")
      .populate("shopid", "_id shopname healthscore sellerid")
      .populate("sellerid", "_id fullname email")
      .populate("reporterid", "_id fullname email role")
      .lean();

    return res.status(200).json({ success: true, count: reports.length, reports });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch reports." });
  }
};

exports.decideChatReport = async (req, res) => {
  try {
    const admin = await ensureSuperAdmin(req, res);
    if (!admin) return;

    const reportId = normalizeText(req.params.reportid);
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ success: false, message: "Invalid report id." });
    }

    const payload = sanitize(req.body || {});
    const decision = normalizeText(payload.decision);
    const adminnote = normalizeText(payload.adminnote).slice(0, 2000);
    const healthdeduction = Math.max(0, Math.min(50, toNumber(payload.healthdeduction, 0)));

    if (!["Investigating", "ActionTaken", "Rejected"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Invalid decision." });
    }

    const report = await SellerChatReport.findById(reportId);
    if (!report) return res.status(404).json({ success: false, message: "Report not found." });

    report.status = decision;
    report.adminnote = adminnote;
    report.reviewedby = admin._id;
    report.reviewedat = new Date();

    if (decision === "ActionTaken") {
      report.healthdeduction = healthdeduction;

      const shop = await SellerShop.findById(report.shopid);
      if (shop) {
        shop.healthscore = Math.max(0, Math.min(100, Number(shop.healthscore || 0) - healthdeduction));
        await shop.save();

        await SellerNotification.create({
          sellerid: shop.sellerid,
          shopid: shop._id,
          type: "Warning",
          title: "Policy warning from KhanChat",
          message: `A customer report was accepted. Health reduced by ${healthdeduction}. Current health ${shop.healthscore}/100.`,
        });

        emitSellerHealth(String(shop.sellerid), {
          shopid: String(shop._id),
          healthscore: Number(shop.healthscore || 0),
          deduction: healthdeduction,
          reason: "Chat report action",
        });
      }
    } else {
      report.healthdeduction = 0;
    }

    await report.save();

    return res.status(200).json({ success: true, message: `Report marked as ${decision}.`, report });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to decide report." });
  }
};
