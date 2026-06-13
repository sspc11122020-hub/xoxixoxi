import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

// تفعيل وضع التخفي الصارم لمنع كشف المتصفح البرمجي
puppeteer.use(StealthPlugin());

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
        ffmpeg.ffprobe(streamUrl, ["-connect_timeout", "4", "-timeout", "4000000"], (err, metadata) => {
            if (err) resolve(false);
            else {
                const hasVideo = metadata.streams.some(s => s.codec_type === 'video');
                resolve(hasVideo);
            }
        });
    });
}

/**
 * استخراج رابط m3u8 عبر مراقبة الـ Network للتاب المفتوح
 */
async function getStreamUrl(browser, pageUrl) {
    let page = null;
    try {
        page = await browser.newPage();
        let m3u8Links = [];

        // تفعيل ميزة مراقبة طلبات الشبكة (Network Requests)
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                m3u8Links.push(url);
            }
            request.continue();
        });

        // فتح صفحة المشغل مع إعطائه وقتاً كافياً للتحميل
        await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 35000 });
        await new Promise(r => setTimeout(r, 4000)); // انتظار إضافي لضمان التقاط طلب البث

        const content = await page.content();
        const $ = cheerio.load(content);
        
        const scripts = $('script').text();
        const m3u8Matches = scripts.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        if (m3u8Matches) m3u8Links.push(...m3u8Matches);

        const uniqueLinks = [...new Set(m3u8Links)].map(l => l.replace(/\\/g, ''));
        for (const link of uniqueLinks) {
            if (await verifyVideo(link)) {
                await page.close();
                return link;
            }
        }
        
        await page.close();
        return null;
    } catch {
        if (page) await page.close();
        return null;
    }
}

/**
 * تحميل صورة القناة وحفظها بأبعاد خفيفة ومتوافقة
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

        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch { 
        if (page) await page.close();
        return ""; 
    }
}

/**
 * الدالة الأساسية للمشروع
 */
async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    // 💡 خيارات تشغيل المتصفح وإخفاء الهوية الكاملة
    const launchArgs = [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // حذف ميزة الحظر الأوتوماتيكي
        '--window-size=1280,800'
    ];

    // 🌐 إذا توفر لديك بروكسي لتخطي حظر الـ IP، ضعه هنا بين القوسين
    const PROXY_SERVER = ''; 
    if (PROXY_SERVER) {
        launchArgs.push(`--proxy-server=${PROXY_SERVER}`);
    }

    console.log("🕵️‍♂️ جاري بدء تشغيل متصفح التخفي الصارم...");
    const browser = await puppeteer.launch({
        headless: true,
        args: launchArgs
    });

    const pageUrl = 'https://cup2026.aflam4you.pro/browse-watch-shahid-tv-live-videos-1-date.html';
    console.log(`🌐 تصفح الموقع الأساسي: ${pageUrl}`);

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // فتح الصفحة وانتظار تحميل الـ DOM بالكامل
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 50000 });
        
        // 📸 التقاط لقطة شاشة للصفحة للتحقق والمراقبة دائماً
        console.log("📸 جاري التقاط لقطة الشاشة للتأكد من المحتوى المفتوح...");
        await page.screenshot({ path: 'main_page.png', fullPage: true });
        console.log("✅ تم تحديث صورة main_page.png في المجلد.");

        const html = await page.content();
        await page.close();

        const $ = cheerio.load(html);
        const items = [];
        
        // جلب عناصر قنوات البث من الهيكل الجديد
        $('li.col-xs-6.col-sm-4.col-md-3').each((i, el) => {
            const linkTag = $(el).find('.pm-video-thumb a');
            const imgTag = $(el).find('.pm-video-thumb img');
            const titleTag = $(el).find('.caption h3 a');
            
            let pageLink = linkTag.attr('href');
            if (pageLink && pageLink.startsWith('/')) pageLink = BASE_URL + pageLink;

            let rawName = titleTag.attr('title') || titleTag.text() || "قناة غير معروفة";
            let cleanName = rawName.replace(/بث مباشر/g, '').replace(/live tv/gi, '').trim();

            items.push({
                name: cleanName,
                page: pageLink,
                img: imgTag.attr('src'),
                cat: "قنوات العامة و أفلام"
            });
        });

        console.log(`📈 تم العثور على ${items.length} قناة داخل الصفحة. بدء فحص السيرفرات ومراقبة الشبكة...`);

        for (const item of items) {
            if (!item.page) continue;
            console.log(`🔍 فحص قناة: ${item.name}`);
            
            const streamUrl = await getStreamUrl(browser, item.page);
            
            if (streamUrl) {
                console.log("✨ تم العثور على رابط m3u8 نشط وجاهز!");
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
                console.log("⚠️ لم يتم العثور على رابط بث مستجيب للقناة.");
            }
        }
    } catch (e) {
        console.log(`❌ فشل التخطي أو حدثت مشكلة أثناء المعالجة: ${e.message}`);
        try {
            const pages = await browser.pages();
            if (pages.length > 0) {
                await pages[0].screenshot({ path: 'error_debug.png' });
            }
        } catch (err) {}
    }

    await browser.close();
    
    // حفظ النتيجة النهائية في ملف القنوات
    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n🏁 انتهى العمل بالكامل! تم حفظ الملف، مجموع القنوات الشغالة المكتشفة: ${finalChannels.length}`);
}

startScraping();
