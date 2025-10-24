// const express = require("express");
// const router = express.Router();
// const Command = require("../models/Command");
// const LightStatus = require("../models/LightStatus");
// const LightDevice = require("../models/LightDevice");
// const { authenticate } = require("../middleware/auth");

// /**
//  * Đăng ký thiết bị (từ ESP gửi lên)
//  */
// router.post("/register", async (req, res) => {
//   try {
//     const { mac, lat, lon } = req.body;
//     if (!mac || !/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac)) {
//       return res.status(400).json({ ok: false, message: "Invalid MAC address" });
//     }

//     const normalizedMac = mac.toUpperCase();
//     let device = await LightDevice.findOne({ deviceId: normalizedMac });

//     if (!device) {
//       device = await LightDevice.create({
//         deviceId: normalizedMac,
//         name: `Device-${normalizedMac}`,
//         gps: { lat: lat || null, lon: lon || null },
//         location: "",
//         user: null,
//         isDeleted: false,
//       });

//       await LightStatus.create({
//         deviceId: device.deviceId,
//         relay: false,
//         desired: false,
//         brightness: 50,
//       });

//       console.log(`[REGISTER] New device created: ${device.deviceId}`);
//     } else {
//       // Cập nhật GPS mỗi lần thiết bị báo về
//       if (lat && lon) {
//         device.gps = { lat, lon };
//         await device.save();
//         console.log(`[REGISTER] Updated GPS for device: ${device.deviceId}`);
//       }
//     }

//     const response = {
//       ok: true,
//       deviceId: device.deviceId,
//       isAssigned: device.user !== null,
//     };

//     res.status(200).json(response);
//     console.log(`[REGISTER] Response sent: ${JSON.stringify(response)}`);
//   } catch (err) {
//     console.error("[REGISTER] error:", err.message);
//     res.status(500).json({ ok: false, message: "Server error" });
//   }
// });

// /**
//  * Lấy danh sách thiết bị chưa gán user
//  */
// router.get("/pending", authenticate, async (req, res) => {
//   try {
//     const devices = await LightDevice.find({ user: null, isDeleted: { $ne: true } });
//     const response = { ok: true, devices };
//     console.log("[PENDING] Response:", response);
//     return res.json(response);
//   } catch (err) {
//     console.error("[PENDING] error:", err.message);
//     return res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
//   }
// });

// /**
//  * User gán thiết bị vào tài khoản
//  */
// router.post("/", authenticate, async (req, res) => {
//   try {
//     const { name, location, mac } = req.body;
//     if (!name || !mac) {
//       return res.status(400).json({ ok: false, message: "Name and MAC required" });
//     }

//     const normalizedMac = mac.toUpperCase();
//     if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(normalizedMac)) {
//       return res.status(400).json({ ok: false, message: "Invalid MAC format" });
//     }

//     let device = await LightDevice.findOne({ deviceId: normalizedMac, isDeleted: { $ne: true } });
//     if (!device) {
//       return res.status(404).json({ ok: false, message: "Device not found" });
//     }

//     if (device.user) {
//       return res.status(400).json({ ok: false, message: "Device already assigned" });
//     }

//     // Fix: gán user khi thêm thiết bị
//     device.name = name;
//     device.location = location;
//     device.user = req.user.userId;
//     await device.save();

//     res.json({ ok: true, device });
//     console.log(`[ADD DEVICE] Assigned device ${device.deviceId} to user ${req.user.userId}`);
//   } catch (err) {
//     console.error("[ADD DEVICE] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi thêm thiết bị" });
//   }
// });

// /**
//  * Xóa thiết bị
//  */
// router.delete("/:id", authenticate, async (req, res) => {
//   try {
//     const device = await LightDevice.findOne({ _id: req.params.id, user: req.user.userId });
//     if (!device) {
//       return res.status(404).json({ ok: false, message: "Device not found" });
//     }

//     await LightStatus.deleteOne({ deviceId: device.deviceId });
//     await Command.deleteMany({ deviceId: device.deviceId });
//     await LightDevice.deleteOne({ _id: req.params.id });

//     if (req.io) {
//       req.io.emit("device_deleted", { deviceId: device.deviceId });
//       console.log(`[DELETE DEVICE] Emitted device_deleted for ${device.deviceId}`);
//     }

//     res.json({ ok: true, message: "Device deleted permanently" });
//   } catch (err) {
//     console.error("[DELETE DEVICE] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi xóa thiết bị" });
//   }
// });

