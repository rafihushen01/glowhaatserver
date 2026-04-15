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
const { getSocketServer, getActorPresence } = require("../utils/SocketServer");
const { encryptChatText, decryptChatText } = require("../utils/ChatCrypto");
const { pushKhanNotification } = require("../utils/KhanNotifier");

const normalizeText = (value = "") => String(value || "").trim();
const normalizeGuestId = (value = "") => normalizeText(value).slice(0, 100);
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const toBool = (value) => {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
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

const resolveRefId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const actorToNotificationKind = (role = "") => {
  const normalized = normalizeText(role).toLowerCase();
  if (normalized === "seller") return "seller";
  if (normalized === "superadmin") return "superadmin";
  return "user";
};

const resolveMessageText = (message = {}) => {
  if (message?.isdeleted) return "This message was deleted.";
  const decrypted = decryptChatText({
    cipher: message?.textenc || "",
    iv: message?.textiv || "",
    tag: message?.texttag || "",
  });
  const plain = normalizeText(message?.text);
  return decrypted || plain;
};

const canActorAccessThread = (thread, actor) => {
  if (resolveRefId(thread?.sellerid) === String(actor?.userId || "")) {
    return { allowed: true, side: "seller" };
  }

  if (actor?.type === "user" && resolveRefId(thread?.buyerid) === String(actor?.userId || "")) {
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

const resolveCounterpartPresence = (thread, actor) => {
  const access = canActorAccessThread(thread, actor);
  if (!access.allowed) return { online: false, lastseenat: null };

  if (access.side === "seller") {
    if (thread?.buyerid?._id) {
      const state = getActorPresence({ type: "user", id: String(thread.buyerid._id) });
      return { online: Boolean(state.online), lastseenat: state.lastSeenAt || null };
    }

    if (thread?.guestsessionid) {
      const state = getActorPresence({ type: "guest", id: String(thread.guestsessionid) });
      return { online: Boolean(state.online), lastseenat: state.lastSeenAt || null };
    }

    return { online: false, lastseenat: null };
  }

  if (thread?.sellerid?._id) {
    const state = getActorPresence({ type: "user", id: String(thread.sellerid._id) });
    return { online: Boolean(state.online), lastseenat: state.lastSeenAt || null };
  }

  return { online: false, lastseenat: null };
};

const serializeThreadList = (thread, actor) => {
  const actorSide = canActorAccessThread(thread, actor).side;
  const isSeller = actorSide === "seller";
  const counterpart = isSeller ? thread?.buyerid : thread?.sellerid;
  const guestDisplay = thread?.guestname || "Guest";
  const counterpartPresence = resolveCounterpartPresence(thread, actor);

  return {
    _id: thread._id,
    guestsessionid: thread.guestsessionid || "",
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
          sessionid: counterpart?._id ? "" : thread?.guestsessionid || "",
        }
      : {
          _id: counterpart?._id || null,
          fullname: counterpart?.fullname || "Seller",
          usersavatar: counterpart?.usersavatar || "",
          role: counterpart?.role || "Seller",
          isguest: false,
          sessionid: "",
        },
    lastmessage: thread.lastmessage || "",
    lastmessagedat: thread.lastmessagedat,
    unread: isSeller ? Number(thread.unreadforseller || 0) : Number(thread.unreadforbuyer || 0),
    pinned: isSeller ? Boolean(thread.pinnedbyseller) : Boolean(thread.pinnedbybuyer),
    pinnedat: isSeller ? thread.pinnedatseller || null : thread.pinnedatbuyer || null,
    muted: isSeller ? Boolean(thread.mutedbyseller) : Boolean(thread.mutedbybuyer),
    mutedat: isSeller ? thread.mutedatseller || null : thread.mutedatbuyer || null,
    archived: isSeller ? Boolean(thread.archivedbyseller) : Boolean(thread.archivedbybuyer),
    archivedat: isSeller ? thread.archivedatseller || null : thread.archivedatbuyer || null,
    blockedbybuyer: Boolean(thread.blockedbybuyer),
    blockedbyseller: Boolean(thread.blockedbyseller),
    counterpartonline: Boolean(counterpartPresence.online),
    counterpartlastseenat: counterpartPresence.lastseenat || null,
    updatedAt: thread.updatedAt,
  };
};

const serializeThreadDetail = (thread, actor = null) => {
  const access = actor ? canActorAccessThread(thread, actor) : { side: "" };
  const isSeller = access.side === "seller";
  const counterpartPresence = actor ? resolveCounterpartPresence(thread, actor) : { online: false, lastseenat: null };
  const counterpart = isSeller ? thread?.buyerid : thread?.sellerid;
  const guestDisplay = thread?.guestname || "Guest";

  return {
    _id: thread._id,
    buyerid: thread.buyerid,
    guestsessionid: thread.guestsessionid,
    guestname: thread.guestname || "Guest",
    sellerid: thread.sellerid,
    counterpart: isSeller
      ? {
          _id: counterpart?._id || null,
          fullname: counterpart?.fullname || guestDisplay,
          usersavatar: counterpart?.usersavatar || "",
          role: counterpart?.role || "Guest",
          isguest: !counterpart?._id,
          sessionid: counterpart?._id ? "" : thread?.guestsessionid || "",
        }
      : {
          _id: counterpart?._id || null,
          fullname: counterpart?.fullname || "Seller",
          usersavatar: counterpart?.usersavatar || "",
          role: counterpart?.role || "Seller",
          isguest: false,
          sessionid: "",
        },
    shopid: thread.shopid,
    productid: thread.productid,
    lastmessage: thread.lastmessage || "",
    lastmessagedat: thread.lastmessagedat,
    unreadforbuyer: Number(thread.unreadforbuyer || 0),
    unreadforseller: Number(thread.unreadforseller || 0),
    blockedbybuyer: Boolean(thread.blockedbybuyer),
    blockedbyseller: Boolean(thread.blockedbyseller),
    pinnedbybuyer: Boolean(thread.pinnedbybuyer),
    pinnedbyseller: Boolean(thread.pinnedbyseller),
    pinnedatbuyer: thread.pinnedatbuyer || null,
    pinnedatseller: thread.pinnedatseller || null,
    pinned: isSeller ? Boolean(thread.pinnedbyseller) : Boolean(thread.pinnedbybuyer),
    pinnedat: isSeller ? thread.pinnedatseller || null : thread.pinnedatbuyer || null,
    mutedbybuyer: Boolean(thread.mutedbybuyer),
    mutedbyseller: Boolean(thread.mutedbyseller),
    mutedatbuyer: thread.mutedatbuyer || null,
    mutedatseller: thread.mutedatseller || null,
    muted: isSeller ? Boolean(thread.mutedbyseller) : Boolean(thread.mutedbybuyer),
    mutedat: isSeller ? thread.mutedatseller || null : thread.mutedatbuyer || null,
    archivedbybuyer: Boolean(thread.archivedbybuyer),
    archivedbyseller: Boolean(thread.archivedbyseller),
    archivedatbuyer: thread.archivedatbuyer || null,
    archivedatseller: thread.archivedatseller || null,
    archived: isSeller ? Boolean(thread.archivedbyseller) : Boolean(thread.archivedbybuyer),
    archivedat: isSeller ? thread.archivedatseller || null : thread.archivedatbuyer || null,
    blockreasonbuyer: thread.blockreasonbuyer || "",
    blockreasonseller: thread.blockreasonseller || "",
    counterpartonline: Boolean(counterpartPresence.online),
    counterpartlastseenat: counterpartPresence.lastseenat || null,
    messages: (thread.messages || []).map((message) => ({
      _id: message._id,
      senderid: message.senderid,
      senderkind: message.senderkind,
      senderguestsessionid: message.senderguestsessionid,
      senderguestname: message.senderguestname,
      senderrole: message.senderrole,
      text: resolveMessageText(message),
      media: message.isdeleted ? [] : message.media,
      replytoid: message.replytoid || null,
      replypreview: message.replypreview || "",
      forwardedfromid: message.forwardedfromid || null,
      forwardedpreview: message.forwardedpreview || "",
      readbybuyer: Boolean(message.readbybuyer),
      readbybuyerat: message.readbybuyerat || null,
      readbyseller: Boolean(message.readbyseller),
      readbysellerat: message.readbysellerat || null,
      isdeleted: Boolean(message.isdeleted),
      deletedby: message.deletedby || "",
      deletedat: message.deletedat,
      createdat: message.createdat,
    })),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
};

const markReadForSide = (thread, side) => {
  const now = new Date();
  if (side === "seller") {
    thread.unreadforseller = 0;
    thread.messages = (thread.messages || []).map((message) => {
      if (message.senderrole === "Seller") return message;
      const next = message.toObject();
      next.readbyseller = true;
      next.readbysellerat = next.readbysellerat || now;
      return next;
    });
  } else {
    thread.unreadforbuyer = 0;
    thread.messages = (thread.messages || []).map((message) => {
      if (message.senderrole === "Buyer") return message;
      const next = message.toObject();
      next.readbybuyer = true;
      next.readbybuyerat = next.readbybuyerat || now;
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

      const encrypted = encryptChatText(messageText);
      thread.messages.push({
        senderid: actor.userId,
        senderkind: actor.type,
        senderguestsessionid: actor.guestSessionId,
        senderguestname: actor.guestName,
        senderrole: "Buyer",
        text: encrypted.cipher ? "" : messageText,
        textenc: encrypted.cipher || "",
        textiv: encrypted.iv || "",
        texttag: encrypted.tag || "",
        media: [],
        readbybuyer: true,
        readbybuyerat: new Date(),
        readbyseller: false,
        readbysellerat: null,
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

      if (thread.sellerid) {
        await SellerNotification.create({
          sellerid: thread.sellerid,
          shopid: thread.shopid,
          type: "Info",
          title: "New KhanChat message",
          message: "A customer sent a new message.",
          metadata: { source: "khanchat", threadid: String(thread._id) },
        });
        await pushKhanNotification({
          recipientkind: "seller",
          recipientid: thread.sellerid,
          type: "Info",
          channel: "khanchat",
          title: "New KhanChat message",
          message: "A customer started a conversation.",
          metadata: { threadid: String(thread._id), shopid: String(thread.shopid || "") },
        });
      }
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
      thread: serializeThreadDetail(populated, actor),
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
    const payload = sanitize(req.query || {});
    const q = normalizeText(payload.q);
    const archived = normalizeText(payload.archived).toLowerCase();
    const includeArchived = archived === "all";
    const wantsArchivedOnly = archived === "true";

    if (!includeArchived) {
      if (actor.role === "Seller") baseFilter.archivedbyseller = wantsArchivedOnly;
      else baseFilter.archivedbybuyer = wantsArchivedOnly;
    }

    const threads = await SellerChatThread.find({ ...baseFilter, isactive: true })
      .sort({ lastmessagedat: -1, updatedAt: -1 })
      .limit(200)
      .populate("buyerid", "_id fullname usersavatar role")
      .populate("sellerid", "_id fullname usersavatar role")
      .populate("shopid", "_id shopname slug profileimage")
      .populate("productid", "_id name slug whiteimage")
      .lean();

    let mapped = threads.map((thread) => serializeThreadList(thread, actor));
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      mapped = mapped.filter((thread) =>
        regex.test(thread?.counterpart?.fullname || "") ||
        regex.test(thread?.shop?.shopname || "") ||
        regex.test(thread?.lastmessage || "") ||
        regex.test(thread?.product?.name || "")
      );
    }

    return res.status(200).json({
      success: true,
      count: mapped.length,
      threads: mapped,
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

    return res.status(200).json({ success: true, thread: serializeThreadDetail(thread, actor) });
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
    const replyToId = normalizeText(payload.replytoid);
    const forwardMessageId = normalizeText(payload.forwardmessageid);
    const media = await uploadMediaFromFiles(req.files || []);

    if (!text && media.length === 0 && !mongoose.Types.ObjectId.isValid(forwardMessageId)) {
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

    let replyPreview = "";
    let forwardedPreview = "";
    let resolvedReplyId = null;
    let resolvedForwardedId = null;

    if (mongoose.Types.ObjectId.isValid(replyToId)) {
      const replied = (thread.messages || []).find((entry) => String(entry._id) === String(replyToId));
      if (replied) {
        resolvedReplyId = replied._id;
        replyPreview = resolveMessageText(replied).slice(0, 280);
      }
    }

    if (mongoose.Types.ObjectId.isValid(forwardMessageId)) {
      const fwd = (thread.messages || []).find((entry) => String(entry._id) === String(forwardMessageId));
      if (fwd) {
        resolvedForwardedId = fwd._id;
        forwardedPreview = resolveMessageText(fwd).slice(0, 280);
      }
    }

    const encrypted = encryptChatText(text);
    const senderSide = permission.side;
    const senderRole = senderSide === "seller" ? "Seller" : "Buyer";

    thread.messages.push({
      senderid: actor.userId,
      senderkind: actor.type,
      senderguestsessionid: actor.guestSessionId,
      senderguestname: actor.guestName,
      senderrole: senderRole,
      text: encrypted.cipher ? "" : text,
      textenc: encrypted.cipher || "",
      textiv: encrypted.iv || "",
      texttag: encrypted.tag || "",
      replytoid: resolvedReplyId,
      replypreview: replyPreview,
      forwardedfromid: resolvedForwardedId,
      forwardedpreview: forwardedPreview,
      media,
      readbybuyer: senderRole === "Buyer",
      readbybuyerat: senderRole === "Buyer" ? new Date() : null,
      readbyseller: senderRole === "Seller",
      readbysellerat: senderRole === "Seller" ? new Date() : null,
    });

    thread.lastmessage = text || forwardedPreview || (media[0]?.type === "video" ? "Sent a video" : "Sent an image");
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
        text: resolveMessageText(latest),
        media: latest.media,
        replytoid: latest.replytoid || null,
        replypreview: latest.replypreview || "",
        forwardedfromid: latest.forwardedfromid || null,
        forwardedpreview: latest.forwardedpreview || "",
        createdat: latest.createdat,
      },
    });

    if (senderRole === "Buyer" && thread.sellerid) {
      await SellerNotification.create({
        sellerid: thread.sellerid,
        shopid: thread.shopid,
        type: "Info",
        title: "New KhanChat message",
        message: "A customer sent a new message.",
        metadata: { source: "khanchat", threadid: String(thread._id) },
      });
      await pushKhanNotification({
        recipientkind: "seller",
        recipientid: thread.sellerid,
        type: "Info",
        channel: "khanchat",
        title: "New KhanChat message",
        message: "A customer sent you a new message.",
        metadata: { threadid: String(thread._id), shopid: String(thread.shopid || "") },
      });
    }

    if (senderRole === "Seller" && thread.buyerid) {
      await pushKhanNotification({
        recipientkind: actorToNotificationKind("User"),
        recipientid: thread.buyerid,
        type: "Info",
        channel: "khanchat",
        title: "New reply from seller",
        message: "You received a new message from seller.",
        metadata: { threadid: String(thread._id), shopid: String(thread.shopid || "") },
      });
    }

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
    target.textenc = "";
    target.textiv = "";
    target.texttag = "";
    target.replytoid = null;
    target.replypreview = "";
    target.forwardedfromid = null;
    target.forwardedpreview = "";
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

exports.toggleThreadPin = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;

    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid thread id." });
    }

    const payload = sanitize(req.body || {});
    const pin = Boolean(payload.pin);

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });

    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    const now = pin ? new Date() : null;
    if (permission.side === "seller") {
      thread.pinnedbyseller = pin;
      thread.pinnedatseller = now;
    } else {
      thread.pinnedbybuyer = pin;
      thread.pinnedatbuyer = now;
    }

    await thread.save();

    emitChatEvent(String(thread._id), "chat_pin_update", {
      threadid: String(thread._id),
      side: permission.side,
      pin,
      pinnedat: now,
    });

    return res.status(200).json({
      success: true,
      message: pin ? "Conversation pinned." : "Conversation unpinned.",
      pin,
      pinnedat: now,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update pin state." });
  }
};

exports.toggleThreadMute = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;
    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid thread id." });

    const payload = sanitize(req.body || {});
    const mute = toBool(payload.mute);

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });
    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    const now = mute ? new Date() : null;
    if (permission.side === "seller") {
      thread.mutedbyseller = mute;
      thread.mutedatseller = now;
    } else {
      thread.mutedbybuyer = mute;
      thread.mutedatbuyer = now;
    }

    await thread.save();
    emitChatEvent(String(thread._id), "chat_mute_update", { threadid: String(thread._id), side: permission.side, mute, mutedat: now });
    return res.status(200).json({ success: true, message: mute ? "Conversation muted." : "Conversation unmuted.", mute, mutedat: now });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update mute state." });
  }
};

exports.toggleThreadArchive = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;
    const id = normalizeText(req.params.threadid);
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid thread id." });

    const payload = sanitize(req.body || {});
    const archive = toBool(payload.archive);

    const thread = await SellerChatThread.findById(id);
    if (!thread || !thread.isactive) return res.status(404).json({ success: false, message: "Thread not found." });
    const permission = canActorAccessThread(thread, actor);
    if (!permission.allowed) return res.status(403).json({ success: false, message: "Forbidden." });

    const now = archive ? new Date() : null;
    if (permission.side === "seller") {
      thread.archivedbyseller = archive;
      thread.archivedatseller = now;
    } else {
      thread.archivedbybuyer = archive;
      thread.archivedatbuyer = now;
    }

    await thread.save();
    emitChatEvent(String(thread._id), "chat_archive_update", { threadid: String(thread._id), side: permission.side, archive, archivedat: now });
    return res.status(200).json({ success: true, message: archive ? "Conversation archived." : "Conversation restored.", archive, archivedat: now });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to update archive state." });
  }
};

