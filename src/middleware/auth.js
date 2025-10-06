const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const User = require('../models/User');

// Middleware xác thực JWT + xác thực người dùng
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Thiếu hoặc sai định dạng token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ message: "Không tìm thấy User" });

    // Kiểm tra thời gian không hoạt động
    const now = Date.now();
    const last = user.lastActivity ? user.lastActivity.getTime() : 0;
    const diffMinutes = (now - last) / 1000 / 60;

    if (diffMinutes > 15) {
      return res.status(401).json({ message: "Phiên làm việc đã hết hạn" });
    }

    // Reset lastActivity và tiếp tục
    user.lastActivity = new Date();
    await user.save();

    req.user = {
      userId: user._id,
      role: user.role,
      username: user.username,
      email: user.email,
    };
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
}

// Middleware phân quyền (role-based)
function authorize(roles = []) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
