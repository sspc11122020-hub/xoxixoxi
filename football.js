import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة تستخدم متصفح Puppeteer لاستخراج m3u8 من المشغل
 * تم التحديث: النقر على زر التشغيل وتجاوز فحص axios الصارم
 */
async function extractM3u8WithBrowser(iframeUrl, browser) {
    if (!iframeUrl) return "";
    
    const page = await browser.newPage();
    let validM3u8 = "";

    // تعيين User-Agent حقيقي لتجنب حظر المتصفحات الخفية (Bots)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    // تعيين حجم شاشة افتراضي لضمان تمركز النقر
    await page.setViewport({ width: 1280, height: 720 });

    try {
        // اعتراض طلبات الشبكة
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            
            // بمجرد أن يطلب المشغل ملف m3u8، نقوم بالتقاطه فوراً
            // استبعدنا كلمة ad لضمان عدم التقاط إعلانات الفيديو
            if (url.includes('.m3u8') && !url.includes('/ad/') && !validM3u8) {
                console.log(`\n[+] تم التقاط الرابط من الشبكة بنجاح!`);
                validM3u8 = url; 
            }
            request.continue();
        });

        // فتح صفحة السيرفر
        await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // 1. الانتظار حتى تكتمل واجهة المشغل
        await new Promise(r => setTimeout(r, 4000));

        // 2. محاكاة نقرة الماوس في منتصف الشاشة تماماً (مكان زر التشغيل الأزرق)
        const { width, height } = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight
        }));
        await page.mouse.click(width / 2, height / 2);
        
        // الانتظار قليلاً للسماح لطلب البث بالظهور في الشبكة بعد النقر
        await new Promise(r => setTimeout(r, 3000));

        // إذا تم التقاط الرابط بعد النقر على Play
        if (validM3u8) {
            await page.close();
            return validM3u8;
        }

        // 3. الخطة البديلة: إذا لم يعمل، نجرب النقر على أزرار السيرفرات الجانبية
        const serverButtons = await page.$$('li, button, .server, .btn, a');
        
        for (let btn of serverButtons) {
            await btn.click().catch(() => {});
            await new Promise(r => setTimeout(r, 2000)); // انتظار التحميل
            
            // محاولة النقر في المنتصف للتشغيل مرة أخرى
            await page.mouse.click(width / 2, height / 2);
            await new Promise(r => setTimeout(r, 2000));

            if (validM3u8) {
                await page.close();
                return validM3u8;
            }
        }

    } catch (e) {
        console.log(`⚠️ تجاوز مهلة البحث: ${e.message}`);
    } finally {
        if (!page.isClosed()) {
            await page.close();
        }
    }

    return validM3u8;
}

/**
 * دالة لاستخراج رابط السيرفر (iframe src) من صفحة المباراة
 */
async function getServerIframeUrl(pageUrl) {
    if (!pageUrl) return "";
    try {
        const { data } = await axios.get(pageUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://liva7hd.info/'
            },
            timeout: 10000 
        });

        const iframes = data.match(/<iframe[^>]+>/gi) || [];
        for (let iframe of iframes) {
            if (iframe.includes('id="main-player"') || iframe.includes("id='main-player'") || iframe.includes('/tv/')) {
                const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }
        return "";
    } catch (e) {
        return "";
    }
}

/**
 * السكريبت الرئيسي
 */
async function scrapeMatches() {
    let browser = null;
    
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
        });

        const apiUrl = `https://liva7hd.info/wp-content/themes/jannah-1/MatchesPanel/api/matches.php?v=${Date.now()}`;
        
        const { data } = await axios.get(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            
            const team1Name = matchInfo.team1?.name || "";
            const team2Name = matchInfo.team2?.name || "";

            console.log(`🔍 جاري معالجة: ${team1Name} vs ${team2Name}`);

            const matchPageLink = matchInfo.meta?.link || "";
            
            let streamUrl = "";
            if (matchPageLink) {
                streamUrl = await getServerIframeUrl(matchPageLink);
            }

            let directStream = "";
            if (streamUrl) {
                console.log(`🌐 تم العثور على رابط السيرفر (${streamUrl})`);
                console.log(`🕵️ جاري فتح المتصفح لاعتراض رابط m3u8...`);
                directStream = await extractM3u8WithBrowser(streamUrl, browser);
            }

            if (directStream) {
                console.log(`✅ تم استخراج الرابط المباشر بنجاح!`);
            } else {
                console.log(`❌ لم يتم العثور على رابط m3u8`);
            }

            let matchStatus = matchInfo.meta?.status || "";
            if (matchStatus && matchStatus.toLowerCase() === "live") {
                matchStatus = "جارية الآن";
            }

            const match = {
                id: i + 1,
                team1: team1Name,
                team1Logo: matchInfo.team1?.logo || "",
                team2: team2Name,
                team2Logo: matchInfo.team2?.logo || "",
                time: "", 
                status: matchStatus,
                channel: matchInfo.meta?.channel || matchInfo.meta?.commentator || "",
                league: matchInfo.meta?.champ || "",
                streamUrl: streamUrl,
                stream: directStream
            };

            formattedMatches.push(match);
        }

        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل. تم حفظ ${formattedMatches.length} مباراة في matches.json بنجاح.`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

scrapeMatches();
