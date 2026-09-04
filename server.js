const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`HaGolan 28 electricity app running on http://localhost:${PORT}`);
});
