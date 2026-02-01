const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Ajo - Rotational Savings Platform (ROSCA)
 * User Schema with Triple-Ledger Accounting
 * 
 * Security Note: In production, encrypt BVN/NIN at rest using mongoose-encryption
 * or MongoDB Client-Side Field Level Encryption (CSFLE). Payment tokens must 
 * be encrypted and never exposed in logs.
 */

// Constants
const USER_TIERS = ['Bronze', 'Silver', 'Gold'];
const USER_STATUSES = ['Active', 'Frozen', 'Blacklisted'];
const DEBT_BLACKLIST_THRESHOLD = 500000; // ₦5,000 in kobo (smallest currency unit)
const TRUST_SCORE_RANGE = { min: 300, max: 850 };

const UserSchema = new Schema({
  // ==========================================
  // IDENTITY & KYC VERIFICATION
  // ==========================================
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  
  bvn: {
    type: String,
    required: [true, 'BVN is mandatory for KYC'],
    unique: true,
    immutable: true, // BVN cannot change once set
    validate: {
      validator: function(v) {
        return /^\d{11}$/.test(v); // Nigerian BVN is 11 digits
      },
      message: 'BVN must be exactly 11 digits'
    },
    index: true
  },

  nin: {
    type: String,
    required: [true, 'NIN is mandatory for identity verification'],
    unique: true,
    immutable: true,
    validate: {
      validator: function(v) {
        return /^\d{11}$/.test(v); // Nigerian NIN is 11 digits
      },
      message: 'NIN must be exactly 11 digits'
    },
    index: true
  },

  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    validate: {
      validator: function(v) {
        // Nigerian format: +234 or 0 followed by 7/8/9 and 9 more digits
        return /^(\+234|0)[789]\d{9}$/.test(v);
      },
      message: 'Invalid phone number format'
    },
    index: true
  },

  // ==========================================
  // TRIPLE-LEDGER WALLET SYSTEM
  // ==========================================
  // Using Decimal128 for financial precision (avoids floating-point errors)
  // Alternatively, store as Integer (kobo) in production for absolute precision
  
  wallet: {
    availableBalance: {
      type: Schema.Types.Decimal128,
      default: 0,
      min: 0,
      description: 'Liquid cash available for withdrawal or new Ajo contributions'
    },
    
    /**
     * THE VAULT SYSTEM
     * Funds here are locked/encumbered during active Ajo cycles. When a user 
     * joins a circle, their contribution amount moves from availableBalance 
     * to vaultBalance. These funds cannot be withdrawn until:
     * 1. The user receives their payout turn (pot), OR
     * 2. The cycle completes and they exit, OR
     * 3. They default (funds remain locked until debt is settled)
     * This ensures solvency of the ROSCA pool.
     */
    vaultBalance: {
      type: Schema.Types.Decimal128,
      default: 0,
      min: 0,
      description: 'Funds locked in active Ajo cycles (collateral/committed)'
    },
    
    /**
     * DEBT LEDGER
     * Tracks defaulted contributions. When a user misses a payment:
     * 1. The owed amount is added to debtBalance
     * 2. A 5% penalty is immediately applied to discourage defaults
     * 3. This accrues until repaid (via availableBalance or direct debit)
     */
    debtBalance: {
      type: Schema.Types.Decimal128,
      default: 0,
      min: 0,
      description: 'Outstanding defaulted contributions + 5% penalties'
    }
  },

  // ==========================================
  // REPUTATION ENGINE
  // ==========================================
  trustScore: {
    type: Number,
    default: 400,
    min: [TRUST_SCORE_RANGE.min, 'Trust score cannot be below 300'],
    max: [TRUST_SCORE_RANGE.max, 'Trust score cannot exceed 850'],
    description: 'Creditworthiness metric (300=poor, 850=excellent)'
  },

  userTier: {
    type: String,
    enum: {
      values: USER_TIERS,
      message: 'Tier must be Bronze, Silver, or Gold'
    },
    default: 'Bronze',
    description: 'Determines max Ajo contribution limits and privileges'
  },

  status: {
    type: String,
    enum: {
      values: USER_STATUSES,
      message: 'Status must be Active, Frozen, or Blacklisted'
    },
    default: 'Active',
    index: true,
    description: 'Account operational status'
  },

  // ==========================================
  // PAYMENT AUTOMATION (PCI DSS Sensitive)
  // ==========================================
  /**
   * Tokenized card reference from Paystack/Flutterwave.
   * NEVER store raw card numbers (PAN). This is a reference token 
   * used for recurring direct debits. Encrypt this field at rest.
   */
  paymentToken: {
    type: String,
    select: false, // Excluded from queries by default (security)
    description: 'Encrypted Paystack/Flutterwave authorization token'
  },

  tokenExpiry: {
    type: Date,
    description: 'When the card token expires'
  },

  // ==========================================
  // RELATIONSHIPS
  // ==========================================
  activeCircles: [{
    type: Schema.Types.ObjectId,
    ref: 'AjoCircle',
    index: true,
    description: 'Current ROSCA circles the user is participating in'
  }],

  // Audit trail for compliance
  lastDebitAttempt: {
    type: Date,
    description: 'Last automated payment attempt timestamp'
  },

  blacklistedAt: {
    type: Date,
    description: 'Timestamp when user was blacklisted'
  },

  blacklistReason: {
    type: String,
    enum: ['Excessive Debt', 'Fraud', 'Manual Review', null],
    default: null
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==========================================
// INDEXES FOR PERFORMANCE
// ==========================================
UserSchema.index({ status: 1, trustScore: -1 }); // For risk assessment queries
UserSchema.index({ 'wallet.debtBalance': 1 }); // For debt collection jobs

// ==========================================
// PRE-SAVE MIDDLEWARE
// ==========================================

/**
 * Auto-Blacklist Logic:
 * If debt exceeds threshold, automatically blacklist user to prevent
 * joining new circles and trigger collection workflows.
 * Also freezes any active participation ability.
 */
UserSchema.pre('save', async function(next) {
  if (this.isModified('wallet.debtBalance') || this.isNew) {
    const debt = parseFloat(this.wallet.debtBalance.toString());
    
    if (debt > DEBT_BLACKLIST_THRESHOLD && this.status !== 'Blacklisted') {
      this.status = 'Blacklisted';
      this.blacklistedAt = new Date();
      this.blacklistReason = 'Excessive Debt';
      
      // Optionally: Remove from all active circles or freeze positions
      console.warn(`User ${this._id} auto-blacklisted due to debt: ${debt}`);
      
      // Trigger side effects (email, notification) via event emitter in production
      this.emit('user:blacklisted', { userId: this._id, debtAmount: debt });
    }
  }

  // Auto-tier upgrade/downgrade based on trust score
  if (this.isModified('trustScore')) {
    if (this.trustScore >= 750) this.userTier = 'Gold';
    else if (this.trustScore >= 550) this.userTier = 'Silver';
    else this.userTier = 'Bronze';
  }

  next();
});

// ==========================================
// VIRTUALS
// ==========================================

/**
 * Total Net Worth Calculation:
 * Liquid assets + Committed savings - Outstanding obligations
 * This represents the user's true equity position in the platform.
 */
UserSchema.virtual('netWorth').get(function() {
  const available = parseFloat(this.wallet.availableBalance?.toString() || 0);
  const vault = parseFloat(this.wallet.vaultBalance?.toString() || 0);
  const debt = parseFloat(this.wallet.debtBalance?.toString() || 0);
  
  return (available + vault - debt).toFixed(2);
});

/**
 * Total Locked Funds (encumbered assets)
 * Sum of vault and debt (funds that cannot be withdrawn)
 */
UserSchema.virtual('encumberedFunds').get(function() {
  const vault = parseFloat(this.wallet.vaultBalance?.toString() || 0);
  const debt = parseFloat(this.wallet.debtBalance?.toString() || 0);
  return (vault + debt).toFixed(2);
});

// ==========================================
// INSTANCE METHODS
// ==========================================

/**
 * Apply Default Penalty
 * When a user misses a contribution, add the amount plus 5% penalty to debt.
 * The 5% serves as:
 * 1. Compensation to the ROSCA group for liquidity disruption
 * 2. Operational cost of recovery efforts
 * 3. Behavioral incentive for timely payments
 * 
 * @param {Number} baseAmount - The missed contribution amount (in Naira)
 */
UserSchema.methods.applyDefaultPenalty = function(baseAmount) {
  const penaltyRate = 0.05;
  const totalOwed = baseAmount * (1 + penaltyRate);
  
  const currentDebt = parseFloat(this.wallet.debtBalance.toString());
  this.wallet.debtBalance = mongoose.Types.Decimal128.fromString(
    (currentDebt + totalOwed).toString()
  );
  
  // Impact reputation
  this.trustScore = Math.max(TRUST_SCORE_RANGE.min, this.trustScore - 50);
  
  return this.save();
};

/**
 * Check if user can join a new Ajo circle
 * Validates tier limits, blacklist status, and existing commitments
 */
UserSchema.methods.canJoinCircle = function() {
  if (this.status === 'Blacklisted') {
    return { allowed: false, reason: 'Account is blacklisted due to outstanding debt' };
  }
  
  if (this.status === 'Frozen') {
    return { allowed: false, reason: 'Account is temporarily frozen' };
  }

  // Tier-based limits on concurrent circles
  const tierLimits = { Bronze: 2, Silver: 5, Gold: 10 };
  const maxCircles = tierLimits[this.userTier];
  
  if (this.activeCircles.length >= maxCircles) {
    return { 
      allowed: false, 
      reason: `Tier ${this.userTier} limit: Max ${maxCircles} active circles` 
    };
  }
  
  return { allowed: true };
};

/**
 * Move funds from Available to Vault (when joining a circle)
 * Atomic operation simulation - use transactions in production
 */
UserSchema.methods.escrowToVault = async function(amount) {
  const available = parseFloat(this.wallet.availableBalance.toString());
  
  if (available < amount) {
    throw new Error('Insufficient available balance');
  }
  
  this.wallet.availableBalance = mongoose.Types.Decimal128.fromString(
    (available - amount).toString()
  );
  
  const vault = parseFloat(this.wallet.vaultBalance.toString());
  this.wallet.vaultBalance = mongoose.Types.Decimal128.fromString(
    (vault + amount).toString()
  );
  
  return this.save();
};

/**
 * Repay debt from available balance
 * Returns the remaining debt after payment
 */
UserSchema.methods.repayDebt = async function(amount) {
  const available = parseFloat(this.wallet.availableBalance.toString());
  const debt = parseFloat(this.wallet.debtBalance.toString());
  
  if (amount > available) throw new Error('Insufficient funds');
  if (amount > debt) throw new Error('Payment exceeds debt');
  
  this.wallet.availableBalance = mongoose.Types.Decimal128.fromString(
    (available - amount).toString()
  );
  
  this.wallet.debtBalance = mongoose.Types.Decimal128.fromString(
    (debt - amount).toString()
  );
  
  // Improve trust score slightly on repayment
  this.trustScore = Math.min(TRUST_SCORE_RANGE.max, this.trustScore + 10);
  
  // If fully cleared, check if we should unfreeze
  if (parseFloat(this.wallet.debtBalance.toString()) === 0 && this.status === 'Frozen') {
    this.status = 'Active';
  }
  
  await this.save();
  return parseFloat(this.wallet.debtBalance.toString());
};

// ==========================================
// STATIC METHODS
// ==========================================

/**
 * Find high-risk users for collection workflows
 */
UserSchema.statics.findDefaulters = function(minDebt = 1000) {
  return this.find({
    'wallet.debtBalance': { $gt: minDebt },
    status: { $ne: 'Blacklisted' }
  }).sort({ 'wallet.debtBalance': -1 });
};

/**
 * Daily reconciliation check (run via cron job)
 * Identifies inconsistencies in triple-ledger
 */
UserSchema.statics.validateLedgerIntegrity = async function() {
  // Aggregation pipeline to find users where Available + Vault < Debt
  // (Negative net worth edge cases)
  return this.aggregate([
    {
      $addFields: {
        netPosition: {
          $subtract: [
            { $add: ['$wallet.availableBalance', '$wallet.vaultBalance'] },
            '$wallet.debtBalance'
          ]
        }
      }
    },
    {
      $match: {
        netPosition: { $lt: 0 }
      }
    }
  ]);
};

module.exports = mongoose.model('User', UserSchema);