const router = require('express').Router();

router.use('/users', require('./users'));
router.use('/circles', require('./circles'));
router.get('/backstop', async (req, res) => {
  const Backstop = require('../models/BackstopReserve');
  const reserve = await Backstop.findOne();
  res.json(reserve);
});
router.post('/reset', async (req, res) => {
  const User = require('../models/user_schema');
  const Circle = require('../models/Circles');
  const Backstop = require('../models/BackstopReserve');
  await User.deleteMany({});
  await Circle.deleteMany({});
  await Backstop.deleteMany({});
  await Backstop.create({ balance: require('mongoose').Types.Decimal128.fromString("1000000") });
  res.json({ message: 'Reset complete' });
});

module.exports = router;