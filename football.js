import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة تستخدم متصفح Puppeteer لاستخراج m3u8 من المشغل
 * تقوم بمراقبة الاستجابات (Response) للتأكد من أن الرابط يعمل (Status 200)
 */
async function extractM3u8WithBrowser(iframeUrl, browser) {
    if (!iframeUrl) return "";
    
    const page = await browser.newPage();
    let validM3u8 = "";

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    try {
        await page.setRequestInterception(true);
        page.on('request', (request) => request.continue());

        // مراقبة الاستجابة للتأكد من أن الرابط شغال (Status 200)
        page.on('response', (response) => {
            const url = response.url();
            if (url.includes('.m3u8') && !url.includes('/ad/') && !validM3u8) {
                if (response.status() === 200) {
                    console.log(`\n[+] تم التقاط رابط شغال: ${url.substring(0, 50)}...`);
                    validM3u8 = url; 
                } else {
                    console.log(`\n[-] تم تجاهل رابط غير صالح (Status ${response.status()}): ${url.substring(0, 50)}...`);
                }
            }
        });

        await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 4000));

        // النقر في المنتصف لتشغيل الفيديو
        const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        await page.mouse.click(width / 2, height / 2);
        await new Promise(r => setTimeout(r, 4000));

        if (validM3u8) {
            await page.close();
            return validM3u8;
        }

        // محاولة النقر على أزرار السيرفرات الأخرى إذا لم ينجح الرابط الأول
        const serverButtons = await page.$$('li, button, .server, .btn, a');
        for (let btn of serverButtons) {
            if (validM3u8) break;
            await btn.click().catch(() => {});
            await new Promise(r => setTimeout(r, 2000)); 
            await page.mouse.click(width / 2, height / 2);
            await new Promise(r => setTimeout(r, 3000));
        }

    } catch (e) {
        console.log(`⚠️ خطأ في التصفح: ${e.message}`);
    } finally {
        if (!page.isClosed()) await page.close();
    }

    return validM3u8;
}

/**
 * دالة لاستخراج رابط الـ iframe من الصفحة الرئيسية للمباراة
 */
async function getServerIframeUrl(pageUrl) {
    if (!pageUrl) return "";
    try {
        const { data } = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 10000 
        });
        const iframes = data.match(/<iframe[^>]+>/gi) || [];
        for (let iframe of iframes) {
            if (iframe.includes('id="main-player"') || iframe.includes('/tv/')) {
                const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
                if (srcMatch) return srcMatch[1];
            }
        }
        return "";
    } catch (e) { return ""; }
}

async function scrapeMatches() {
    let browser = null;
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const { data } = await axios.get('https://liva7hd.info/wp-content/themes/jannah-1/MatchesPanel/api/matches.php?v=' + Date.now());
        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            console.log(`🔍 معالجة: ${matchInfo.team1?.name} vs ${matchInfo.team2?.name}`);

            const streamUrl = await getServerIframeUrl(matchInfo.meta?.link || "");
            let directStream = "";
            if (streamUrl) {
                console.log(`🌐 تم العثور على السيرفر: ${streamUrl}`);
                directStream = await extractM3u8WithBrowser(streamUrl, browser);
            }

            formattedMatches.push({
                id: i + 1,
                team1: matchInfo.team1?.name || "",
                team1Logo: matchInfo.team1?.logo || "",
                team2: matchInfo.team2?.name || "",
                team2Logo: matchInfo.team2?.logo || "",
                time: "",
                status: matchInfo.meta?.status === "Live" ? "جارية الآن" : matchInfo.meta?.status || "",
                channel: matchInfo.meta?.channel || matchInfo.meta?.commentator || "",
                league: matchInfo.meta?.champ || "",
                streamUrl: streamUrl,
                stream: directStream
            });
        }

        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log(`✅ انتهى العمل. تم حفظ ${formattedMatches.length} مباراة.`);
    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeMatches();
