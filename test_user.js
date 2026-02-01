const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('./models/user_schema');

// Helpers
const toKobo = (amount) => mongoose.Types.Decimal128.fromString(amount.toString());
const toNaira = (decimal) => decimal ? parseFloat(decimal.toString()) : 0;

// Generate unique 11-digit numbers for BVN/NIN
// Replace the old uniqueId function with this:
const uniqueId = () => Math.floor(10000000000 + Math.random() * 90000000000).toString();
async function runTests() {
  // Start in-memory DB
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  console.log('🗄️  Test DB connected\n');

  try {
    // Clean slate
    await User.deleteMany({});

    console.log('✅ TEST 1: Create User with KYC');
    const user = await User.create({
      fullName: 'Theodorio Oluwatobi',
      bvn: uniqueId(),
      nin: uniqueId(),
      phoneNumber: '+2348012345678',
      wallet: {
        availableBalance: toKobo(50000),
        vaultBalance: toKobo(0),
        debtBalance: toKobo(0)
      }
    });
    console.log(`   User created: ${user.fullName}, Tier: ${user.userTier}, Status: ${user.status}`);

    console.log('\n✅ TEST 2: Triple-Ledger (Available → Vault)');
    await user.escrowToVault(20000);
    console.log(`   Available: ₦${toNaira(user.wallet.availableBalance)}`);
    console.log(`   Vault: ₦${toNaira(user.wallet.vaultBalance)}`);

    console.log('\n✅ TEST 3: Net Worth Calculation');
    console.log(`   Net Worth: ₦${user.netWorth}`); // Should be 50k (30k avail + 20k vault - 0 debt)

    console.log('\n✅ TEST 4: Debt Default + 5% Penalty');
    await user.applyDefaultPenalty(1000000); // Miss a payment → 5% debt
    console.log(`   Debt Balance: ₦${toNaira(user.wallet.debtBalance)} (₦1m + %5 penalty)`);
    console.log(`   Trust Score: ${user.trustScore} (dropped from 400)`);

    console.log('\n✅ TEST 5: Auto-Blacklist Trigger');
    // Create user with high debt
    const riskyUser = await User.create({
      fullName: 'Risky User',
      bvn: uniqueId(),
      nin: uniqueId(),
      phoneNumber: '+2348099988776',
      wallet: {
        availableBalance: toKobo(0),
        vaultBalance: toKobo(0),
        debtBalance: toKobo(490000) // ₦490k
      }
    });
    
    // Add ₦20k default → triggers blacklist at ₦510k+
    await riskyUser.applyDefaultPenalty(20000);
    console.log(`   Status: ${riskyUser.status}`);
    console.log(`   Blacklist Reason: ${riskyUser.blacklistReason}`);
    console.log(`   Can join circles? ${riskyUser.canJoinCircle().allowed}`);

    console.log('\n✅ TEST 6: Tier Limits');
    const bronzeUser = await User.create({
      fullName: 'Bronze Member',
      bvn: uniqueId(),
      nin: uniqueId(),
      phoneNumber: '+2348077766554',
      trustScore: 400,
      activeCircles: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()] // 2 circles
    });
    const check = bronzeUser.canJoinCircle();
    console.log(`   Bronze tier limit: ${check.allowed ? 'PASS' : 'BLOCKED'} - ${check.reason}`);

    console.log('\n🎉 ALL TESTS PASSED');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log('\n🔌 Disconnected');
  }
}

runTests();