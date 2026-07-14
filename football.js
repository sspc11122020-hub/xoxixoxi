import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';

/**
 * دالة للتحقق مما إذا كان رابط m3u8 يعمل (يعيد حالة 200)
 */
async function isStreamWorking(m3u8Url) {
    try {
        const response = await axios.head(m3u8Url, { 
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

/**
 * دالة تستخدم متصفح Puppeteer لاستخراج m3u8 من المشغل
 * تقوم بمراقبة الشبكة والنقر على الأزرار لمحاولة إيجاد بث يعمل
 */
async function extractM3u8WithBrowser(iframeUrl, browser) {
    if (!iframeUrl) return "";
    
    const page = await browser.newPage();
    let validM3u8 = "";

    try {
        // اعتراض طلبات الشبكة للقبض على روابط m3u8
        await page.setRequestInterception(true);
        page.on('request', async (request) => {
            const url = request.url();
            
            // إذا وجدنا رابط m3u8 ولم نقم بتخزين رابط صالح بعد
            if (url.includes('.m3u8') && !validM3u8) {
                // الفحص السريع للرابط للتأكد أنه يعمل
                const working = await isStreamWorking(url);
                if (working) {
                    validM3u8 = url;
                }
            }
            request.continue();
        });

        // الذهاب لصفحة السيرفر
        await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // ننتظر قليلاً علّ الرابط الأساسي يظهر فوراً
        await new Promise(r => setTimeout(r, 3000));

        // إذا تم اصطياد الرابط فوراً وكان يعمل، نعيده
        if (validM3u8) {
            await page.close();
            return validM3u8;
        }

        // إذا لم يظهر، سنحاول النقر على أزرار السيرفرات (li, button, .server)
        // أضفنا محددات (Selectors) عامة تتواجد عادة في هذه المشغلات
        const serverButtons = await page.$$('li, button, .server, .btn, a');
        
        for (let btn of serverButtons) {
            // محاولة النقر على الزر
            await btn.click().catch(() => {});
            
            // ننتظر ثانيتين بعد كل نقرة للسماح للطلب بالظهور في الـ Network
            await new Promise(r => setTimeout(r, 2000));
            
            if (validM3u8) {
                await page.close();
                return validM3u8;
            }
        }

    } catch (e) {
        console.log(`⚠️ تجاوز مهلة البحث عن رابط m3u8...`);
    } finally {
        if (!page.isClosed()) {
            await page.close();
        }
    }

    return validM3u8;
}

/**
 * دالة لاستخراج رابط السيرفر (iframe src) من صفحة المباراة عبر axios (أسرع)
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
 * السكريبت الرئيسي للتعامل مع الـ API
 */
async function scrapeMatches() {
    let browser = null;
    
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        
        // تشغيل متصفح Puppeteer في الخلفية
        browser = await puppeteer.launch({ 
            headless: true, // اجعله false إذا أردت رؤية المتصفح وهو يعمل بعينك
            args: ['--no-sandbox', '--disable-setuid-sandbox']
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
                // تمرير المتصفح ورابط المشغل لدالة الاستخراج
                directStream = await extractM3u8WithBrowser(streamUrl, browser);
            }

            if (directStream) {
                console.log(`✅ تم التقاط رابط شغال! -> ${directStream.substring(0, 50)}...`);
            } else {
                console.log(`❌ لم يتم العثور على رابط m3u8 يعمل`);
            }

            let matchStatus = matchInfo.meta?.status || "";
            if (matchStatus && matchStatus.toLowerCase() === "live") {
                matchStatus = "جارية الآن";
            }

            // تم الحفاظ على البنية القديمة بدون تغيير نهائياً
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
        // إغلاق المتصفح لعدم استهلاك الذاكرة
        if (browser) {
            await browser.close();
        }
    }
}

scrapeMatches();
