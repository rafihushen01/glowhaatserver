const uploadoncloudinary = require("../utils/Cloudinary.js");
const Nav = require("../models/Nav.js");
const slugify = require("../utils/Slugify.js");
const CategorySlider = require("../models/CategorySlider.js");

const FRONTEND_URL = String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const normalizeText = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

const parseDate = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const typeAliases = {
  slider: "slider",
  shopbycategory: "shopbeautyproductbycategory",
  shopbeautybycategory: "shopbeautyproductbycategory",
  shopbeautyproductbycategory: "shopbeautyproductbycategory",
  shopbeautybyconcern: "shopbeautyproductbyconcern",
  shopbeautyproductbyconcern: "shopbeautyproductbyconcern",
  campaign: "campaign",
  campaignbuilder: "campaign",
  deals: "deals",
  dealsbuilder: "deals",
  topbrands: "topbrands",
  topbrandoffers: "topbrands",
  extradiscount: "extradiscount",
  extradiscountoffer: "extradiscount",
};

const normalizeType = (value) => {
  const normalized = String(value || "slider").trim().toLowerCase();
  return typeAliases[normalized] || "slider";
};

const expandTypeMatches = (normalizedType) => {
  const all = new Set([normalizedType]);
  Object.entries(typeAliases).forEach(([rawType, canonical]) => {
    if (canonical === normalizedType) all.add(rawType);
  });
  return [...all];
};

const normalizeStatus = (value, fallback = "inactive") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (["active", "inactive", "draft"].includes(normalized)) return normalized;
  return fallback;
};

const syncLegacyFlags = (doc) => {
  const status = normalizeStatus(doc.status, "inactive");
  doc.status = status;
  doc.isactive = status === "active";
  doc.deactive = status !== "active";
  doc.isdeleted = status === "draft";
};

const normalizeSegments = (body = {}) => {
  const rawSegments = body.segments ?? body["segments[]"] ?? [];

  if (Array.isArray(rawSegments)) {
    return rawSegments.map((seg) => String(seg).trim()).filter(Boolean);
  }

  if (typeof rawSegments === "string") {
    const trimmed = rawSegments.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((seg) => String(seg).trim()).filter(Boolean);
        }
      } catch (_error) {
        // keep single string fallback
      }
    }

    return [trimmed];
  }

  return [];
};

