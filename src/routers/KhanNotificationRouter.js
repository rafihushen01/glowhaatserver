const express = require("express");
const isauth = require("../middlewares/IsAuth");
const {
  getMyKhanNotifications,
  markMyKhanNotificationRead,
  markAllMyKhanNotificationsRead,
  sendSuperAdminNotice,
  searchSuperAdminRecipients,
} = require("../controllers/KhanNotificationController");

const router = express.Router();

router.use(isauth);
router.get("/my", getMyKhanNotifications);
router.patch("/my/read-all", markAllMyKhanNotificationsRead);
router.patch("/my/:id/read", markMyKhanNotificationRead);
router.get("/admin/recipients", searchSuperAdminRecipients);
router.post("/admin/send", sendSuperAdminNotice);

module.exports = router;
