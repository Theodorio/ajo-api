const router = require('express').Router();
const { Decimal128 } = require('mongoose').Types; 
const Circle = require('../models/Circles');
const User = require('../models/user_schema');
const CycleManager = require('../services/CycleManager');
const { validateCircleEntry } = require('../middleware/circleAuth');

router.post('/', async (req, res) => {
  try {
    const circle = new Circle({
      title: req.body.title,
      contributionAmount: Decimal128.fromString(req.body.contributionAmount.toString()),
      frequency: req.body.frequency,
      totalPot: Decimal128.fromString("0"),  // ADD THIS - starts at 0
      status: 'Forming'
    });
    
    await circle.save();
    res.json(circle);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
router.post('/join', async (req, res) => {
  try {
    const { userId, circleId } = req.body;
    const user = await User.findById(userId);
    const circle = await Circle.findById(circleId);
    
    if (!user || !circle) throw new Error('User or Circle not found');

    // 1. PREVENT DUPLICATES: Check if user is already in the circle
    const isAlreadyMember = circle.members.some(m => m.user.toString() === userId);
    if (isAlreadyMember) throw new Error('User is already a member of this circle');
    
    // 2. Add Member & Update Payout Order
    circle.members.push({ user: userId, paymentStatus: 'Pending' });
    circle.payoutOrder.push(userId);
    
    // 3. Update Total Pot
    const memberCount = circle.payoutOrder.length;
    const contrib = parseFloat(circle.contributionAmount.toString());
    circle.totalPot = Decimal128.fromString((memberCount * contrib).toString());
    
    // 4. STATUS TRIGGER: Flip to Active if 2+ members
    if (circle.members.length >= 2) {
      circle.status = 'Active';
    }
    
    user.activeCircles.push(circleId);
    
    await circle.save();
    await user.save();
    res.json({ success: true, status: circle.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/payout', async (req, res) => {
  try {
    const result = await CycleManager.processCirclePayout(req.body.circleId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contribute', async (req, res) => {
  try {
    const { userId, circleId } = req.body;
    const user = await User.findById(userId);
    const circle = await Circle.findById(circleId);
    
    const member = circle.members.find(m => m.user.toString() === userId);
    if (!member) throw new Error('Not a member');
    
    const amount = parseFloat(circle.contributionAmount.toString());
    await user.escrowToVault(amount);
    member.paymentStatus = 'Paid';
    
    await user.save();
    await circle.save();
    
    res.json({ success: true, amount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/default', async (req, res) => {
  try {
    const { userId, circleId } = req.body;
    const user = await User.findById(userId);
    const circle = await Circle.findById(circleId);
    
    const member = circle.members.find(m => m.user.toString() === userId);
    if (!member) throw new Error('Not a member');
    
    const amount = parseFloat(circle.contributionAmount.toString());
    await user.applyDefaultPenalty(amount);
    member.paymentStatus = 'Defaulted';
    
    await circle.save();
    res.json({ message: `${user.fullName} defaulted. Debt: ₦${user.wallet.debtBalance}, Status: ${user.status}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add this route (GET all circles)
router.get('/', async (req, res) => {
  try {
    const circles = await Circle.find().populate('members.user');
    res.json(circles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;