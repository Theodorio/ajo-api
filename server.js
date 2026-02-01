require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    // Init backstop if empty
    const Backstop = require('./models/BackstopReserve');
    if (!await Backstop.findOne()) {
      await Backstop.create({ 
        balance: mongoose.Types.Decimal128.fromString("1000000") 
      });
    }
  });

// Routes
app.use('/api', require('./routes'));

// HTML Test Interface (optional - remove in production)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/test.html');
});

app.listen(3000, () => console.log('Server running on port 3000'));