// src/routes/device.js
const express = require("express");
const router = express.Router();
const Command = require("../models/Command");
const LightStatus = require("../models/LightStatus");
const LightDevice = require("../models/LightDevice");
const { authenticate } = require("../middleware/auth");

/**
 * Helper: normalize MAC/deviceId
 */
function normalizeMac(mac) {
  if (!mac || typeof mac !== "string") return null;
  return mac.trim().toUpperCase();
}

/**
 * ==============================
 * 1) Đăng ký thiết bị (ESP gọi)
 *    POST /api/devices/register
 *    Body: { mac: "AA:BB:CC:..." }
 *    Trả về: { ok: true, deviceId }
 *    -> Không gửi location/gps gì về cho ESP.
 */
router.post("/register", async (req, res) => {
  try {
    const rawMac = req.body.mac;
    const deviceId = normalizeMac(rawMac);
    if (!deviceId || !/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(deviceId)) {
      return res.status(400).json({ ok: false, message: "Invalid MAC address" });
    }

    let device = await LightDevice.findOne({ deviceId });
    if (!device) {
      device = await LightDevice.create({
        deviceId,
        name: `Device-${deviceId}`,
        gps: { lat: null, lon: null },
        location: "",
        user: null,
        isDeleted: false,
      });

      await LightStatus.create({
        deviceId,
        relay: false,
        brightness: 50,
      });

      console.log(`[REGISTER] New device created: ${deviceId}`);
    } else {
      console.log(`[REGISTER] Device exists: ${deviceId}`);
    }

    return res.json({ ok: true, deviceId, isAssigned: !!device.user });
  } catch (err) {
    console.error("[REGISTER] error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * 2) Danh sách thiết bị pending để web chọn gán
 *    GET /api/devices/pending
 *    AUTH required
 */
router.get("/pending", authenticate, async (req, res) => {
  try {
    // Thiết bị chưa có user (chưa gán)
    const devices = await LightDevice.find({ user: null, isDeleted: { $ne: true } }).select(
      "_id deviceId name location gps"
    );
    return res.json({ ok: true, devices });
  } catch (err) {
    console.error("[PENDING] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
  }
});

/**
 * ==============================
 * 3) Approve device (tuỳ bạn có cần GUI admin)
 *    POST /api/devices/approve/:mac
 *    AUTH required
 */
router.post("/approve/:mac", authenticate, async (req, res) => {
  try {
    const mac = normalizeMac(req.params.mac);
    if (!mac) return res.status(400).json({ ok: false, message: "Invalid MAC" });

    const device = await LightDevice.findOneAndUpdate(
      { deviceId: mac },
      { $set: { status: "active" } },
      { new: true }
    );
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    return res.json({ ok: true, device });
  } catch (err) {
    console.error("[APPROVE] error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * 4) Gán thiết bị vào user (web)
 *    POST /api/devices
 *    Body: { name, location, mac, lat?, lon? }
 *    AUTH required
 */
router.post("/", authenticate, async (req, res) => {
  try {
    const { name, location, mac, lat, lon } = req.body;
    if (!name || !mac) return res.status(400).json({ ok: false, message: "Name and MAC required" });

    const deviceId = normalizeMac(mac);
    const device = await LightDevice.findOne({ deviceId, isDeleted: { $ne: true } });
    if (!device) return res.status(404).json({ ok: false, message: "Device not found. Make sure ESP called /register first." });
    if (device.user) return res.status(400).json({ ok: false, message: "Device already assigned" });

    device.name = name;
    device.location = location || device.location || "";
    device.user = req.user.userId;

    // Lưu gps nếu được gửi (web nhập tay)
    if (lat !== undefined && lat !== null && lat !== "") {
      const latNum = parseFloat(lat);
      if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
        return res.status(400).json({ ok: false, message: "lat không hợp lệ" });
      }
      device.gps = device.gps || {};
      device.gps.lat = latNum;
    }
    if (lon !== undefined && lon !== null && lon !== "") {
      const lonNum = parseFloat(lon);
      if (Number.isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
        return res.status(400).json({ ok: false, message: "lon không hợp lệ" });
      }
      device.gps = device.gps || {};
      device.gps.lon = lonNum;
    }

    await device.save();
    console.log(`[ADD DEVICE] Assigned device ${device.deviceId} to user ${req.user.userId} (gps: ${JSON.stringify(device.gps)})`);
    return res.json({ ok: true, device });
  } catch (err) {
    console.error("[ADD DEVICE] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi thêm thiết bị", error: err.message });
  }
});

/**
 * ==============================
 * 5) Lấy danh sách thiết bị của user (frontend)
 *    GET /api/devices
 *    AUTH required
 *    -> TRẢ VỀ CÁC TRƯỜNG _id, deviceId, name, location, gps, relay, brightness
 */
router.get("/", authenticate, async (req, res) => {
  try {
    const devices = await LightDevice.find({ user: req.user.userId, isDeleted: { $ne: true } });
    const statuses = await LightStatus.find({ deviceId: { $in: devices.map(d => d.deviceId) } });

    const devicesWithStatus = devices.map(d => {
      const st = statuses.find(s => s.deviceId === d.deviceId) || { relay: false, brightness: 50 };
      return {
        _id: d._id,
        deviceId: d.deviceId,
        name: d.name,
        location: d.location || "",
        gps: d.gps || { lat: null, lon: null },
        relay: !!st.relay,
        brightness: st.brightness ?? 50,
      };
    });

    const response = { ok: true, devices: devicesWithStatus };
    console.log(`[GET DEVICES] Sent response: ${JSON.stringify(response)}`);
    return res.json(response);
  } catch (err) {
    console.error("[GET DEVICES] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
  }
});

/**
 * ==============================
 * 6) Gửi lệnh chung từ web (toggle + brightness)
 *    POST /api/devices/:id/command
 *    Body có thể là { command: "toggle" } hoặc { brightness: 80 } hoặc cả hai
 *    AUTH required
 */
router.post("/:id/command", authenticate, async (req, res) => {
  try {
    // frontend truyền _id (document id) của LightDevice
    const deviceDoc = await LightDevice.findOne({ _id: req.params.id, user: req.user.userId, isDeleted: { $ne: true } });
    if (!deviceDoc) return res.status(404).json({ ok: false, message: "Không tìm thấy thiết bị" });

    const { command, brightness } = req.body;

    // toggle logic (nếu gửi command === "toggle")
    if (command === "toggle") {
      const currentStatus = await LightStatus.findOne({ deviceId: deviceDoc.deviceId });
      const newRelayState = !(currentStatus?.relay || false);

      await Command.create({
        deviceId: deviceDoc.deviceId,
        command: newRelayState ? "ON" : "OFF",
        params: {},
        status: "pending",
      });

      await LightStatus.findOneAndUpdate({ deviceId: deviceDoc.deviceId }, { $set: { relay: newRelayState } }, { upsert: true });
    }

    // brightness logic (nếu có)
    if (typeof brightness === "number") {
      if (brightness < 0 || brightness > 100) return res.status(400).json({ ok: false, message: "Brightness phải từ 0 đến 100" });

      await Command.create({
        deviceId: deviceDoc.deviceId,
        command: "BRIGHTNESS",
        params: { value: brightness },
        status: "pending",
      });

      await LightStatus.findOneAndUpdate({ deviceId: deviceDoc.deviceId }, { $set: { brightness } }, { upsert: true });
    }

    console.log(`[COMMAND] Sent command for ${deviceDoc.deviceId}: ${JSON.stringify(req.body)}`);
    return res.json({ ok: true, message: "Lệnh đã được gửi thành công" });
  } catch (err) {
    console.error("[COMMAND] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi xử lý lệnh chung" });
  }
});

/**
 * ==============================
 * 7) ESP lấy lệnh tiếp theo (ESP gọi)
 *    GET /api/devices/:deviceId/next-command
 *    -> Trả command (kèm _id của command để ESP trả lại commandId trong /report)
 *    -> CHÚ Ý: Không gửi location/gps trong response này.
 */
router.get("/:deviceId/next-command", async (req, res) => {
  try {
    const deviceId = normalizeMac(req.params.deviceId);
    if (!deviceId) return res.status(400).json({ ok: false, message: "Invalid deviceId" });

    const device = await LightDevice.findOne({ deviceId, isDeleted: { $ne: true } });
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    // Lấy command pending đầu tiên, đánh dấu sent
    const cmd = await Command.findOneAndUpdate(
      { deviceId, status: "pending" },
      { $set: { status: "sent" } },
      { sort: { _id: 1 }, new: true }
    ).select("_id deviceId command params status createdAt");

    // TRẢ về command (nếu có) — KHÔNG gửi location/gps
    return res.json({ ok: true, command: cmd || null });
  } catch (err) {
    console.error("[NEXT COMMAND] error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * 8) ESP báo cáo trạng thái
 *    POST /api/devices/report
 *    Body: { mac, cmd, commandId?, brightness? }
 *    -> Cập nhật LightStatus, và nếu có commandId thì set command status = done
 */
router.post("/report", async (req, res) => {
  try {
    const { mac, cmd, commandId, brightness } = req.body;
    const deviceId = normalizeMac(mac);
    if (!deviceId) return res.status(400).json({ ok: false, message: "Invalid MAC" });

    await LightStatus.findOneAndUpdate(
      { deviceId },
      { $set: { relay: cmd === 1 || cmd === "1" || cmd === true, brightness: brightness ?? 50, lastUpdated: new Date() } },
      { upsert: true }
    );

    if (commandId) {
      try {
        await Command.findOneAndUpdate({ _id: commandId }, { $set: { status: "done" } });
      } catch (e) {
        // nếu không tìm thấy commandId vẫn tiếp tục
        console.warn("[REPORT] commandId update failed:", e.message);
      }
    }

    console.log(`[REPORT] Processed report for ${deviceId}, cmd=${cmd}, brightness=${brightness}, commandId=${commandId}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[REPORT] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi xử lý báo cáo" });
  }
});

router.get("/geography", async (req, res) => {
  try {
    const devices = await LightDevice.find({ isDeleted: { $ne: true } })
      .select("deviceId name gps location");

    return res.json({
      ok: true,
      count: devices.length,
      geography: devices.map(d => ({
        id: d.deviceId,
        name: d.name,
        lat: d.gps?.lat ?? null,
        lon: d.gps?.lon ?? null,
        location: d.location ?? ""
      }))
    });
  } catch (err) {
    console.error("[GEOGRAPHY] error:", err);
    return res.status(500).json({ ok: false, message: "Lỗi khi lấy dữ liệu địa lý" });
  }
});
module.exports = router;
