const express = require("express");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const upload = require("../middlewares/Multer");
const { otpLimiter } = require("../utils/RateLimit");
const {
  startSellerOnboarding,
  requestSellerOtp,
  verifySellerOtp,
  submitSellerRequest,
  getSellerRequestStatus,
  listSellerRequestsForAdmin,
  decideSellerRequest,
} = require("../controllers/SellerController");
const {
  getSellerPanelBootstrap,
  getSellerShop,
  createSellerShop,
  getSellerItems,
  createSellerItem,
  updateSellerItem,
  deleteSellerItem,
  getSellerOrders,
  updateSellerOrderStatus,
  requestItemSponsorship,
  getSellerSponsorships,
  getSellerCommission,
  submitSellerCommissionPayment,
  getSellerNotifications,
  markSellerNotificationRead,
  markAllSellerNotificationsRead,
  requestSellerSubscription,
  getAdminSponsorshipRequests,
  decideSponsorshipRequest,
  getAdminCommissionConfig,
  setGlobalCommissionPercent,
  setKhanCommissionPercent,
  setSellerCommissionPercent,
  getAdminKhanCommissionSummary,
  getAdminCommissionPayments,
  decideCommissionPayment,
  updateShopHealth,
  toggleShopFreeze,
  getAdminShops,
  getAdminSubscriptions,
  decideSubscription,
} = require("../controllers/SellerPanelController");
const { getPublicShopProfile, toggleShopFollow, rateShop, reportShop } = require("../controllers/SellerPublicController");
const {
  startSellerChat,
  getMyChatThreads,
  getChatThread,
  sendChatMessage,
  deleteChatMessage,
  markChatThreadRead,
  toggleThreadBlock,
  toggleThreadPin,
  toggleThreadMute,
  toggleThreadArchive,
  searchChatMessages,
  createSellerReport,
  getAdminChatReports,
  decideChatReport,
  getAdminChatThreads,
  getAdminChatThreadById,
  adminEditChatMessage,
  adminDeleteChatMessage,
  adminSendMessageToThread,
} = require("../controllers/SellerChatController");

const router = express.Router();

router.post("/start", optionalauth, startSellerOnboarding);
router.post("/request-otp", otpLimiter, optionalauth, requestSellerOtp);
router.post("/verify-otp", optionalauth, verifySellerOtp);
router.post(
  "/submit",
  optionalauth,
  upload.fields([
    { name: "storeprofileimage", maxCount: 1 },
    { name: "storebannerimage", maxCount: 1 },
    { name: "physicalstoreimage", maxCount: 1 },
    { name: "niddocfront", maxCount: 1 },
    { name: "niddocback", maxCount: 1 },
    { name: "dateofbirthproof", maxCount: 1 },
  ]),
  submitSellerRequest
);
router.get("/status", optionalauth, getSellerRequestStatus);

router.get("/admin/requests", isauth, listSellerRequestsForAdmin);
router.patch("/admin/requests/:id/decision", isauth, decideSellerRequest);

router.get("/panel/bootstrap", isauth, getSellerPanelBootstrap);
router.get("/panel/shop", isauth, getSellerShop);
router.post(
  "/panel/shop",
  isauth,
  upload.fields([
    { name: "profileimage", maxCount: 1 },
    { name: "bannerimage", maxCount: 1 },
  ]),
  createSellerShop
);

router.get("/panel/items", isauth, getSellerItems);
router.post("/panel/items", isauth, upload.any(), createSellerItem);
router.patch("/panel/items/:id", isauth, upload.any(), updateSellerItem);
router.delete("/panel/items/:id", isauth, deleteSellerItem);

router.get("/panel/orders", isauth, getSellerOrders);
router.patch("/panel/orders/:id/status", isauth, updateSellerOrderStatus);

router.get("/panel/sponsorships", isauth, getSellerSponsorships);
router.post(
  "/panel/sponsorships",
  isauth,
  upload.fields([{ name: "paymentss", maxCount: 1 }]),
  requestItemSponsorship
);

