'use strict';
// Editor für Duden, Rezepte und Download-Projekte (views/partials/md-editor.ejs, public/editor.js): Vorschau und Bilder für
// alle, die dort schreiben dürfen (Recht „Schreiben“ oder Hochladen). Der Admin hat dafür /admin/preview und /admin/media.
const express = require('express');
const auth = require('../auth');
const up = require('../uploads');
const { mdBlocks } = require('../util');

const router = express.Router();
const allowed = user => !!user && (user.isAdmin || user.canWrite || user.canUpload);

router.post('/vorschau', (req, res) => {
  if (!allowed(req.user)) return res.status(403).end();
  res.type('html').send(mdBlocks(String(req.body.md || '').slice(0, 300000)));
});

router.post('/bild', (req, res, next) => (allowed(req.user) ? next() : res.status(403).json([])), auth.rateLimit('schreiben-bild', 60, 3600),
  up.mediaUpload.array('images'), auth.csrfCheck, (req, res) => {
    const quota = require('../quota'), size = (req.files || []).reduce((n, f) => n + f.size, 0);
    if (!req.user.isAdmin && !quota.fits(req.user, size)) {
      for (const f of req.files || []) up.removeQuietly(f.path);
      return res.status(413).json({ error: quota.fullMessage(req.user) });
    }
    res.json(up.saveMedia(req.files, req.user.id));
  });

module.exports = router;
