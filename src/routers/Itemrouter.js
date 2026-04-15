const express = require("express");
const router = express.Router();

const upload = require("../middlewares/Multer");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const {
  createShareLink,
  registerShareOpen,
  getShareAnalytics,
  exportShareAnalyticsCsv,
} = require("../controllers/ProductShareController");

const {

  edititem,
  deleteitem,
  getallitems,
  getallcategories,
  createItem,
  getitemsbycategory,
  getnewinitems,
  getitem,
  searchitems,
  shopbycategory,
  getcategoryfilters,
  filtercategoryproduct,
  getDiscoveryBestSellers,
  getDiscoveryTopRated,
  getDiscoveryNewIn,
  getDiscoveryCms,
} = require("../controllers/Itemcontroller");



// =======================================================
// 🚀 CREATE ITEM (UPLOAD ANY FILE)
// =======================================================
router.post(
  "/create",
  upload.any(), // accept ANY file (image / video / anything)
  createItem
);



// =======================================================
// ✏️ EDIT ITEM
// =======================================================
router.put(
  "/edit/:id",
  upload.any(), // allow replacing media
  edititem
);



// =======================================================
// ❌ DELETE ITEM
// =======================================================
router.delete("/delete/:id", deleteitem);



// =======================================================
// 📦 GET ALL ITEMS
// =======================================================
router.get("/all", getallitems);
router.get("/search", searchitems);



// =======================================================
// 🌳 GET ALL CATEGORIES
// =======================================================

router.get("/getnewitems",getnewinitems)
router.get("/getitembyslug/:slug",getitem)

router.post("/share/:slug", optionalauth, createShareLink);
router.post("/share/open/:token", optionalauth, registerShareOpen);
router.get("/share/admin/analytics", isauth, getShareAnalytics);
router.get("/share/admin/analytics/export", isauth, exportShareAnalyticsCsv);



// filter item by category and query

router.get("/category/:slug", shopbycategory);

router.get("/category/filters/:slug", getcategoryfilters)
router.post("/category/filter/:slug", filtercategoryproduct);
router.get("/discovery/cms", getDiscoveryCms);
router.get("/discovery/best-sellers", getDiscoveryBestSellers);
router.get("/discovery/top-rated", getDiscoveryTopRated);
router.get("/discovery/new-in", getDiscoveryNewIn);
module.exports = router;