const inferMediaType = (file, url = "") => {
  const mime = String(file?.mimetype || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";

  const normalizedUrl = String(url || "").toLowerCase();
  if (
    normalizedUrl.includes(".mp4") ||
    normalizedUrl.includes(".mov") ||
    normalizedUrl.includes(".mkv") ||
    normalizedUrl.includes(".webm")
  ) {
    return "video";
  }

  return "image";
};

const parallelUpload = async (files = [], concurrency = 20) => {
  if (!Array.isArray(files) || !files.length) return [];

  const results = new Array(files.length);
  let index = 0;

  const worker = async () => {
    while (index < files.length) {
      const current = index;
      index += 1;

      const file = files[current];
      try {
        const url = await uploadoncloudinary(file.path);
        results[current] = {
          url,
          type: inferMediaType(file, url),
          order: current,
        };
      } catch (error) {
        console.error("Category media upload failed:", error.message);
        results[current] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);

  return results.filter(Boolean);
};

const normalizeNavImages = (images) => {
  if (!Array.isArray(images)) return [];

  return images
    .map((img, idx) => {
      if (typeof img === "string") {
        return {
          image: img,
          link: "",
          title: "",
          order: idx,
        };
      }

      if (!img || typeof img !== "object") return null;
      const image = img.image || img.url || null;
      if (!image) return null;

      return {
        image,
        link: img.link || "",
        title: img.title || "",
        order: Number.isFinite(img.order) ? img.order : idx,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
};

const getNavPath = async (navid) => {
  const path = [];

  let current = await Nav.findById(navid)
    .select("_id name slug depth parentid images")
    .lean();

  while (current) {
    const images = normalizeNavImages(current.images);
    path.unshift({
      _id: current._id,
      name: current.name,
      slug: current.slug,
      depth: current.depth,
      image: images[0]?.image || null,
      images,
    });

    if (!current.parentid) break;

    current = await Nav.findById(current.parentid)
      .select("_id name slug depth parentid images")
      .lean();
  }

  return path;
};

const requiresNavRoot = (type) => {
  return ["slider", "shopbeautyproductbycategory", "shopbeautyproductbyconcern"].includes(type);
};

const buildDefaultLink = ({ type, slug }) => {
  if (!FRONTEND_URL) return "";

  if (type === "campaign") return `${FRONTEND_URL}/mega/mega-${slug || ""}`;
  if (type === "deals") return `${FRONTEND_URL}/deals/${slug || ""}`;
  if (type === "topbrands") return `${FRONTEND_URL}/top-brands/${slug || ""}`;
  if (type === "extradiscount") return `${FRONTEND_URL}/discounts/offer/${slug || ""}`;

  return `${FRONTEND_URL}/s/${slug || ""}`;
};

const ensureUniqueSlug = async (baseSlug, currentId = null) => {
  let nextSlug = baseSlug || `section-${Date.now()}`;
  let count = 1;

  while (true) {
    const query = { slug: nextSlug };
    if (currentId) query._id = { $ne: currentId };

    const exists = await CategorySlider.exists(query);
    if (!exists) return nextSlug;

    nextSlug = `${baseSlug}-${count}`;
    count += 1;
  }
};

exports.createCategorySlider = async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const navrootid = normalizeText(req.body?.navrootid);
    const type = normalizeType(req.body?.type);
    const status = normalizeStatus(req.body?.status, "inactive");
    const order = parseNumber(req.body?.order, 0);
    const segments = normalizeSegments(req.body);

    if (!name) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    if (requiresNavRoot(type) && !navrootid) {
      return res.status(400).json({ success: false, message: "Menu location is required for this type" });
    }

    if (navrootid) {
      const navExists = await Nav.exists({ _id: navrootid });
      if (!navExists) {
        return res.status(400).json({ success: false, message: "Invalid menu location" });
      }
    }

    const baseSlug = slugify(name) || `section-${Date.now()}`;
    const slug = await ensureUniqueSlug(baseSlug);

    let media = [];
    if (Array.isArray(req.files) && req.files.length) {
      media = await parallelUpload(req.files, 20);
    }

    const category = new CategorySlider({
      name,
      slug,
      navlink: normalizeText(req.body?.navlink) || buildDefaultLink({ type, slug }),
      media,
      order,
      navrootid: navrootid || null,
      type,
      status,
      segments: [],
    });

    syncLegacyFlags(category);

    if (segments.length) {
      for (const navid of segments) {
        if (!category.segments.find((segment) => String(segment.navrootid) === String(navid))) {
          const navpath = await getNavPath(navid);
          if (navpath.length) {
            category.segments.push({ navrootid: navid, navpath });
          }
        }
      }
    }

    await category.save();

    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error("createCategorySlider error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategorySlider.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const nextName = normalizeText(req.body?.name);
    const nextType = normalizeType(req.body?.type || category.type);
    const nextNavRootId = normalizeText(req.body?.navrootid);

    if (nextName) category.name = nextName;

    if (nextName) {
      const nextSlug = await ensureUniqueSlug(slugify(nextName) || category.slug, id);
      category.slug = nextSlug;
      if (typeof req.body?.navlink === "undefined") {
        category.navlink = buildDefaultLink({ type: nextType, slug: nextSlug });
      }
    }

    if (typeof req.body?.type !== "undefined") {
      category.type = nextType;
      if (typeof req.body?.navlink === "undefined") {
        category.navlink = buildDefaultLink({ type: nextType, slug: category.slug });
      }
    }

    if (typeof req.body?.navrootid !== "undefined") {
      if (!nextNavRootId) {
        category.navrootid = null;
      } else {
        const navExists = await Nav.exists({ _id: nextNavRootId });
        if (!navExists) {
          return res.status(400).json({ success: false, message: "Invalid menu location" });
        }
        category.navrootid = nextNavRootId;
      }
    }

    if (requiresNavRoot(category.type) && !category.navrootid) {
      return res.status(400).json({ success: false, message: "Menu location is required for this type" });
    }

    if (typeof req.body?.order !== "undefined") {
      category.order = parseNumber(req.body.order, category.order || 0);
    }

    if (typeof req.body?.status !== "undefined") {
      category.status = normalizeStatus(req.body.status, category.status || "inactive");
      syncLegacyFlags(category);
    }

    if (typeof req.body?.navlink !== "undefined") {
      category.navlink = normalizeText(req.body.navlink) || buildDefaultLink({ type: category.type, slug: category.slug });
    }

    if (Array.isArray(req.files) && req.files.length) {
      const uploaded = await parallelUpload(req.files, 20);
      const start = Array.isArray(category.media) ? category.media.length : 0;
      category.media = [...(category.media || []), ...uploaded.map((entry, idx) => ({ ...entry, order: start + idx }))];
    }

    await category.save();

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    console.error("updateCategorySlider error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.addMediaToCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategorySlider.findById(id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found" });

    if (!Array.isArray(req.files) || !req.files.length) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const uploaded = await parallelUpload(req.files, 20);
    const start = Array.isArray(category.media) ? category.media.length : 0;
    category.media = [...(category.media || []), ...uploaded.map((entry, idx) => ({ ...entry, order: start + idx }))];

    await category.save();

    return res.json({ success: true, data: category });
  } catch (error) {
    console.error("addMediaToCategory error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CategorySlider.findById(id);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.status = category.status === "active" ? "inactive" : "active";
    syncLegacyFlags(category);
    await category.save();

    return res.status(200).json({
      success: true,
      message: `Category ${category.status}`,
      data: category,
    });
  } catch (error) {
    console.error("toggleCategoryStatus error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CategorySlider.findById(id);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.status = "draft";
    syncLegacyFlags(category);
    await category.save();

    return res.status(200).json({
      success: true,
      message: "Category moved to draft",
      data: category,
    });
  } catch (error) {
    console.error("deleteCategorySlider error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.restoreCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CategorySlider.findById(id);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.status = normalizeStatus(req.body?.status, "inactive");
    if (category.status === "draft") category.status = "inactive";
    syncLegacyFlags(category);
    await category.save();

    return res.status(200).json({
      success: true,
      message: "Category restored successfully",
      data: category,
    });
  } catch (error) {
    console.error("restoreCategorySlider error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.permanentlyDeleteCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await CategorySlider.findById(id);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    await category.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Category permanently deleted",
    });
  } catch (error) {
    console.error("permanentlyDeleteCategorySlider error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.addSegmentToCategory = async (req, res) => {
  try {
    const { categoryid, navid } = req.body;

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const exists = category.segments.find((segment) => String(segment.navrootid) === String(navid));
    if (exists) {
      return res.status(400).json({ success: false, message: "Segment already exists" });
    }

    const navpath = await getNavPath(navid);
    if (!navpath.length) {
      return res.status(400).json({ success: false, message: "Invalid nav path" });
    }

    category.segments.push({ navrootid: navid, navpath });
    await category.save();

    return res.status(200).json({
      success: true,
      message: "Segment added",
      data: category,
    });
  } catch (error) {
    console.error("addSegmentToCategory error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkAddSegments = async (req, res) => {
  try {
    let { categoryid, navids } = req.body;

    if (typeof navids === "string") navids = [navids];
    if (!Array.isArray(navids)) navids = [];

    navids = navids.map((id) => String(id || "").trim()).filter(Boolean);

    if (!categoryid) {
      return res.status(400).json({ success: false, message: "categoryid required" });
    }

    if (!navids.length) {
      return res.status(400).json({ success: false, message: "navids array required" });
    }

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const newSegments = [];

    for (const navid of navids) {
      const exists = category.segments.find((segment) => String(segment.navrootid) === String(navid));
      if (exists) continue;

      const navpath = await getNavPath(navid);
      if (!navpath.length) continue;

      newSegments.push({ navrootid: navid, navpath });
    }

    if (!newSegments.length) {
      return res.status(200).json({
        success: true,
        message: "No new segments added",
        data: category,
      });
    }

    category.segments.push(...newSegments);
    await category.save();

    return res.status(200).json({
      success: true,
      message: "Segments added successfully",
      addedCount: newSegments.length,
      totalSegments: category.segments.length,
      data: category,
    });
  } catch (error) {
    console.error("bulkAddSegments error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.removeSegment = async (req, res) => {
  try {
    const { categoryid, navid } = req.body;

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.segments = category.segments.filter((segment) => String(segment.navrootid) !== String(navid));
    await category.save();

    return res.status(200).json({ success: true, message: "Segment removed", data: category });
  } catch (error) {
    console.error("removeSegment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.reorderSegments = async (req, res) => {
  try {
    const { categoryid, orderedNavIds } = req.body;

    if (!Array.isArray(orderedNavIds)) {
      return res.status(400).json({ success: false, message: "orderedNavIds array required" });
    }

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    category.segments.sort((a, b) => {
      return orderedNavIds.indexOf(String(a.navrootid)) - orderedNavIds.indexOf(String(b.navrootid));
    });

    await category.save();

    return res.status(200).json({ success: true, message: "Segments reordered", data: category });
  } catch (error) {
    console.error("reorderSegments error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFullNavTree = async (_req, res) => {
  try {
    const all = await Nav.find({
      isactive: true,
      isdeleted: false,
    })
      .sort({ depth: 1, order: 1, name: 1 })
      .lean();

    const map = new Map();
    const roots = [];

    all.forEach((node) => {
      node.children = [];
      map.set(String(node._id), node);
    });

    all.forEach((node) => {
      if (node.parentid) {
        const parent = map.get(String(node.parentid));
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return res.status(200).json({ success: true, data: roots });
  } catch (error) {
    console.error("getFullNavTree error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getActiveCategorySliders = async (_req, res) => {
  try {
    const categories = await CategorySlider.find({
      $or: [
        { status: "active", isdeleted: false },
        { status: { $exists: false }, isactive: true, isdeleted: false },
      ],
    })
      .populate("navrootid")
      .sort({ order: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: categories });
  } catch (error) {
    console.error("getActiveCategorySliders error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllCategorySliders = async (req, res) => {
  try {
    const status = String(req.query?.status || "all").trim().toLowerCase();
    const type = normalizeType(req.query?.type || "");
    const q = normalizeText(req.query?.q);
    const sortMode = String(req.query?.sort || "newest").trim().toLowerCase();

    const query = {};

    if (["active", "inactive", "draft"].includes(status)) {
      if (status === "active") {
        query.$or = [
          { status: "active", isdeleted: false },
          { status: { $exists: false }, isactive: true, isdeleted: false },
        ];
      } else if (status === "inactive") {
        query.$or = [
          { status: "inactive", isdeleted: false },
          { status: { $exists: false }, isactive: false, isdeleted: false },
        ];
      } else {
        query.$or = [{ status: "draft" }, { isdeleted: true }];
      }
    }

    if (req.query?.type) {
      query.type = { $in: expandTypeMatches(type) };
    }

    if (q) {
      query.name = { $regex: q, $options: "i" };
    }

    const fromDate = parseDate(req.query?.from);
    const toDate = parseDate(req.query?.to);
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    const sort = sortMode === "oldest" ? { createdAt: 1 } : { createdAt: -1 };

    const categories = await CategorySlider.find(query)
      .populate("navrootid")
      .sort(sort)
      .lean();

    return res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    console.error("getAllCategorySliders error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicCategoriesFull = async (req, res) => {
  try {
    const typesParam = normalizeText(req.query?.types || req.query?.type);
    const filterTypes = typesParam
      ? typesParam
          .split(",")
          .map((entry) => normalizeType(entry))
          .filter(Boolean)
      : [];

    const query = {
      $or: [
        { status: "active", isdeleted: false },
        { status: { $exists: false }, isactive: true, isdeleted: false },
      ],
    };

    if (filterTypes.length) {
      const expanded = new Set();
      filterTypes.forEach((type) => {
        expandTypeMatches(type).forEach((rawType) => expanded.add(rawType));
      });
      query.type = { $in: [...expanded] };
    }

    const categories = await CategorySlider.find(query)
      .sort({ order: 1, createdAt: -1 })
      .lean();

    if (!categories.length) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const navIds = new Set();
    categories.forEach((category) => {
      if (category.navrootid) navIds.add(String(category.navrootid));
      (category.segments || []).forEach((segment) => {
        if (segment.navrootid) navIds.add(String(segment.navrootid));
      });
    });

    const navNodes = navIds.size
      ? await Nav.find({
          _id: { $in: [...navIds] },
          isactive: true,
          isdeleted: false,
        })
          .select("name slug link images depth parentid")
          .lean()
      : [];

    const navMap = new Map();
    navNodes.forEach((node) => navMap.set(String(node._id), node));

    const finalData = categories.map((category) => {
      const rootNav = category.navrootid ? navMap.get(String(category.navrootid)) : null;
      const rootImage =
        rootNav?.images?.[0]?.image ||
        rootNav?.images?.[0]?.url ||
        category.media?.[0]?.url ||
        null;

      const segments = (category.segments || [])
        .map((segment) => {
          const nav = navMap.get(String(segment.navrootid));
          if (!nav) return null;

          const leaf = Array.isArray(segment.navpath) && segment.navpath.length
            ? segment.navpath[segment.navpath.length - 1]
            : null;

          const segmentImage =
            nav.images?.[0]?.image ||
            nav.images?.[0]?.url ||
            leaf?.image ||
            rootImage ||
            null;

          return {
            _id: nav._id,
            name: nav.name,
            slug: nav.slug?.replace(/-\d+$/, ""),
            navlink: nav.link || null,
            depth: nav.depth || 0,
            image: segmentImage,
            images: nav.images || [],
            navpath: segment.navpath || [],
          };
        })
        .filter(Boolean);

      return {
        _id: category._id,
        name: category.name,
        slug: category.slug?.replace(/-\d+$/, ""),
        type: normalizeType(category.type),
        status: normalizeStatus(category.status, "inactive"),
        navlink: category.navlink || null,
        order: category.order || 0,
        media: category.media || [],
        navroot: rootNav
          ? {
              _id: rootNav._id,
              name: rootNav.name,
              slug: rootNav.slug?.replace(/-\d+$/, ""),
              navlink: rootNav.link || null,
              image: rootImage,
            }
          : null,
        segments,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      count: finalData.length,
      data: finalData,
    });
  } catch (error) {
    console.error("getPublicCategoriesFull error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch public categories",
    });
  }
};

exports.rebuildAllCategoryNavpaths = async (_req, res) => {
  try {
    const categories = await CategorySlider.find();
    let updatedCategories = 0;
    let updatedSegments = 0;

    for (const category of categories) {
      let changed = false;

      for (const segment of category.segments) {
        const nextPath = await getNavPath(segment.navrootid);
        const prev = JSON.stringify(segment.navpath || []);
        const next = JSON.stringify(nextPath || []);

        if (prev !== next) {
          segment.navpath = nextPath;
          changed = true;
          updatedSegments += 1;
        }
      }

      if (changed) {
        category.markModified("segments");
        await category.save();
        updatedCategories += 1;
      }
    }

    return res.status(200).json({
      success: true,
      message: "All nav paths rebuilt",
      updatedCategories,
      updatedSegments,
    });
  } catch (error) {
    console.error("rebuildAllCategoryNavpaths error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
