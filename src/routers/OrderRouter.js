const express = require("express");
const isauth = require("../middlewares/IsAuth");
const {
  placeorder,
  getmyorders,
  getmyorderbyid,
  getallordersadmin,
  updateorderstatus,
} = require("../controllers/OrderController");

const router = express.Router();

router.use(isauth);

router.post("/place", placeorder);
router.get("/my", getmyorders);
router.get("/my/:id", getmyorderbyid);
router.get("/admin/all", getallordersadmin);
router.patch("/admin/status/:id", updateorderstatus);

module.exports = router;

