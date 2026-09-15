const User = require('../models/User');



const getProfile = async (req, res) => {
  res.status(200).json(req.user);
};

const listUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } }).select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (avatar) updates.avatar = avatar;

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
    }).select('-password');

    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = { getProfile, updateProfile, listUsers };
