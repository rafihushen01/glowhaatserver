const uploadoncloudinary = require("../utils/Cloudinary.js");
const Nav = require("../models/Nav.js");
const slugify=require("../utils/Slugify.js");
const CategorySlider = require("../models/CategorySlider.js");
const dotenv=require("dotenv");
dotenv.config();

const normalizeText = (value) => {
  return typeof value === "string" ? value.trim() : "";
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
      } catch (_err) {
        // fall through to single-value handling
      }
    }

    return [trimmed];
  }

  return [];
};

const parallelUpload = async (files, concurrency = 70) => {
  const results = [];
  let index = 0;

  const worker = async () => {
    while (index < files.length) {
      const currentIndex = index++;
      const file = files[currentIndex];

      try {
        const url = await uploadoncloudinary(file.path);
        const isVideo = file.mimetype.startsWith("video");

        results[currentIndex] = {
          url,
          type: isVideo ? "video" : "image",
        };
      } catch (err) {
        console.error("UPLOAD FAILED:", err.message);
        results[currentIndex] = null;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, worker);
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

      const imageUrl = img.image || img.url || null;
      if (!imageUrl) return null;

      return {
        image: imageUrl,
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
    const image = images.length ? images[0].image : null;

    path.unshift({
      _id: current._id,
      name: current.name,
      slug: current.slug,
      depth: current.depth,
      image,
      images,
    });

    if (!current.parentid) break;

    current = await Nav.findById(current.parentid)
      .select("_id name slug depth parentid images")
      .lean();
  }

  return path;
};



exports.createCategorySlider = async (req, res) => {
  try {
    const name = normalizeText(req.body?.name);
    const navrootid = normalizeText(req.body?.navrootid);
    const type = normalizeText(req.body?.type) || "slider";
    const order = Number(req.body?.order);
    const normalizedOrder = Number.isFinite(order) ? order : 0;
    const segments = normalizeSegments(req.body);

    // ---------- VALIDATION ----------
    if (!name || !navrootid) {
      return res.status(400).json({ success: false, message: "Name & Nav Root required" });
    }

    const navRootExists = await Nav.exists({ _id: navrootid });
    if (!navRootExists) {
      return res.status(400).json({
        success: false,
        message: "Invalid Nav Root selected",
      });
    }

    // ---------- UNIQUE SLUG ----------
    let slug = slugify(name);
    const slugExists = await CategorySlider.findOne({ slug });
    if (slugExists) slug = `${slug}-${Date.now()}`;

    // ---------- MEDIA UPLOAD ----------
    let media = [];
    if (req.files?.length) {
      media = await parallelUpload(req.files, 70);
    }

    // ---------- INITIALIZE CATEGORY ----------
    const category = new CategorySlider({
      name,
      slug,
      navlink: `${process.env.FRONTEND_URL}/s/${slug}`, // Next.js friendly route
      media,
      order: normalizedOrder,
      navrootid,
      type,
      isactive: false,
      segments: [], // initialize empty array
    });

    // ---------- ADD INITIAL SEGMENTS IF PROVIDED ----------
    if (segments.length) {
      for (const navid of segments) {
        // Prevent duplicate
        if (!category.segments.find(s => String(s.navrootid) === String(navid))) {
          const navpath = await getNavPath(navid); // Build full nav path automatically
          category.segments.push({ navrootid: navid, navpath });
        }
      }
    }

    await category.save();

    // ---------- RETURN FULL CATEGORY OBJECT ----------
    res.status(201).json({ success: true, data: category });

  } catch (error) {
    console.error("CREATE CATEGORY ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategorySlider.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    category.isdeleted = true;
    category.isactive = false;
    await category.save();

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("DELETE CATEGORY ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCategorySlider = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, order, type } = req.body;

    const category = await CategorySlider.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // ---------- FAST FIELD UPDATE ----------
    if (name && name !== category.name) {
      let newSlug = slugify(name);

      const slugExists = await CategorySlider.findOne({
        slug: newSlug,
        _id: { $ne: id },
      });

      if (slugExists) newSlug = `${newSlug}-${Date.now()}`;

      category.name = name;
      category.slug = newSlug;
      category.navlink = `/s/${newSlug}`;
    }

    if (typeof order !== "undefined") category.order = order;
    if (type) category.type = type;

    // ---------- PARALLEL MEDIA UPLOAD ----------
    if (req.files?.length) {
      const uploadedMedia = await parallelUpload(req.files, 70); // ⚡ FAST
      category.media.push(...uploadedMedia); // append, NOT overwrite
    }

    await category.save(); // single DB write

    res.status(200).json({
      success: true,
      message: "Category updated ⚡",
      data: category,
    });

  } catch (error) {
    console.error("UPDATE CATEGORY ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addMediaToCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategorySlider.findById(id);
    if (!category) return res.status(404).json({ success: false });

    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const uploadedMedia = await parallelUpload(req.files, 15); // ⚡ FAST SAFE

    category.media.push(...uploadedMedia);
    await category.save();

    res.json({ success: true, data: category });

  } catch (error) {
    console.error("ADD MEDIA ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategorySlider.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    category.isactive = !category.isactive;
    await category.save();

    res.status(200).json({
      success: true,
      message: `Category ${category.isactive ? "Activated" : "Deactivated"}`,
      data: category,
    });
  } catch (error) {
    console.error("TOGGLE STATUS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
exports.addSegmentToCategory = async (req, res) => {
  try {
    const { categoryid, navid } = req.body;

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Prevent duplicate
    const exists = category.segments.find(
      (s) => String(s.navrootid) === String(navid)
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Segment already exists",
      });
    }

    // 🔥 BUILD FULL NAV PATH AUTOMATIC
    const navpath = await getNavPath(navid);

    category.segments.push({
      navrootid: navid,
      navpath,
    });

    await category.save();

    res.json({
      success: true,
      message: "Segment added successfully 🚀",
      data: category,
    });

  } catch (err) {
    console.error("ADD SEGMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};



exports.getFullNavTree = async (req, res) => {
  try {
    const all = await Nav.find({
      isactive: true,
      isdeleted: false,
    })
      .sort({ depth: 1, order: 1, name: 1 })
      .lean();

    const map = new Map();
    const roots = [];

    // build map
    all.forEach(cat => {
      cat.children = [];
      map.set(String(cat._id), cat);
    });

    // build tree
    all.forEach(cat => {
      if (cat.parentid) {
        const parent = map.get(String(cat.parentid));
        if (parent) parent.children.push(cat);
      } else {
        roots.push(cat);
      }
    });

    res.json({
      success: true,
      data: roots,
    });

  } catch (err) {
    console.error("FULL NAV TREE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.removeSegmentFromCategory = async (req, res) => {
  try {
    const { categoryid, navid } = req.body;

    const category = await CategorySlider.findById(categoryid);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    category.segments = category.segments.filter(
      (s) => s.navid.toString() !== navid
    );

    await category.save();

    res.status(200).json({
      success: true,
      message: "Segment removed",
      data: category,
    });
  } catch (error) {
    console.error("REMOVE SEGMENT ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
exports.getActiveCategorySliders = async (req, res) => {
  try {
    const categories = await CategorySlider.find({
      isactive: true,
      isdeleted: false,
    })
      .populate("navrootid")
      .populate("segments.navpath")
      .sort({ order: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("GET ACTIVE CATEGORY ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
// exports.bulkAddSegments = async (req, res) => {






//   try {
//     const { categoryid, navids } = req.body; // navids = array of nav _id

//     if (!Array.isArray(navids) || !navids.length) {
//       return res.status(400).json({ success: false, message: "navids array required" });
//     }

//     const category = await CategorySlider.findById(categoryid);
//     if (!category) return res.status(404).json({ success: false, message: "Category not found" });

//     const newSegments = [];

//     for (const navid of navids) {
//       if (!category.segments.find(s => String(s.navrootid) === String(navid))) {
//         const navpath = await getNavPath(navid);
//         newSegments.push({ navrootid: navid, navpath });
//       }
//     }

//     if (!newSegments.length)
//       return res.status(400).json({ success: false, message: "All segments already exist" });

//     category.segments.push(...newSegments);
//     await category.save();

//     res.json({ success: true, message: "Bulk segments added ✅", data: category });
//   } catch (err) {
//     console.error("BULK ADD SEGMENTS ERROR:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };
exports.removeSegment = async (req, res) => {
  try {
    const { categoryid, navid } = req.body;
    const category = await CategorySlider.findById(categoryid);
    if (!category) return res.status(404).json({ success: false });

    category.segments = category.segments.filter(s => String(s.navrootid) !== String(navid));
    await category.save();

    res.json({ success: true, message: "Segment removed ✅", data: category });
  } catch (err) {
    console.error("REMOVE SEGMENT ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
// new buildaddsegment controller
exports.bulkAddSegments = async (req, res) => {
  try {
    // ---------- SAFE BODY PARSE (FRONTEND FRIENDLY) ----------
    let { categoryid, navids } = req.body;

    // Handle FormData / multipart cases (navids may come as string)
    if (typeof navids === "string") {
      navids = [navids];
    }

    // ---------- VALIDATION ----------
    if (!categoryid) {
      return res.status(400).json({
        success: false,
        message: "categoryid required",
      });
    }

    if (!Array.isArray(navids) || navids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "navids array required",
      });
    }

    // Remove empty / null / undefined values (PREVENT BACKEND REQUIRED ERROR)
    navids = navids.filter(id => id && id !== "" && id !== "null" && id !== "undefined");

    if (!navids.length) {
      return res.status(400).json({
        success: false,
        message: "No valid navids provided",
      });
    }

    // ---------- FIND CATEGORY ----------
    const category = await CategorySlider.findById(categoryid);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // ---------- BUILD NEW SEGMENTS ----------
    const newSegments = [];

    for (const navid of navids) {
      // Skip invalid ObjectId length (extra protection)
      if (String(navid).length < 10) continue;

      const alreadyExists = category.segments.find(
        s => String(s.navrootid) === String(navid)
      );

      if (!alreadyExists) {
        const navpath = await getNavPath(navid);

        // Skip if navpath failed (prevents navroot required error)
        if (!navpath || navpath.length === 0) continue;

        newSegments.push({
          navrootid: navid,
          navpath,
        });
      }
    }

    // ---------- NOTHING TO ADD ----------
    if (!newSegments.length) {
      return res.status(200).json({
        success: true,
        message: "No new segments added (already exists or invalid)",
        data: category,
      });
    }

    // ---------- PUSH + SAVE ----------
    category.segments.push(...newSegments);
    await category.save();

    // ---------- SUCCESS RESPONSE (FRONTEND FRIENDLY) ----------
    return res.json({
      success: true,
      message: "Segments added successfully ✅",
      addedCount: newSegments.length,
      totalSegments: category.segments.length,
      data: category,
    });

  } catch (err) {
    console.error("BULK ADD SEGMENTS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.reorderSegments = async (req, res) => {
  try {
    const { categoryid, orderedNavIds } = req.body;
    const category = await CategorySlider.findById(categoryid);
    if (!category) return res.status(404).json({ success: false });

    category.segments.sort((a, b) => {
      return orderedNavIds.indexOf(String(a.navrootid)) - orderedNavIds.indexOf(String(b.navrootid));
    });

    await category.save();

    res.json({ success: true, message: "Segments reordered ✅", data: category });
  } catch (err) {
    console.error("REORDER SEGMENTS ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
let cachedNavTree = null; // ⚡ simple in-memory cache

exports.buildNavTreeCache = async (forceRefresh = false) => {
  // Return cached version if exists & no force refresh
  if (cachedNavTree && !forceRefresh) return cachedNavTree;

  const all = await Nav.find({ isactive: true, isdeleted: false }).lean();

  const map = new Map();
  all.forEach(c => {
    c.children = [];
    map.set(String(c._id), c);
  });

  const roots = [];
  all.forEach(c => {
    if (c.parentid) {
      const parent = map.get(String(c.parentid));
      if (parent) parent.children.push(c);
    } else {
      roots.push(c);
    }
  });

  cachedNavTree = roots; // ⚡ store in memory

  console.log('✅ Nav Tree built in-memory');
  return roots;
};

// public category showup
// =============================================
// 🚀 PUBLIC CATEGORY + SEGMENT FULL DATA
// Enterprise Grade — No Redis Required
// =============================================
exports.getPublicCategoriesFull = async (req, res) => {
  try {
    let categories = await CategorySlider.find({
      isactive: true,
      isdeleted: false,
    })
      .sort({ order: 1 })
      .lean();

    // Fallback: if nothing active, return non-deleted categories so UI can still render.
    if (!categories.length) {
      categories = await CategorySlider.find({
        isdeleted: false,
      })
        .sort({ order: 1 })
        .lean();
    }

    if (!categories.length) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const navIds = new Set();

    categories.forEach((cat) => {
      if (cat.navrootid) navIds.add(String(cat.navrootid));

      cat.segments?.forEach((seg) => {
        if (seg.navrootid) navIds.add(String(seg.navrootid));
      });
    });

    const navNodes = await Nav.find({
      _id: { $in: [...navIds] },
      isactive: true,
      isdeleted: false,
    })
      .select("name slug link images depth parentid")
      .lean();

    const navMap = new Map();
    navNodes.forEach((n) => navMap.set(String(n._id), n));

    const finalData = categories.map((cat) => {
      const rootNav = navMap.get(String(cat.navrootid));

      const rootImage =
        rootNav?.images?.[0]?.image ||
        rootNav?.images?.[0]?.url ||
        cat.media?.[0]?.url ||
        null;

      const segments = (cat.segments || [])
        .map((seg) => {
          const nav = navMap.get(String(seg.navrootid));
          if (!nav) return null;

          const leafPathNode =
            Array.isArray(seg.navpath) && seg.navpath.length
              ? seg.navpath[seg.navpath.length - 1]
              : null;

          const segmentImage =
            nav.images?.[0]?.image ||
            nav.images?.[0]?.url ||
            leafPathNode?.image ||
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
            navpath: seg.navpath || [],
          };
        })
        .filter(Boolean);

      return {
        _id: cat._id,
        name: cat.name,
        slug: cat.slug?.replace(/-\d+$/, ""),
        navlink: cat.navlink || null,
        order: cat.order || 0,
        media: cat.media || [],
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
      };
    });

    return res.json({
      success: true,
      count: finalData.length,
      data: finalData,
    });
  } catch (err) {
    console.error("getPublicCategoriesFull Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch public categories",
    });
  }
};
exports.rebuildAllCategoryNavpaths = async (req, res) => {
  try {
    const categories = await CategorySlider.find();
    let updatedCategories = 0;
    let updatedSegments = 0;

    for (const cat of categories) {
      let catChanged = false;

      for (const segment of cat.segments) {
        const nextPath = await getNavPath(segment.navrootid);
        const prevPath = JSON.stringify(segment.navpath || []);
        const newPath = JSON.stringify(nextPath || []);

        if (prevPath !== newPath) {
          segment.navpath = nextPath;
          catChanged = true;
          updatedSegments += 1;
        }
      }

      if (catChanged) {
        cat.markModified("segments");
        await cat.save();
        updatedCategories += 1;
      }
    }

    res.json({
      success: true,
      message: "All navpaths rebuilt with images",
      updatedCategories,
      updatedSegments,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

