import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة متقدمة لاستخراج الـ m3u8 من خلال التنقل في السيرفرات المتعددة
 * (ملاحظة: إذا تغير تصميم مشغل الفيديو في الموقع الجديد، قد تحتاج لتحديث الـ Selectors هنا)
 */
async function extractM3u8WithBrowser(mainIframeUrl, browser) {
    const page = await browser.newPage();
    let validM3u8 = "";

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // مراقبة الاستجابة للبحث عن روابط m3u8
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('.m3u8') && !url.includes('/ad/') && !validM3u8 && response.status() === 200) {
            validM3u8 = url;
            console.log(`[+] تم العثور على رابط فعال: ${url}`);
        }
    });

    try {
        await page.goto(mainIframeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 1. جمع كل روابط السيرفرات الأساسية من .servers_list
        const mainServers = await page.$$eval('.servers_list a', elements => elements.map(a => a.href));
        
        for (let serverUrl of mainServers) {
            if (validM3u8) break;
            
            console.log(`-> جاري فحص السيرفر الفرعي: ${serverUrl}`);
            await page.goto(serverUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 2000));

            // 2. البحث عن سيرفرات داخلية (مثل aplr-menu) والنقر عليها
            const subServers = await page.$$('.aplr-menu a[role="button"]');
            
            // نحاول النقر على السيرفرات الداخلية
            for (let subBtn of subServers) {
                if (validM3u8) break;
                
                await subBtn.click().catch(() => {});
                // النقر في المنتصف لتشغيل الفيديو
                await page.mouse.click(640, 360); 
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } catch (e) {
        console.log(`⚠️ خطأ أثناء التصفح: ${e.message}`);
    } finally {
        await page.close();
    }
    return validM3u8;
}

// دالة getServerIframeUrl المعتادة
async function getServerIframeUrl(pageUrl) {
    if (!pageUrl) return "";
    try {
        const { data } = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000 
        });
        const iframes = data.match(/<iframe[^>]+>/gi) || [];
        for (let iframe of iframes) {
            // قد تحتاج لتعديل هذه الشروط لتناسب الموقع الجديد yallakora.world
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
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        
        // جلب البيانات من الـ API الجديد
        const { data } = await axios.get('https://yallakora.world/api.php?day=today');
        
        // التحقق من وجود المباريات في الهيكل الجديد
        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            
            // استخدام رابط المباراة الجديد
            const streamUrl = await getServerIframeUrl(matchInfo.match_url || "");
            let directStream = "";
            
            if (streamUrl) {
                console.log(`🔍 معالجة: ${matchInfo.home_team} vs ${matchInfo.away_team}`);
                directStream = await extractM3u8WithBrowser(streamUrl, browser);
            }

            // تخزين البيانات بالشكل المتوافق مع الهيكل الجديد
            formattedMatches.push({
                id: matchInfo.id || i + 1,
                team1: matchInfo.home_team || "",
                team1Logo: matchInfo.home_logo || "",
                team2: matchInfo.away_team || "",
                team2Logo: matchInfo.away_logo || "",
                time: matchInfo.time || "",
                score: `${matchInfo.score_home} - ${matchInfo.score_away}`,
                status: matchInfo.status_text || "",
                channel: matchInfo.channel || "",
                commentator: matchInfo.commentator || "",
                league: matchInfo.league || "",
                matchUrl: matchInfo.match_url || "",
                streamUrl: streamUrl,
                stream: directStream
            });
        }
        
        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log('✅ تم حفظ البيانات بنجاح في ملف matches.json');
    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        if (browser) await browser.close();
    }
}

scrapeMatches();