exports.searchChatMessages = async (req, res) => {
  try {
    const actor = await ensureActor(req, res, { allowGuest: true });
    if (!actor) return;
    const query = sanitize(req.query || {});
    const q = normalizeText(query.q);
    if (!q) return res.status(200).json({ success: true, count: 0, rows: [] });

    const baseFilter = actor.type === "guest" ? { guestsessionid: actor.guestSessionId } : actor.role === "Seller" ? { sellerid: actor.userId } : { buyerid: actor.userId };
    const threads = await SellerChatThread.find({ ...baseFilter, isactive: true })
      .select("_id shopid productid sellerid buyerid guestsessionid guestname messages")
      .populate("shopid", "_id shopname slug profileimage")
      .populate("productid", "_id name slug whiteimage")
      .lean();

    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    const rows = [];

    (threads || []).forEach((thread) => {
      (thread.messages || []).forEach((message) => {
        const text = resolveMessageText(message);
        if (!text || !regex.test(text)) return;
        rows.push({
          threadid: thread._id,
          messageid: message._id,
          text,
          createdat: message.createdat,
          senderrole: message.senderrole,
          shop: thread.shopid ? { _id: thread.shopid._id, shopname: thread.shopid.shopname, slug: thread.shopid.slug } : null,
          product: thread.productid ? { _id: thread.productid._id, name: thread.productid.name, slug: thread.productid.slug } : null,
        });
      });
    });

    rows.sort((a, b) => new Date(b.createdat).getTime() - new Date(a.createdat).getTime());
    return res.status(200).json({ success: true, count: rows.length, rows: rows.slice(0, 200) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to search messages." });
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

    const superAdmins = await User.find({ role: "SuperAdmin" }).select("_id").lean();
    await Promise.all(
      (superAdmins || []).map((admin) =>
        pushKhanNotification({
          recipientkind: "superadmin",
          recipientid: admin._id,
          type: "Warning",
          channel: "moderation",
          title: "New KhanChat report",
          message: `A new seller report was submitted by ${actor.type === "user" ? actor.user?.fullname || "Customer" : actor.guestName}.`,
          metadata: { reportid: String(report._id), threadid: String(thread._id), sellerid: String(thread.sellerid || "") },
        })
      )
    );

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

    if (report.sellerid) {
      await pushKhanNotification({
        recipientkind: "seller",
        recipientid: report.sellerid,
        type: decision === "ActionTaken" ? "Warning" : "Info",
        channel: "moderation",
        title: `KhanChat report ${decision}`,
        message: decision === "ActionTaken" ? "A report against your chat was accepted by SuperAdmin." : `A report against your chat was marked ${decision}.`,
        metadata: { reportid: String(report._id), decision, healthdeduction },
      });
    }

    if (report.reporterid) {
      await pushKhanNotification({
        recipientkind: "user",
        recipientid: report.reporterid,
        type: "Info",
        channel: "moderation",
        title: "Your KhanChat report was reviewed",
        message: `SuperAdmin marked your report as ${decision}.`,
        metadata: { reportid: String(report._id), decision },
      });
    }

    return res.status(200).json({ success: true, message: `Report marked as ${decision}.`, report });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to decide report." });
  }
};
