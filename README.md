# 🪙 Ajo - The Smart ROSCA Engine

**Ajo** is a digitized, automated rotational savings platform designed to bring trust and transparency to communal banking. By combining traditional "Ajo/Esusu" mechanics with modern credit-scoring and automated debt recovery, Ajo eliminates the "trust gap" in peer-to-peer savings.

## 🚀 Key Innovation: The Trust Layer

Unlike manual groups, Ajo uses a proprietary logic to protect members:

* **Triple-Ledger Wallet:** Real-time tracking of **Available Cash**, **Vaulted Savings** (locked), and **Debt**.
* **Reputation Engine:** A dynamic Trust Score (300-850) that dictates a user's Tier (Bronze, Silver, or Gold). Higher tiers unlock larger circles.
* **Backstop Protection:** An automated insurance fund that pulls from platform fees to cover members when someone defaults.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js & Express
* **Database:** MongoDB Atlas (via Mongoose)
* **Security:** JWT Authentication & Input Sanitization
* **Compliance:** Integrated KYC logic (BVN/NIN validation)

---

## ⚙️ Installation & Setup

1. **Clone & Enter**
```bash
git clone https://github.com/Theodorio/ajo-api.git
cd ajo-api

```


2. **Install Dependencies**
```bash
npm install

```


3. **Configure Environment**
Create a `.env` file in the root directory:
```env
PORT=3000
MONGODB_URI=your_atlas_connection_string
JWT_SECRET=your_super_secret_key

```



---

## 📑 API Reference

### User Management

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/users` | Register user + KYC (BVN/NIN) |
| `GET` | `/api/users` | Fetch all registered users |

### Circle Operations

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/circles` | Initialize a new Ajo Circle |
| `POST` | `/api/circles/join` | Join an active "Forming" circle |
| `POST` | `/api/circles/contribute` | Debit user for the current round |
| `POST` | `/api/circles/payout` | Trigger rotation & fee calculation |
| `POST` | `/api/circles/default` | Trigger debt logic for a user |

---

## 🕹️ Simulation Guide (Step-by-Step)

### 1. Onboarding a Member

Register a user with an initial balance. The system automatically assigns a **Bronze** tier and a baseline **Trust Score**.

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Theodorio Oluwatobi",
    "bvn": "12345678901",
    "nin": "10987654321",
    "phoneNumber": "+2348012345678",
    "initialBalance": 50000
  }'

```

### 2. The Payout Logic (The Math)

When a payout is triggered, Ajo doesn't just move money; it secures the platform's future.

**Example Payout Breakdown:**

* **Gross Pot:** ₦30,000
* **Platform Fee (1.5%):** ₦450
* **Vault Retention (20%):** ₦5,910 (Locked to ensure the user stays for future rounds)
* **Immediate Payout:** ₦23,640

### 3. Handling Defaulters

If a user fails to contribute, the `default` endpoint applies a **5% penalty fee** and logs a debt against their profile, lowering their Trust Score instantly.

---

## ⚡ The "Lazy" Test Script

Want to see the whole system in action? Copy and paste this into your terminal to simulate 3 users, a group creation, a default event, and a final payout:

```bash
# 1. Create 3 Users
U1=$(curl -s -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"fullName":"User 1","bvn":"111","nin":"111","phoneNumber":"+2341","initialBalance":50000}' | grep -o '"_id":"[^"]*' | cut -d'"' -f4)
U2=$(curl -s -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"fullName":"User 2","bvn":"222","nin":"222","phoneNumber":"+2342","initialBalance":50000}' | grep -o '"_id":"[^"]*' | cut -d'"' -f4)
U3=$(curl -s -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"fullName":"User 3","bvn":"333","nin":"333","phoneNumber":"+2343","initialBalance":50000}' | grep -o '"_id":"[^"]*' | cut -d'"' -f4)

# 2. Create and Join Circle
C_ID=$(curl -s -X POST http://localhost:3000/api/circles -H "Content-Type: application/json" -d '{"title":"Lagos Weekly","contributionAmount":10000,"frequency":"weekly"}' | grep -o '"_id":"[^"]*' | cut -d'"' -f4)
curl -s -X POST http://localhost:3000/api/circles/join -H "Content-Type: application/json" -d "{\"userId\":\"$U1\",\"circleId\":\"$C_ID\"}"
curl -s -X POST http://localhost:3000/api/circles/join -H "Content-Type: application/json" -d "{\"userId\":\"$U2\",\"circleId\":\"$C_ID\"}"
curl -s -X POST http://localhost:3000/api/circles/join -H "Content-Type: application/json" -d "{\"userId\":\"$U3\",\"circleId\":\"$C_ID\"}"

# 3. Simulate contributions and one default
curl -s -X POST http://localhost:3000/api/circles/contribute -H "Content-Type: application/json" -d "{\"userId\":\"$U1\",\"circleId\":\"$C_ID\"}"
curl -s -X POST http://localhost:3000/api/circles/default -H "Content-Type: application/json" -d "{\"userId\":\"$U3\",\"circleId\":\"$C_ID\"}"

# 4. Simulate Default (U3 fails to pay)
curl -s -X POST http://localhost:3000/api/circles/default -H "Content-Type: application/json" -d "{\"userId\":\"$U3\",\"circleId\":\"$C_ID\"}"

# 5. TRIGGER PAYOUT (The missing piece!)
echo "Processing Payout..."
curl -s -X POST http://localhost:3000/api/circles/payout -H "Content-Type: application/json" -d "{\"circleId\":\"$C_ID\"}"

# 6. Check Insurance (Backstop) Balance
echo "Checking Insurance Fund..."
curl -s http://localhost:3000/api/backstop

echo "Simulation complete!"


```

---

