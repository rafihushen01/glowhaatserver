const express = require("express");
const router = express.Router();
const navcontroller = require("../controllers/Navcontroller.js");
const upload = require("../middlewares/Multer.js");
const isauth = require("../middlewares/IsAuth.js");
const requireSuperAdmin = require("../middlewares/RequireSuperAdmin.js");



router.post("/createnav", upload.array("images",100), navcontroller.createnav);
router.put("/editnav/:id", upload.array("images",100), navcontroller.editnav);
router.delete("/deletenav/:id", navcontroller.deletenav);

router.post("/uploadlogo", isauth, requireSuperAdmin, upload.any(), navcontroller.uploadlogo);
router.put("/editlogo", isauth, requireSuperAdmin, upload.any(), navcontroller.editlogo);

router.post("/logos/upload", isauth, requireSuperAdmin, upload.array("logos", 300), navcontroller.uploadlogosbulk);
router.get("/logos/admin", isauth, requireSuperAdmin, navcontroller.getAdminLogos);
router.patch("/logos/:id/activate", isauth, requireSuperAdmin, navcontroller.activateLogo);
router.patch("/logos/:id/deactivate", isauth, requireSuperAdmin, navcontroller.deactivateLogo);
router.delete("/logos/:id", isauth, requireSuperAdmin, navcontroller.deleteLogoDraft);
router.get("/logo/active", navcontroller.getActiveLogo);

router.get("/nav", navcontroller.getnav);
router.get("/getcategorybydepth", navcontroller.getCategoryByDepth);


module.exports = router;
