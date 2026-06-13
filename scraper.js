import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

// الإعدادات العامة
const IMAGE_DIR = './image';
const JSON_FILE = 'channels.json';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/sspc11122020-hub/xoxixoxi/refs/heads/main/';
const BASE_URL = 'http://www.azrotv.com';

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
            timeout: 8000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)' } 
        });

        const $ = cheerio.load(data);
        let m3u8Links = [];

        // البحث في السكريبتات
        const scripts = $('script').text();
        const m3u8Matches = scripts.match(/https?:\/\/[^"']+\.m3u8[^"']*/g);
        if (m3u8Matches) m3u8Links.push(...m3u8Matches);

        // البحث داخل الـ iframes
        const iframes = $('iframe').toArray();
        for (const iframe of iframes) {
            let src = $(iframe).attr('src');
            if (src) {
                if (src.startsWith('/')) src = BASE_URL + src;
                
                if (src.includes('id=')) {
                    const potentialUrl = src.split('id=')[1].split('&')[0];
                    if (potentialUrl.includes('.m3u8')) m3u8Links.push(potentialUrl);
                }

                try {
                    const iframeRes = await axios.get(src, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
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
 * معالجة وتحميل الصورة وحفظها محلياً
 */
async function processImage(imgUrl, channelName) {
    if (!imgUrl) return "";
    try {
        const safeName = channelName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_').toLowerCase();
        const fileName = `${safeName}.jpg`;
        const filePath = path.join(IMAGE_DIR, fileName);

        let finalImgUrl = imgUrl;

        if (imgUrl.startsWith('..')) {
            finalImgUrl = imgUrl.replace('..', 'http://www.azrotv.com/iphone');
        } else if (imgUrl.startsWith('/')) {
            finalImgUrl = BASE_URL + imgUrl;
        } else if (!imgUrl.startsWith('http')) {
            finalImgUrl = 'http://www.azrotv.com/iphone/arabic/' + imgUrl;
        }

        const response = await axios({ 
            url: finalImgUrl, 
            responseType: 'arraybuffer', 
            timeout: 10000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'http://www.azrotv.com/' 
            } 
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
    let channelIdCounter = 1; // عداد لإنشاء معرفات بسيطة (1, 2, 3...)
    
    const pages = [
        'http://www.azrotv.com/iphone/arabic/',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_2.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_3.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_4.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_5.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_6.php',
        'http://www.azrotv.com/iphone/arabic/mobi_arabic_7.php',
        'http://www.azrotv.com/iphone/arabic/iraq.php',
        'http://www.azrotv.com/iphone/arabic/tn.php'
    ];

    for (const pageUrl of pages) {
        console.log(`\n🌐 جاري استخراج القنوات من: ${pageUrl}`);
        try {
            const { data } = await axios.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(data);
            
            const items = [];
            $('.BlockCha').each((i, el) => {
                const linkTag = $(el).find('a.Azrotv-ChUrl');
                const imgTag = $(el).find('img.oui9img');
                
                let pageLink = linkTag.attr('href');
                if (pageLink && pageLink.startsWith('/')) pageLink = BASE_URL + pageLink;

                items.push({
                    name: imgTag.attr('alt') ? imgTag.attr('alt').replace(' بث مباشر', '').trim() : "قناة غير معروفة",
                    page: pageLink,
                    img: imgTag.attr('src')
                });
            });

            for (const item of items) {
                if (!item.page) continue;
                console.log(`🔍 فحص قناة: ${item.name}`);
                
                const streamUrl = await getStreamUrl(item.page);
                
                if (streamUrl) {
                    console.log(`✨ سيرفر شغال، جاري معالجة الصورة...`);
                    const localImg = await processImage(item.img, item.name);
                    
                    // 🎯 الهيكل المبسط والجديد حسب طلبك
                    finalChannels.push({
                        id: channelIdCounter++,
                        name: item.name,
                        img: localImg,
                        url: streamUrl
                    });
                } else {
                    console.log(`⚠️ لا يوجد سيرفر متاح لهذه القناة.`);
                }
            }
        } catch (e) { console.log(`❌ خطأ في معالجة الصفحة: ${e.message}`); }
    }

    fs.writeFileSync(JSON_FILE, JSON.stringify(finalChannels, null, 2));
    console.log(`\n🏁 انتهت العملية! تم حفظ ${finalChannels.length} قناة بنجاح.`);
}

startScraping();