// /**
//  * Lấy danh sách thiết bị thuộc user
//  */
// router.get("/", authenticate, async (req, res) => {
//   try {
//     const devices = await LightDevice.find({ user: req.user.userId, isDeleted: { $ne: true } });
//     const lightStatuses = await LightStatus.find({ deviceId: { $in: devices.map((d) => d.deviceId) } });

//     const devicesWithStatus = devices.map((device) => {
//       const status = lightStatuses.find((s) => s.deviceId === device.deviceId) || {
//         relay: false,
//         brightness: 50,
//       };
//       return {
//         _id: device._id,
//         deviceId: device.deviceId,
//         name: device.name,
//         location: device.location || "",
//         relay: status.relay,
//         brightness: status.brightness || 50,
//       };
//     });

//     const response = { ok: true, devices: devicesWithStatus };
//     res.json(response);
//     console.log(`[GET DEVICES] Sent response: ${JSON.stringify(response)}`);
//   } catch (err) {
//     console.error("[GET DEVICES] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
//   }
// });

// /**
//  * Tạo lệnh bật/tắt
//  */
// router.post("/:id/toggle", authenticate, async (req, res) => {
//   try {
//     const { action } = req.body;

//     const device = await LightDevice.findOne({
//       _id: req.params.id,
//       user: req.user.userId,
//       isDeleted: { $ne: true },
//     });

//     if (!device) {
//       console.warn(`[TOGGLE] Device not found for user ${req.user.userId}, id=${req.params.id}`);
//       return res.status(404).json({ ok: false, message: "Not found" });
//     }

//     const cmd = await Command.create({
//       deviceId: device.deviceId,
//       command: action,
//       params: {},
//       status: "pending",
//     });

//     const response = { ok: true, command: cmd };
//     res.json(response);
//     console.log(`[TOGGLE] Created command for device ${device.deviceId}: ${JSON.stringify(response)}`);
//   } catch (err) {
//     console.error("[TOGGLE] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi tạo lệnh" });
//   }
// });

// router.post("/:id/brightness", authenticate, async (req, res) => {
//   try {
//     const { brightness } = req.body;

//     if (typeof brightness !== "number" || brightness < 0 || brightness > 100) {
//       return res.status(400).json({ ok: false, message: "Brightness phải là số từ 0-100" });
//     }

//     const device = await LightDevice.findOne({
//       _id: req.params.id,
//       user: req.user.userId,
//       isDeleted: { $ne: true },
//     });

//     if (!device) {
//       return res.status(404).json({ ok: false, message: "Device not found" });
//     }

//     // Tạo lệnh brightness
//     const cmd = await Command.create({
//       deviceId: device.deviceId,
//       command: "BRIGHTNESS",
//       params: { value: brightness },
//       status: "pending",
//     });

//     res.json({ ok: true, command: cmd });
//     console.log(`[BRIGHTNESS] Created command for ${device.deviceId}: ${brightness}`);
//   } catch (err) {
//     console.error("[BRIGHTNESS] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi tạo lệnh độ sáng" });
//   }
// });

// /**
//  * Thiết bị lấy lệnh tiếp theo
//  */
// router.get("/:deviceId/next-command", async (req, res) => {
//   try {
//     const { deviceId } = req.params;
//     const device = await LightDevice.findOne({ deviceId, isDeleted: { $ne: true } });

//     if (!device) {
//       console.warn(`[NEXT COMMAND] Device ${deviceId} not found`);
//       return res.status(404).json({ ok: false, message: "Device not found" });
//     }

//     const cmd = await Command.findOneAndUpdate(
//       { deviceId, status: "pending" },
//       { $set: { status: "sent" } },
//       { sort: { _id: 1 }, new: true }
//     ).select("deviceId command params status");

//     const response = { ok: true, command: cmd || null };
//     res.json(response);
//     console.log(`[NEXT COMMAND] Response for ${deviceId}: ${JSON.stringify(response)}`);
//   } catch (err) {
//     console.error("[NEXT COMMAND] error:", err.message);
//     res.status(500).json({ ok: false, message: "Server error" });
//   }
// });

// /**
//  * Thiết bị báo cáo trạng thái
//  */
// router.post("/report", async (req, res) => {
//   try {
//     const { mac, cmd, commandId, lat, lon, brightness } = req.body;
//     const deviceId = mac.toUpperCase();

