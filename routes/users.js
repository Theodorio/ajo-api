const router = require('express').Router();
const User = require('../models/user_schema');

router.post('/', async (req, res) => {
  try {
    const user = new User(req.body);
    user.wallet.availableBalance = require('mongoose').Types.Decimal128.fromString(req.body.initialBalance.toString());
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const users = await User.find();
  res.json(users);
});

module.exports = router;