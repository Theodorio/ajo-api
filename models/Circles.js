const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { Decimal128 } = mongoose.Types;

/**
 * Ajo Circle (ROSCA) Schema
 * Represents a rotational savings group with strict financial controls
 */
const CircleSchema = new Schema({
  title: {
    type: String,
    required: [true, 'Circle name is required'],
    trim: true,
    maxlength: 100
  },

  // Financial Parameters
  contributionAmount: {
    type: Decimal128,
    required: true,
    description: 'Fixed amount each member pays per cycle (in kobo/Naira)'
  },

  totalPot: {
    type: Decimal128,
    required: true,
    description: 'Expected total = contributionAmount × memberCount'
  },

  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true,
    description: 'Contribution collection interval'
  },

  // Rotation Mechanics
  payoutOrder: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    description: 'Strict queue: index 0 receives first, index 1 second, etc.'
  }],

  currentTurn: {
    type: Number,
    default: 0,
    description: 'Index in payoutOrder array for next payout'
  },

  cycleCount: {
    type: Number,
    default: 0,
    description: 'How many complete rotation cycles have occurred'
  },

  // Member Management with Payment Tracking
  members: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    // Current cycle payment status
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Paid', 'Defaulted', 'Excused'],
      default: 'Pending'
    },
    lastPaymentDate: Date,
    totalContributionsMade: {
      type: Number,
      default: 0,
      description: 'Historical count of successful contributions'
    }
  }],

  // Risk Management & Platform Economics
  backstopBalance: {
    type: Decimal128,
    default: 0,
    description: 'Accumulated 1.5% fees from this specific circle'
  },

  totalFeesCollected: {
    type: Decimal128,
    default: 0,
    description: 'Running total of all platform fees ever collected'
  },

  // State Management
  status: {
    type: String,
    enum: ['Forming', 'Active', 'Paused', 'Completed', 'Defaulted'],
    default: 'Forming',
    description: 'Forming=not full yet, Active=rotating, Paused=intervention needed'
  },

  startDate: Date,
  expectedEndDate: Date,

  // Metadata for reconciliation
  lastPayoutDate: Date,
  nextPayoutDate: Date

}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Virtual: Calculate actual collected amount vs expected
CircleSchema.virtual('collectionRate').get(function() {
  const paidCount = this.members.filter(m => m.paymentStatus === 'Paid').length;
  return (paidCount / this.members.length) * 100;
});

// Virtual: Current recipient (whose turn it is)
CircleSchema.virtual('currentRecipient').get(function() {
  if (!this.payoutOrder.length) return null;
  return this.payoutOrder[this.currentTurn % this.payoutOrder.length];
});

// Index for efficient queries
CircleSchema.index({ status: 1, nextPayoutDate: 1 });
CircleSchema.index({ 'members.user': 1 });

module.exports = mongoose.model('Circle', CircleSchema);