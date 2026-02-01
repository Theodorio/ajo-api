const mongoose = require('mongoose');
const Circle = require('../models/Circles');
const User = require('../models/user_schema');
const BackstopReserve = require('../models/BackstopReserve');
const { Decimal128 } = mongoose.Types;

/**
 * ROSCA Cycle Management Service
 * Handles the critical payout logic with triple-ledger accounting
 */
class CycleManager {
  
  /**
   * Main Payout Processor
   * The "User J Protector" ensures recipient gets full pot even with defaulters
   * 
   * @param {String} circleId - MongoDB ID of the circle
   * @param {Object} session - MongoDB session for transaction
   */
  async processCirclePayout(circleId, session) {
    const circle = await Circle.findById(circleId)
      .session(session)
      .populate('members.user')
      .populate('payoutOrder');

    if (!circle) throw new Error('Circle not found');
    if (circle.status !== 'Active') throw new Error('Circle is not active');

    const recipientId = circle.currentRecipient;
    const recipient = await User.findById(recipientId).session(session);
    
    if (!recipient) throw new Error('Recipient not found');

    // ============================
    // STEP 1: CALCULATE COLLECTION
    // ============================
    
    const contributionAmount = parseFloat(circle.contributionAmount.toString());
    const expectedTotal = parseFloat(circle.totalPot.toString());
    
    // Count who actually paid this cycle
    const successfulPayments = circle.members.filter(m => m.paymentStatus === 'Paid');
    const actualCollected = successfulPayments.length * contributionAmount;
    const shortfall = expectedTotal - actualCollected;
    
    const defaultCount = circle.members.length - successfulPayments.length;
    console.log(`[PAYOUT] Expected: ₦${expectedTotal}, Collected: ₦${actualCollected}, Shortfall: ₦${shortfall}`);

    // ============================
    // STEP 2: PLATFORM FEE (1.5%)
    // ============================
    
    const platformFeeRate = 0.015;
    const platformFee = expectedTotal * platformFeeRate;
    const netPayout = expectedTotal - platformFee;

    // Update circle's fee tracking
    circle.backstopBalance = Decimal128.fromString(
      (parseFloat(circle.backstopBalance.toString()) + platformFee).toString()
    );
    circle.totalFeesCollected = Decimal128.fromString(
      (parseFloat(circle.totalFeesCollected.toString()) + platformFee).toString()
    );

    // Add to global backstop reserve
    const reserve = await BackstopReserve.findOne().session(session) || new BackstopReserve();
    reserve.balance = Decimal128.fromString(
      (parseFloat(reserve.balance.toString()) + platformFee).toString()
    );

    // ============================
    // STEP 3: HANDLE DEFAULTS (The Protector)
    // ============================
    
    let backstopLoan = 0;
    
    if (shortfall > 0) {
      // Insufficient funds collected - activate backstop
      const reserveBalance = parseFloat(reserve.balance.toString());
      
      if (reserveBalance < shortfall) {
        throw new Error(`Backstop insufficient. Need ₦${shortfall}, have ₦${reserveBalance}. CirclePaused.`);
      }
      
      // Borrow from backstop to ensure recipient gets full amount
      backstopLoan = shortfall;
      reserve.balance = Decimal128.fromString((reserveBalance - shortfall).toString());
      reserve.totalDeployed = Decimal128.fromString(
        (parseFloat(reserve.totalDeployed.toString()) + shortfall).toString()
      );
      
      // Record the loan against specific defaulters for recovery
      const defaulters = circle.members.filter(m => m.paymentStatus !== 'Paid');
      for (const defaulter of defaulters) {
        reserve.activeLoans.push({
          circle: circleId,
          amount: Decimal128.fromString(contributionAmount.toString()),
          defaultedUser: defaulter.user._id
        });
        
        // Apply debt + 5% penalty to defaulter (using User schema method)
        await defaulter.user.applyDefaultPenalty(contributionAmount);
        defaulter.paymentStatus = 'Defaulted';
        await defaulter.user.save({ session });
      }
      
      console.log(`[BACKSTOP] Deployed ₦${backstopLoan} to cover ${defaultCount} defaults`);
    }

    // ============================
    // STEP 4: TIER-BASED WITHHOLDING (Vault Logic)
    // ============================
    
    /**
     * Vault Withholding Strategy:
     * - Bronze (High Risk): 20% locked in vault until cycle completes
     * - Silver/Gold (Lower Risk): 10% locked
     * 
     * This ensures recipients don't immediately withdraw entire pot,
     * protecting the circle's solvency for remaining members.
     */
    const withholdingRates = { Bronze: 0.20, Silver: 0.10, Gold: 0.10 };
    const withholdingRate = withholdingRates[recipient.userTier] || 0.20;
    
    const vaultAmount = netPayout * withholdingRate;
    const availableAmount = netPayout - vaultAmount;

    // ============================
    // STEP 5: UPDATE USER LEDGERS
    // ============================
    
    const currentAvailable = parseFloat(recipient.wallet.availableBalance.toString());
    const currentVault = parseFloat(recipient.wallet.vaultBalance.toString());

    recipient.wallet.availableBalance = Decimal128.fromString(
      (currentAvailable + availableAmount).toString()
    );
    recipient.wallet.vaultBalance = Decimal128.fromString(
      (currentVault + vaultAmount).toString()
    );

    // Update trust score positively for receiving payout (good standing)
    recipient.trustScore = Math.min(850, recipient.trustScore + 5);
    
    await recipient.save({ session });

    // ============================
    // STEP 6: ADVANCE CYCLE
    // ============================
    
    // Move to next in rotation
    circle.currentTurn = (circle.currentTurn + 1) % circle.payoutOrder.length;
    circle.lastPayoutDate = new Date();
    
    // Reset payment statuses for next cycle
    circle.members.forEach(member => {
      if (member.paymentStatus === 'Paid') {
        member.totalContributionsMade += 1;
      }
      member.paymentStatus = 'Pending'; // Reset for next round
    });

    // If we completed a full rotation
    if (circle.currentTurn === 0) {
      circle.cycleCount += 1;
      console.log(`[CYCLE] Completed full rotation #${circle.cycleCount}`);
      
      // If this was the final rotation, mark complete and release all vaults
      if (circle.cycleCount >= circle.payoutOrder.length) {
        await this.completeCircle(circle, session);
      }
    }

    await circle.save({ session });
    await reserve.save({ session });

    return {
      recipient: recipient.fullName,
      grossAmount: expectedTotal,
      platformFee: platformFee,
      netPayout: netPayout,
      withheldInVault: vaultAmount,
      availableNow: availableAmount,
      defaultsCovered: defaultCount,
      backstopLoan: backstopLoan,
      nextTurn: circle.currentTurn
    };
  }

