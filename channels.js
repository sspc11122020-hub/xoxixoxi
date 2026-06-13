import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

// ==================== الإعدادات العامة ====================
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/sspc11122020-hub/xoxixoxi/refs/heads/main/';
const BASE_URL = 'https://cup2026.aflam4you.pro';

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * فحص دفق الفيديو باستخدام ffprobe للتأكد من أن الرابط يعمل
 */
async function verifyVideo(streamUrl) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "3", "-timeout", "3000000"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 عبر تتبع شبكة المتصفح (Network Trailing)
 */
async function getStreamUrl(browser, pageUrl) {
    let page = null;
    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        let m3u8Links = [];

        // 🎯 مراقبة طلبات الشبكة (Network) لالتقاط أي رابط m3u8 يطلبه المشغل تلقائياً
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                m3u8Links.push(url);
            }
            request.continue();
        });

        // فتح صفحة القناة وانتظار تحميل المشغل
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // البحث الإضافي داخل كود الصفحة والـ iframes كخيار احتياطي
        const content = await page.content();
        const $ = cheerio.load(content);
        
        const scripts = $('script').text();
        const m3u8Matches = scripts.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        if (m3u8Matches) m3u8Links.push(...m3u8Matches);

        // تنظيف الروابط وتجربتها
        const uniqueLinks = [...new Set(m3u8Links)].map(l => l.replace(/\\/g, ''));
        for (const link of uniqueLinks) {
            if (await verifyVideo(link)) {
                await page.close();
                return link;
            }
        }
        
        await page.close();
        return null;
    } catch (e) {
        if (page) await page.close();
        return null;
    }
}

/**
 * تحميل ومعالجة الصورة بـ Buffer آمن عبر المتصفح لتفادي الـ 403
 */
async function processImage(browser, imgUrl, channelName) {
    if (!imgUrl) return "";
    let page = null;
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        let finalImgUrl = imgUrl;
        if (imgUrl.startsWith('/')) finalImgUrl = BASE_URL + imgUrl;

        page = await browser.newPage();
        const viewSource = await page.goto(finalImgUrl);
        const buffer = await viewSource.buffer();
        await page.close();

        await sharp(buffer)
            .resize(400, 225)
            .jpeg({ quality: 85 })
            .toFile(filePath);

        console.log(`✅ تم حفظ الصورة: ${fileName}`);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch (err) { 
        if (page) await page.close();
        console.log(`❌ فشل تحميل صورة ${channelName}: ${err.message}`);
        return ""; 
    }
}

/**
 * الدالة الرئيسية للبدء
 */
async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    console.log("🚀 جاري تشغيل المتصفح الخفي (Puppeteer)...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const pageUrl = 'https://cup2026.aflam4you.pro/browse-watch-shahid-tv-live-videos-1-date.html';
    console.log(`\n🌐 جاري فتح الموقع كمتصفح حقيقي: ${pageUrl}`);

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
        const html = await page.content();
        await page.close();

        const $ = cheerio.load(html);
        const items = [];
        
        $('li.col-xs-6.col-sm-4.col-md-3').each((i, el) => {
            const linkTag = $(el).find('.pm-video-thumb a');
            const imgTag = $(el).find('.pm-video-thumb img');
            const titleTag = $(el).find('.caption h3 a');
            
            let pageLink = linkTag.attr('href');
            if (pageLink && pageLink.startsWith('/')) pageLink = BASE_URL + pageLink;

            let rawName = titleTag.attr('title') || titleTag.text() || "قناة غير معروفة";
            let cleanName = rawName
                .replace(/بث مباشر/g, '')
                .replace(/live tv/gi, '')
                .replace(/livetv/gi, '')
                .trim();

            items.push({
                name: cleanName,
                page: pageLink,
                img: imgTag.attr('src'),
                cat: "قنوات العامة و أفلام"
            });
        });

        console.log(`📈 تم العثور على ${items.length} قناة. بدء الفحص ومراقبة الـ Network...`);

        for (const item of items) {
            if (!item.page) continue;
            console.log(`🔍 فحص قناة: ${item.name}`);
            
            const streamUrl = await getStreamUrl(browser, item.page);
            
            if (streamUrl) {
                console.log(`✨ سيرفر شغال، جاري سحب الصورة بالمتصفح...`);
                const localImg = await processImage(browser, item.img, item.name);
                
                finalChannels.push({
                    name: item.name,
                    category: item.cat,
                    url: streamUrl,
                    server_url: item.page,
                    local_img: localImg,
                    status: "Akamaized",
                    last_update: currentTime
                });
            } else {
                console.log(`⚠️ لم يتم العثور على سيرفر m3u8 مستجيب.`);
            }
        }
    } catch (e) {
        console.log(`❌ خطأ عام أثناء معالجة الموقع: ${e.message}`);
    }

    await browser.close();

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n🏁 انتهت العملية! تم حفظ ${finalChannels.length} قناة بنجاح في ملف ${JSON_FILE}`);
}

startScraping();
