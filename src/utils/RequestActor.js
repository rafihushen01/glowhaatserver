const sanitizeGuestId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
};

const generateGuestId = () => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `khc_guest_${timePart}_${randomPart}`;
};

const getRequestPayloadGuestId = (req) => {
  const bodyValue = req.body?.guestid || req.body?.guestId || "";
  const queryValue = req.query?.guestid || req.query?.guestId || "";
  return sanitizeGuestId(bodyValue || queryValue);
};

const getGuestIdFromRequest = (req) => {
  const headerValue =
    req.headers?.["x-guest-id"] ||
    req.headers?.["x-guestid"] ||
    req.headers?.["guest-id"] ||
    req.headers?.["guestid"] ||
    "";

  const cookieValue = req.cookies?.guestid || "";
  const payloadValue = getRequestPayloadGuestId(req);
  return sanitizeGuestId(headerValue || cookieValue || payloadValue);
};

const getRequestActor = (req, res) => {
  const userid = req.user?.userId ? String(req.user.userId) : "";
  let guestid = getGuestIdFromRequest(req);

  if (!userid && !guestid) {
    guestid = generateGuestId();
    if (res?.cookie) {
      const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").toLowerCase();
      const isSecureRequest = req.secure || forwardedProto === "https";
      res.cookie("guestid", guestid, {
        httpOnly: false,
        sameSite: isSecureRequest ? "none" : "lax",
        secure: Boolean(isSecureRequest),
        maxAge: 1000 * 60 * 60 * 24 * 365,
      });
    }
  }

  if (userid) {
    const ownerid = `user:${userid}`;
    const legacyOwnerFilters = [{ ownerid }, { userid }];

    if (guestid) {
      legacyOwnerFilters.push({ guestid }, { ownerid: `guest:${guestid}` });
    }

    return {
      isauthenticated: true,
      isguest: false,
      userid,
      guestid,
      ownerid,
      ownerfilter: { $or: legacyOwnerFilters },
      adminfilter: { ownerid },
    };
  }

  if (guestid) {
    const ownerid = `guest:${guestid}`;
    return {
      isauthenticated: false,
      isguest: true,
      userid: "",
      guestid,
      ownerid,
      ownerfilter: { $or: [{ ownerid }, { guestid }] },
      adminfilter: { ownerid },
    };
  }

  return {
    isauthenticated: false,
    isguest: false,
    userid: "",
    guestid: "",
    ownerid: "",
    ownerfilter: null,
    adminfilter: null,
  };
};

const requireActor = (req, res) => {
  const actor = getRequestActor(req, res);
  if (!actor.ownerid || !actor.ownerfilter) {
    res.status(400).json({
      success: false,
      message: "Guest session missing. Please refresh and try again.",
    });
    return null;
  }
  return actor;
};

module.exports = {
  getRequestActor,
  requireActor,
};
