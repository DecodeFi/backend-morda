const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;
const SECRET = 'your_webhook_secret'; // Shared secret for all webhooks

// 👇 Map repo full names to local paths
const REPO_MAP = {
  'DecodeFi/backend-morda': '/home/craudit/backend',
};

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  const hash = `sha256=${crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
}

app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    return res.status(403).send('Invalid signature');
  }

  const repoFullName = req.body?.repository?.full_name;
  const repoPath = REPO_MAP[repoFullName];

  if (!repoPath) {
    console.warn(`No local path configured for: ${repoFullName}`);
    return res.status(400).send(`Unknown repository: ${repoFullName}`);
  }

  exec(`cd ${repoPath} && git pull origin main`, (err, stdout, stderr) => {
    if (err) {
      console.error(`Pull failed for ${repoFullName}:`, stderr);
      return res.status(500).send('Pull failed');
    }

    console.log(`Repo ${repoFullName} pulled successfully:\n`, stdout);
    res.send(`Updated ${repoFullName}`);
  });
});

app.listen(PORT, () => {
  console.log(`Webhook listener running on port ${PORT}`);
});