router.get("/panel/commission", isauth, getSellerCommission);
router.post(
  "/panel/commission/submit",
  isauth,
  upload.fields([{ name: "paymentss", maxCount: 1 }]),
  submitSellerCommissionPayment
);

router.get("/panel/notifications", isauth, getSellerNotifications);
router.patch("/panel/notifications/:id/read", isauth, markSellerNotificationRead);
router.patch("/panel/notifications/read-all", isauth, markAllSellerNotificationsRead);
router.post(
  "/panel/subscriptions",
  isauth,
  upload.fields([{ name: "paymentss", maxCount: 1 }]),
  requestSellerSubscription
);

router.get("/admin/panel/sponsorships", isauth, getAdminSponsorshipRequests);
router.patch("/admin/panel/sponsorships/:id/decision", isauth, decideSponsorshipRequest);
router.get("/admin/panel/commission-config", isauth, getAdminCommissionConfig);
router.patch("/admin/panel/commission-config/global", isauth, setGlobalCommissionPercent);
router.patch("/admin/panel/commission-config/khan", isauth, setKhanCommissionPercent);
router.patch("/admin/panel/commission-config/seller/:sellerid", isauth, setSellerCommissionPercent);
router.get("/admin/panel/commission/khan-summary", isauth, getAdminKhanCommissionSummary);
router.get("/admin/panel/commission-payments", isauth, getAdminCommissionPayments);
router.patch("/admin/panel/commission-payments/:id/decision", isauth, decideCommissionPayment);
router.patch("/admin/panel/shops/:shopid/health", isauth, updateShopHealth);
router.patch("/admin/panel/shops/:shopid/freeze", isauth, toggleShopFreeze);
router.get("/admin/panel/shops", isauth, getAdminShops);
router.get("/admin/panel/subscriptions", isauth, getAdminSubscriptions);
router.patch("/admin/panel/subscriptions/:id/decision", isauth, decideSubscription);

router.get("/public/shop/:slug", optionalauth, getPublicShopProfile);
router.post("/public/shop/:slug/follow", optionalauth, toggleShopFollow);
router.post("/public/shop/:slug/rate", isauth, rateShop);
router.post("/public/shop/:slug/report", isauth, upload.any(), reportShop);

router.post("/chat/start", optionalauth, startSellerChat);
router.get("/chat/threads", optionalauth, getMyChatThreads);
router.get("/chat/threads/:threadid", optionalauth, getChatThread);
router.post("/chat/threads/:threadid/messages", optionalauth, upload.any(), sendChatMessage);
router.delete("/chat/threads/:threadid/messages/:messageid", optionalauth, deleteChatMessage);
router.patch("/chat/threads/:threadid/read", optionalauth, markChatThreadRead);
router.patch("/chat/threads/:threadid/block", optionalauth, toggleThreadBlock);
router.patch("/chat/threads/:threadid/pin", optionalauth, toggleThreadPin);
router.patch("/chat/threads/:threadid/mute", optionalauth, toggleThreadMute);
router.patch("/chat/threads/:threadid/archive", optionalauth, toggleThreadArchive);
router.get("/chat/search", optionalauth, searchChatMessages);
router.post("/chat/reports", optionalauth, upload.any(), createSellerReport);
router.get("/admin/panel/chat-reports", isauth, getAdminChatReports);
router.patch("/admin/panel/chat-reports/:reportid/decision", isauth, decideChatReport);
router.get("/admin/panel/chat/threads", isauth, getAdminChatThreads);
router.get("/admin/panel/chat/threads/:threadid", isauth, getAdminChatThreadById);
router.patch("/admin/panel/chat/threads/:threadid/messages/:messageid", isauth, adminEditChatMessage);
router.delete("/admin/panel/chat/threads/:threadid/messages/:messageid", isauth, adminDeleteChatMessage);
router.post("/admin/panel/chat/threads/:threadid/messages", isauth, adminSendMessageToThread);

module.exports = router;
