const express = require('express');
const path = require('path');
const router = express.Router();

// ✅ STATIC FILE SERVING - Extracted from server.js
// Serve static files from root directory with caching
router.use(express.static(path.join(__dirname, '..'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath, stat) => {
        // Set cache headers based on file type
        if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
        } else if (filePath.match(/\.(jpg|jpeg|png|gif|ico|svg|webp)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
        }
    }
}));

// ✅ FRONTEND PAGE ROUTES - Extracted from server.js
// Home route - serves your sign-up page
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'sign-up.html'));
});

// Specific HTML page routes
router.get('/sign-up', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'sign-up.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'login.html'));
});

router.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Dashboard.html'));
});

// 🔧 FIX: Added missing message-generator route
router.get('/message-generator.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'message-generator.html'));
});

// Also support without .html extension
router.get('/message-generator', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'message-generator.html'));
});

// ✅ SPECIAL FILES - SEO and PWA support
router.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Disallow: /api/
Disallow: /auth/
Allow: /

Sitemap: https://msgly.ai/sitemap.xml`);
});

router.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://msgly.ai/</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>https://msgly.ai/sign-up</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>https://msgly.ai/login</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>
    <url>
        <loc>https://msgly.ai/dashboard</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>https://msgly.ai/message-generator</loc>
        <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
    </url>
</urlset>`);
});

// PWA Manifest
router.get('/manifest.json', (req, res) => {
    res.type('application/json');
    res.json({
        name: "Msgly.AI",
        short_name: "Msgly",
        description: "AI-powered LinkedIn outreach automation platform",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0066cc",
        icons: [
            {
                src: "/images/icon-192.png",
                sizes: "192x192",
                type: "image/png"
            },
            {
                src: "/images/icon-512.png", 
                sizes: "512x512",
                type: "image/png"
            }
        ]
    });
});

// Service Worker
router.get('/sw.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, '..', 'sw.js'), (err) => {
        if (err) {
            res.status(404).send('// Service worker not found');
        }
    });
});

// Favicon
router.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'favicon.ico'), (err) => {
        if (err) {
            res.status(404).send('Favicon not found');
        }
    });
});

module.exports = router;
