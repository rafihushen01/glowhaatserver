const express = require("express");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const {
  placeorder,
  getmyorders,
  getmyorderbyid,
  getallordersadmin,
  updateorderstatus,
} = require("../controllers/OrderController");

const router = express.Router();

router.use(optionalauth);

router.post("/place", placeorder);
router.get("/my", getmyorders);
router.get("/my/:id", getmyorderbyid);
router.use("/admin", isauth);
router.get("/admin/all", getallordersadmin);
router.patch("/admin/status/:id", updateorderstatus);

module.exports = router;
