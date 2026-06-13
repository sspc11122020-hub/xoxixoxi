import axios from 'axios';
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

// حزمة المتصفح الكاملة لتخطي حظر الـ 403 الفاشل
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Referer': 'https://cup2026.aflam4you.pro/',
    'Cache-Control': 'max-age=0'
};

// إنشاء مجلد الصور إذا لم يكن موجوداً
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
 * استخراج رابط m3u8 من صفحة القناة مع فحص الـ iframes
 */
async function getStreamUrl(pageUrl) {
    try {
        const { data } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: BROWSER_HEADERS 
        });

        const $ = cheerio.load(data);
        let m3u8Links = [];

        // 1. البحث في السكريبتات العامة داخل الصفحة
        const scripts = $('script').text();
        const m3u8Matches = scripts.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        if (m3u8Matches) m3u8Links.push(...m3u8Matches);

        // 2. البحث داخل الـ iframes
        const iframes = $('iframe').toArray();
        for (const iframe of iframes) {
            let src = $(iframe).attr('src');
            if (src) {
                if (src.startsWith('/')) src = BASE_URL + src;
                else if (src.startsWith('//')) src = 'https:' + src;

                try {
                    const iframeRes = await axios.get(src, { 
                        timeout: 6000, 
                        headers: { ...BROWSER_HEADERS, 'Referer': pageUrl } 
                    });
                    const innerMatches = iframeRes.data.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
                    if (innerMatches) m3u8Links.push(...innerMatches);
                } catch (e) {}
            }
        }

        const uniqueLinks = [...new Set(m3u8Links)].map(l => l.replace(/\\/g, ''));
        for (const link of uniqueLinks) {
            if (await verifyVideo(link)) return link;
        }
        return null;
    } catch { return null; }
}

/**
 * معالجة وتحميل الصورة وحفظها محلياً بأبعاد قياسية
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        let finalImgUrl = imgUrl;
        if (imgUrl.startsWith('/')) {
            finalImgUrl = BASE_URL + imgUrl;
        }

        const response = await axios({ 
            url: finalImgUrl, 
            responseType: 'arraybuffer', 
            timeout: 12000,
            headers: BROWSER_HEADERS
        });

        await sharp(response.data)
            .resize(400, 225)
            .jpeg({ quality: 85 })
            .toFile(filePath);

        console.log(`✅ تم حفظ الصورة: ${fileName}`);
        return `${GITHUB_RAW_BASE}image/${fileName}`;
    } catch (err) { 
        console.log(`❌ فشل تحميل صورة ${channelName}: ${err.message}`);
        return ""; 
    }
}

/**
 * دالة البدء الرئيسية
 */
async function startScraping() {
    const finalChannels = [];
    const currentTime = new Date().toLocaleString('ar-EG');
    
    const pages = [
        'https://cup2026.aflam4you.pro/browse-watch-shahid-tv-live-videos-1-date.html'
    ];

    for (const pageUrl of pages) {
        console.log(`\n🌐 جاري استخراج القنوات من الهيكل الجديد لـ: ${pageUrl}`);
        try {
            const { data } = await axios.get(pageUrl, { headers: BROWSER_HEADERS });
            const $ = cheerio.load(data);
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

            console.log(`📈 تم العثور على ${items.length} قناة في الصفحة. بدء الفحص...`);

            for (const item of items) {
                if (!item.page) continue;
                console.log(`🔍 فحص قناة: ${item.name}`);
                
                const streamUrl = await getStreamUrl(item.page);
                
                if (streamUrl) {
                    console.log(`✨ سيرفر شغال، جاري معالجة الصورة...`);
                    const localImg = await processImage(item.img, item.name);
                    
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
                    console.log(`⚠️ لا يوجد سيرفر m3u8 متاح حالياً.`);
                }
            }
        } catch (e) { 
            console.log(`❌ خطأ في معالجة الصفحة: ${e.message}`); 
        }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n🏁 انتهت العملية! تم حفظ ${finalChannels.length} قناة شغالة بنجاح.`);
}

startScraping();