  /**
   * Circle Completion Handler
   * Releases all vault funds to members when ROSCA completes
   */
  async completeCircle(circle, session) {
    circle.status = 'Completed';
    
    // Release all vault holdings for all members
    for (const memberRef of circle.members) {
      const user = await User.findById(memberRef.user).session(session);
      const vaultAmount = parseFloat(user.wallet.vaultBalance.toString());
      
      if (vaultAmount > 0) {
        const available = parseFloat(user.wallet.availableBalance.toString());
        user.wallet.availableBalance = Decimal128.fromString((available + vaultAmount).toString());
        user.wallet.vaultBalance = Decimal128.fromString('0');
        
        // Remove circle from active circles
        user.activeCircles = user.activeCircles.filter(
          cid => cid.toString() !== circle._id.toString()
        );
        
        await user.save({ session });
      }
    }
    
    console.log(`[COMPLETION] Circle ${circle.title} completed. All vaults released.`);
  }

  /**
   * Contribution Collection
   * Called when a user makes their cycle payment
   */
  async processContribution(circleId, userId, session) {
    const circle = await Circle.findById(circleId).session(session);
    const member = circle.members.find(m => m.user.toString() === userId.toString());
    
    if (!member) throw new Error('Not a member of this circle');
    if (member.paymentStatus === 'Paid') throw new Error('Already paid this cycle');
    
    const user = await User.findById(userId).session(session);
    const contribution = parseFloat(circle.contributionAmount.toString());
    
    // Move from available to vault (escrow)
    await user.escrowToVault(contribution);
    member.paymentStatus = 'Paid';
    member.lastPaymentDate = new Date();
    
    await user.save({ session });
    await circle.save({ session });
    
    return { status: 'Paid', vaultBalance: user.wallet.vaultBalance };
  }
}

module.exports = new CycleManager();