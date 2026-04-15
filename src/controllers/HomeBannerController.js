const Homebanner = require("../models/Homebanner");
const uploadoncloudinary = require("../utils/Cloudinary");

const normalizeSectionKey = (value) => {
  const normalized = String(value || "home").trim().toLowerCase();
  if (["home", "bestselling", "fivestar"].includes(normalized)) return normalized;
  return "home";
};

// ==============================
// CREATE HOMEBANNER (ADMIN)
// ==============================
exports.createhomebanner = async (req, res) => {
  try {
    const { navigationlink, bannernumber } = req.body;
    const sectionkey = normalizeSectionKey(req.body?.sectionkey);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Banner image is required",
      });
    }

    // upload to cloudinary
    const imageurl = await uploadoncloudinary(req.file.path);

    const banner = await Homebanner.create({
      image: imageurl,
      navigationlink,
      bannernumber,
      sectionkey,
    });

    res.status(201).json({
      success: true,
      message: "Homebanner created successfully",
      banner,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to create homebanner",
    });
  }
};



// ==============================
// EDIT HOMEBANNER (ADMIN)
// ==============================
exports.edithomebanner = async (req, res) => {
  try {
    const { id } = req.params;
    const { navigationlink, bannernumber } = req.body;
    const sectionkey = normalizeSectionKey(req.body?.sectionkey || "home");

    const banner = await Homebanner.findById(id);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    // if new image uploaded
    if (req.file) {
      const imageurl = await uploadoncloudinary(req.file.path);
      banner.image = imageurl;
    }

    if (navigationlink !== undefined) banner.navigationlink = navigationlink;
    if (bannernumber !== undefined) banner.bannernumber = bannernumber;
    if (sectionkey) banner.sectionkey = sectionkey;

    await banner.save();

    res.status(200).json({
      success: true,
      message: "Homebanner updated successfully",
      banner,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to update homebanner",
    });
  }
};




// ==============================
// DELETE HOMEBANNER (ADMIN)
// ==============================
exports.deletehomebanner = async (req, res) => {
  try {
    const { id } = req.params;

    const banner = await Homebanner.findById(id);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    await banner.deleteOne();

    res.status(200).json({
      success: true,
      message: "Homebanner deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to delete homebanner",
    });
  }
};




// ==============================
// GET ALL HOMEBANNERS (PUBLIC / USER)
// ==============================
exports.gethomebanner = async (req, res) => {
  try {
    const requested = String(req.query?.section || "home").trim().toLowerCase();
    const query = requested === "all" ? {} : { sectionkey: normalizeSectionKey(requested) };
    const banners = await Homebanner.find(query).sort({ sectionkey: 1, bannernumber: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: banners.length,
      banners,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch homebanners",
    });
  }
};
