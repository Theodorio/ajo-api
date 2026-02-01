const User = require('../models/user_schema');

/**
 * Circle Join Validation Middleware
 * Prevents high-risk users from entering ROSC pools
 */
const validateCircleEntry = async (req, res, next) => {
  try {
    const { userId } = req.body; // or req.user.id from JWT
    
    const user = await User.findById(userId).select('+paymentToken');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // CHECK 1: Blacklist Status
    if (user.status === 'Blacklisted') {
      return res.status(403).json({
        error: 'Account Blacklisted',
        message: 'You cannot join Ajo circles due to excessive defaulted contributions. Please contact support.',
        code: 'BLACKLISTED'
      });
    }

    // CHECK 2: Active Debt Verification
    const debt = parseFloat(user.wallet.debtBalance.toString());
    if (debt > 0) {
      return res.status(403).json({
        error: 'Outstanding Debt',
        message: `You have an unpaid debt of ₦${debt}. Please clear your debt before joining a new circle.`,
        requiredPayment: debt,
        code: 'ACTIVE_DEBT'
      });
    }

    // CHECK 3: Frozen Account
    if (user.status === 'Frozen') {
      return res.status(403).json({
        error: 'Account Frozen',
        message: 'Your account is temporarily frozen. Complete verification to continue.',
        code: 'FROZEN'
      });
    }

    // CHECK 4: Tier Limits (Concurrent Circles)
    const canJoin = user.canJoinCircle();
    if (!canJoin.allowed) {
      return res.status(403).json({
        error: 'Tier Limit Reached',
        message: canJoin.reason,
        currentTier: user.userTier,
        code: 'TIER_LIMIT'
      });
    }

    // CHECK 5: Minimum Trust Score (Optional additional safety)
    if (user.trustScore < 350) {
      return res.status(403).json({
        error: 'Trust Score Too Low',
        message: 'Your reputation score is below the threshold to join new circles. Improve your score by completing existing cycles.',
        currentScore: user.trustScore,
        requiredScore: 350,
        code: 'LOW_TRUST'
      });
    }

    // Attach user to request for downstream use
    req.userData = user;
    next();
    
  } catch (error) {
    console.error('Circle validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
};

module.exports = { validateCircleEntry };