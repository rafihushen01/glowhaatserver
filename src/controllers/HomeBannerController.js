const Homebanner = require("../models/Homebanner");
const uploadoncloudinary = require("../utils/Cloudinary");

const FRONTEND_URL = String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const normalizeSectionKey = (value) => {
  const normalized = String(value || "home").trim().toLowerCase();
  if (["home", "bestselling", "fivestar", "newin"].includes(normalized)) return normalized;
  return "home";
};

const normalizeStatus = (value, fallback = "inactive") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (["active", "inactive", "draft"].includes(normalized)) return normalized;
  return fallback;
};

const normalizeSort = (value) => {
  const normalized = String(value || "newest").trim().toLowerCase();
  if (normalized === "oldest") return { createdAt: 1 };
  if (normalized === "order") return { bannernumber: 1, createdAt: -1 };
  return { createdAt: -1 };
};

const inferMediaType = (file, existingUrl = "") => {
  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";

  const url = String(existingUrl || "").toLowerCase();
  if (url.includes(".mp4") || url.includes(".mov") || url.includes(".webm") || url.includes(".mkv")) {
    return "video";
  }

  return "image";
};

const getDefaultNavigationLink = (sectionkey) => {
  const base = FRONTEND_URL || "";
  if (!base) return "";

  if (sectionkey === "newin") return `${base}/new-in`;
  if (sectionkey === "bestselling") return `${base}/best-selling`;
  if (sectionkey === "fivestar") return `${base}/five-star`;
  return base;
};

const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value) => {
  const asDate = new Date(value);
  return Number.isFinite(asDate.getTime()) ? asDate : null;
};

exports.createhomebanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Banner file is required",
      });
    }

    const sectionkey = normalizeSectionKey(req.body?.sectionkey);
    const status = normalizeStatus(req.body?.status, "inactive");
    const imageurl = await uploadoncloudinary(req.file.path);

    const banner = await Homebanner.create({
      image: imageurl,
      mediatype: inferMediaType(req.file, imageurl),
      title: String(req.body?.title || "").trim(),
      sectionkey,
      navigationlink:
        String(req.body?.navigationlink || "").trim() || getDefaultNavigationLink(sectionkey),
      bannernumber: parseNumber(req.body?.bannernumber, 0),
      status,
    });

    return res.status(201).json({
      success: true,
      message: "Home banner created successfully",
      banner,
    });
  } catch (error) {
    console.error("createhomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create home banner",
    });
  }
};

exports.edithomebanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Homebanner.findById(id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    if (req.file) {
      const imageurl = await uploadoncloudinary(req.file.path);
      banner.image = imageurl;
      banner.mediatype = inferMediaType(req.file, imageurl);
    }

    if (typeof req.body?.title !== "undefined") banner.title = String(req.body.title || "").trim();
    if (typeof req.body?.sectionkey !== "undefined") {
      banner.sectionkey = normalizeSectionKey(req.body.sectionkey);
    }
    if (typeof req.body?.status !== "undefined") {
      banner.status = normalizeStatus(req.body.status, banner.status || "inactive");
    }
    if (typeof req.body?.bannernumber !== "undefined") {
      banner.bannernumber = parseNumber(req.body.bannernumber, banner.bannernumber || 0);
    }

    if (typeof req.body?.navigationlink !== "undefined") {
      banner.navigationlink =
        String(req.body.navigationlink || "").trim() || getDefaultNavigationLink(banner.sectionkey);
    }

    await banner.save();

    return res.status(200).json({
      success: true,
      message: "Home banner updated successfully",
      banner,
    });
  } catch (error) {
    console.error("edithomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update home banner",
    });
  }
};

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

    banner.status = "draft";
    await banner.save();

    return res.status(200).json({
      success: true,
      message: "Banner moved to draft",
      banner,
    });
  } catch (error) {
    console.error("deletehomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to move banner to draft",
    });
  }
};

exports.restorehomebanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Homebanner.findById(id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    banner.status = normalizeStatus(req.body?.status, "inactive");
    if (banner.status === "draft") banner.status = "inactive";
    await banner.save();

    return res.status(200).json({
      success: true,
      message: "Banner restored successfully",
      banner,
    });
  } catch (error) {
    console.error("restorehomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to restore banner",
    });
  }
};

exports.togglehomebannerstatus = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Homebanner.findById(id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    banner.status = banner.status === "active" ? "inactive" : "active";
    await banner.save();

    return res.status(200).json({
      success: true,
      message: `Banner ${banner.status}`,
      banner,
    });
  } catch (error) {
    console.error("togglehomebannerstatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to change banner status",
    });
  }
};

exports.permanentlyDeleteHomebanner = async (req, res) => {
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

    return res.status(200).json({
      success: true,
      message: "Banner permanently deleted",
    });
  } catch (error) {
    console.error("permanentlyDeleteHomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to permanently delete banner",
    });
  }
};

exports.gethomebanner = async (req, res) => {
  try {
    const requestedSection = String(req.query?.section || "home").trim().toLowerCase();
    const requestedStatus = String(req.query?.status || "").trim().toLowerCase();
    const scope = String(req.query?.scope || "public").trim().toLowerCase();
    const sort = normalizeSort(req.query?.sort);

    const query = {};

    if (requestedSection !== "all") {
      query.sectionkey = normalizeSectionKey(requestedSection);
    }

    if (scope === "admin") {
      if (["active", "inactive", "draft"].includes(requestedStatus)) {
        if (requestedStatus === "active") {
          query.$or = [{ status: "active" }, { status: { $exists: false } }];
        } else {
          query.status = requestedStatus;
        }
      }
    } else {
      query.$or = [{ status: "active" }, { status: { $exists: false } }];
    }

    const fromDate = parseDate(req.query?.from);
    const toDate = parseDate(req.query?.to);

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    const banners = await Homebanner.find(query).sort(sort);

    return res.status(200).json({
      success: true,
      count: banners.length,
      banners,
      defaults: {
        home: getDefaultNavigationLink("home"),
        bestselling: getDefaultNavigationLink("bestselling"),
        fivestar: getDefaultNavigationLink("fivestar"),
        newin: getDefaultNavigationLink("newin"),
      },
    });
  } catch (error) {
    console.error("gethomebanner error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch home banners",
    });
  }
};

exports.gethomebannerdownload = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Homebanner.findById(id).lean();

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        url: banner.image,
        filename: `khancosmetics-${banner.sectionkey || "banner"}-${banner._id}`,
      },
    });
  } catch (error) {
    console.error("gethomebannerdownload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to prepare banner download",
    });
  }
};