//     await LightStatus.findOneAndUpdate(
//       { deviceId },
//       { 
//         $set: { 
//           relay: cmd === 1, 
//           brightness: brightness ?? 50,   // thêm brightness thực tế
//           lastUpdated: new Date() 
//         } 
//       },
//       { upsert: true }
//     );

//     if (lat && lon) {
//       await LightDevice.findOneAndUpdate(
//         { deviceId },
//         { $set: { "gps.lat": lat, "gps.lon": lon } }
//       );
//     }

//     if (commandId) {
//       await Command.findOneAndUpdate(
//         { _id: commandId },
//         { $set: { status: "done" } }
//       );
//     }

//     res.json({ ok: true });
//     console.log(`[REPORT] Processed report for ${deviceId}, cmd=${cmd}, brightness=${brightness}`);
//   } catch (err) {
//     console.error("[REPORT] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi xử lý báo cáo" });
//   }
// });

// /**
//  * Lấy toàn bộ danh sách thiết bị (cho admin / debug)
//  */
// router.get("/all", async (req, res) => {
//   try {
//     const devices = await LightDevice.find({ isDeleted: { $ne: true } });
//     const response = {
//       ok: true,
//       devices: devices.map((d) => ({
//         deviceId: d.deviceId,
//         isAssigned: d.user !== null,
//       })),
//     };
//     res.json(response);
//     console.log(`[ALL DEVICES] Sent response: ${JSON.stringify(response)}`);
//   } catch (err) {
//     console.error("[ALL DEVICES] error:", err.message);
//     res.status(500).json({ ok: false, message: "Lỗi khi lấy danh sách thiết bị" });
//   }
// });

// module.exports = router;


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
    const devices = await LightDevice.find({ user: null, isDeleted: { $ne: true } });
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
      { user: req.user.userId, isAssigned: true },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ ok: false, message: "Device not found" });
    }

    res.json({ ok: true, message: `Approved device ${mac}`, device });
  } catch (err) {
    console.error("[APPROVE DEVICE] error:", err.message);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * ==============================
 * User gán thiết bị vào tài khoản
 * ==============================
 */
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
    device.isAssigned = true;

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
        gps: d.gps
          ? {
              lat: d.gps.lat != null ? Number(d.gps.lat) : null,
              lon: d.gps.lon != null ? Number(d.gps.lon) : null,
            }
          : { lat: null, lon: null },
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
 * Cập nhật GPS của thiết bị
 * ==============================
 */
router.put("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { gps } = req.body;

    if (!gps || !gps.lat || !gps.lon) {
      return res.status(400).json({ ok: false, message: "Thiếu tọa độ GPS" });
    }

    const latNum = parseFloat(gps.lat);
    const lonNum = parseFloat(gps.lon);
    if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return res.status(400).json({ ok: false, message: "Tọa độ GPS không hợp lệ" });
    }

    const device = await LightDevice.findOneAndUpdate(
      { _id: id, user: req.user.userId, isDeleted: { $ne: true } },
      { $set: { gps: { lat: latNum, lon: lonNum } } },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy thiết bị" });
    }

    res.json({ ok: true, device });
    console.log(`[UPDATE GPS] Updated device ${device.deviceId} with gps: ${JSON.stringify(device.gps)}`);
  } catch (err) {
    console.error("[UPDATE GPS] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi cập nhật thiết bị" });
  }
});

/**
 * ==============================
 * Xóa thiết bị
 * ==============================
 */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const device = await LightDevice.findOneAndUpdate(
      { _id: id, user: req.user.userId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true } },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy thiết bị" });
    }

    res.json({ ok: true, message: `Xóa thiết bị ${device.deviceId} thành công` });
    console.log(`[DELETE DEVICE] Deleted device ${device.deviceId}`);
  } catch (err) {
    console.error("[DELETE DEVICE] error:", err.message);
    res.status(500).json({ ok: false, message: "Lỗi khi xóa thiết bị" });
  }
});

/**
 * ==============================
 * Gửi lệnh chung (toggle + brightness)
 * ==============================
 */
router.post("/:id/command", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { state, brightness } = req.body;

    const device = await LightDevice.findOne({
      _id: id,
      user: req.user.userId,
      isDeleted: { $ne: true },
    });

    if (!device) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy thiết bị" });
    }

    // Toggle
    if (state !== undefined) {
      await Command.create({
        deviceId: device.deviceId,
        command: state ? "ON" : "OFF",
        params: {},
        status: "pending",
      });

      await LightStatus.findOneAndUpdate(
        { deviceId: device.deviceId },
        { $set: { relay: state } },
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