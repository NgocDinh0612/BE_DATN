const express = require("express");
const router = express.Router();
const Command = require("../models/Command");
const LightStatus = require("../models/LightStatus");
const LightDevice = require("../models/LightDevice");
const { authenticate } = require("../middleware/auth");

/**
 * ==============================
 * Đăng ký thiết bị (ESP gọi)
 * ==============================
 */
router.post("/register", async (req, res) => {
  try {
    const { mac } = req.body;

    // Kiểm tra định dạng MAC
    if (!mac || !/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac)) {
      return res.status(400).json({ ok: false, message: "Invalid MAC address" });
    }

    const deviceId = mac.toUpperCase();
    let device = await LightDevice.findOne({ deviceId });

    if (!device) {
      // Tạo thiết bị mới
      device = await LightDevice.create({
        deviceId,
        name: `Device-${deviceId}`,
        gps: { lat: null, lon: null },
        location: "",
        user: null,
        isDeleted: false,
      });

      // Tạo trạng thái ban đầu
      await LightStatus.create({
        deviceId,
        relay: false,
        brightness: 50,
      });

      console.log(`[REGISTER] New device created: ${device.deviceId}`);
    } else {
      console.log(`[REGISTER] Device already exists: ${device.deviceId}`);
    }

    const response = { ok: true, deviceId, isAssigned: !!device.user };
    res.status(200).json(response);
    console.log(`[REGISTER] Response sent: ${JSON.stringify(response)}`);
  } catch (err) {
    console.error("[REGISTER] error:", err.message);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * Lấy danh sách thiết bị pending
 * ==============================
 */
router.get("/pending", authenticate, async (req, res) => {
  try {
    const devices = await LightDevice.find({ status: "pending" });
    res.json({ ok: true, devices });
  } catch (err) {
    console.error("[PENDING] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
  }
});

/**
 * ==============================
 * Duyệt thiết bị
 * ==============================
 */
router.post("/approve/:mac", authenticate, async (req, res) => {
  try {
    const { mac } = req.params;
    const device = await LightDevice.findOneAndUpdate(
      { deviceId: mac.toUpperCase() },
      { status: "active" },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json({ ok: true, message: `Approved device ${mac}`, device });
  } catch (error) {
    console.error("[APPROVE DEVICE] error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ==============================
 * User gán thiết bị vào tài khoản
 * ==============================
 */
// routes/device.js (chỉ phần POST "/" — assign device)
router.post("/", authenticate, async (req, res) => {
  try {
    const { name, location, mac, lat, lon } = req.body;

    if (!name || !mac) {
      return res.status(400).json({ ok: false, message: "Name and MAC required" });
    }

    // Chuẩn hoá MAC
    const deviceId = mac.toUpperCase();

    // Tìm device đã được ESP đăng ký trước (pending)
    const device = await LightDevice.findOne({ deviceId, isDeleted: { $ne: true } });
    if (!device) {
      return res.status(404).json({ ok: false, message: "Device not found. Please ensure the device has registered (ESP -> /devices/register) first." });
    }

    if (device.user) {
      return res.status(400).json({ ok: false, message: "Device already assigned" });
    }

    // Gán các thông tin do web gửi
    device.name = name;
    device.location = location || device.location || "";
    device.user = req.user.userId;

    // Nếu web gửi lat/lon hợp lệ thì lưu vào gps
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

    // trả về device đã cập nhật (frontend dùng để show trên UI ngay)
    res.json({ ok: true, device });
    console.log(`[ADD DEVICE] Assigned device ${device.deviceId} to user ${req.user.userId} (gps: ${JSON.stringify(device.gps)})`);
  } catch (err) {
    console.error("[ADD DEVICE] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi thêm thiết bị", error: err.message });
  }
});


/**
 * ==============================
 * Lấy danh sách thiết bị của user
 * ==============================
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
        relay: st.relay,
        brightness: st.brightness ?? 50,
      };
    });

    const response = { ok: true, devices: devicesWithStatus };
    res.json(response);
    console.log(`[GET DEVICES] Sent response: ${JSON.stringify(response)}`);
  } catch (err) {
    console.error("[GET DEVICES] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
  }
});

/**
 * ==============================
 * Gửi lệnh chung (toggle + brightness)
 * ==============================
 */
router.post("/:id/command", authenticate, async (req, res) => {
  try {
    const { command, brightness } = req.body;

    const device = await LightDevice.findOne({
      _id: req.params.id,
      user: req.user.userId,
      isDeleted: { $ne: true },
    });

    if (!device) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy thiết bị" });
    }

    // Toggle
    if (command === "toggle") {
      const currentStatus = await LightStatus.findOne({ deviceId: device.deviceId });
      const newRelayState = !(currentStatus?.relay || false);

      await Command.create({
        deviceId: device.deviceId,
        command: newRelayState ? "ON" : "OFF",
        params: {},
        status: "pending",
      });

      await LightStatus.findOneAndUpdate(
        { deviceId: device.deviceId },
        { $set: { relay: newRelayState } },
        { upsert: true }
      );
    }

    // Brightness
    if (typeof brightness === "number") {
      if (brightness < 0 || brightness > 100)
        return res.status(400).json({ ok: false, message: "Brightness phải từ 0 đến 100" });

      await Command.create({
        deviceId: device.deviceId,
        command: "BRIGHTNESS",
        params: { value: brightness },
        status: "pending",
      });

      await LightStatus.findOneAndUpdate(
        { deviceId: device.deviceId },
        { $set: { brightness } },
        { upsert: true }
      );
    }

    res.json({ ok: true, message: "Lệnh đã được gửi thành công" });
    console.log(`[COMMAND] Sent command for ${device.deviceId}: ${JSON.stringify(req.body)}`);
  } catch (err) {
    console.error("[COMMAND] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi xử lý lệnh chung" });
  }
});

/**
 * ==============================
 * ESP lấy lệnh tiếp theo
 * ==============================
 */
router.get("/:deviceId/next-command", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await LightDevice.findOne({ deviceId, isDeleted: { $ne: true } });
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    const cmd = await Command.findOneAndUpdate(
      { deviceId, status: "pending" },
      { $set: { status: "sent" } },
      { sort: { _id: 1 }, new: true }
    ).select("deviceId command params status");

    const response = { ok: true, command: cmd || null };
    res.json(response);
    console.log(`[NEXT COMMAND] Response for ${deviceId}: ${JSON.stringify(response)}`);
  } catch (err) {
    console.error("[NEXT COMMAND] error:", err.message);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * ESP báo cáo trạng thái
 * ==============================
 */
router.post("/report", async (req, res) => {
  try {
    const { mac, cmd, commandId, brightness } = req.body;
    const deviceId = mac.toUpperCase();

    await LightStatus.findOneAndUpdate(
      { deviceId },
      { $set: { relay: cmd === 1, brightness: brightness ?? 50, lastUpdated: new Date() } },
      { upsert: true }
    );

    if (commandId)
      await Command.findOneAndUpdate({ _id: commandId }, { $set: { status: "done" } });

    res.json({ ok: true });
    console.log(`[REPORT] Processed report for ${deviceId}, cmd=${cmd}, brightness=${brightness}`);
  } catch (err) {
    console.error("[REPORT] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi xử lý báo cáo" });
  }
});

module.exports = router;
