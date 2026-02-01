const mongoose = require('mongoose');

/**
 * Platform Insurance Fund
 * Acts as liquidity buffer when circle members default.
 * Funded by 1.5% fees from every payout across all circles.
 */
const BackstopReserveSchema = new mongoose.Schema({
  balance: {
    type: mongoose.Types.Decimal128,
    default: 0,
    description: 'Total liquid reserves available to cover defaults'
  },
  
  totalDeployed: {
    type: mongoose.Types.Decimal128,
    default: 0,
    description: 'Cumulative amount ever borrowed to cover shortfalls'
  },
  
  activeLoans: [{
    circle: { type: mongoose.Schema.Types.ObjectId, ref: 'Circle' },
    amount: mongoose.Types.Decimal128,
    defaultedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recovered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('BackstopReserve', BackstopReserveSchema);